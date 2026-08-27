"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArtworkCard, revokeArtworkImage } from "@/components/artwork/ArtworkCard";
import { BatchImageUploader } from "@/components/artwork/BatchImageUploader";
import { BatchReview } from "@/components/artwork/BatchReview";
import { BatchStepHeading } from "@/components/artwork/BatchStepHeading";
import { BatchSummaryBar } from "@/components/artwork/BatchSummaryBar";
import { ClearBatchConfirmationView } from "@/components/artwork/ClearBatchConfirmationView";
import { IncompleteLargeFileResume } from "@/components/artwork/IncompleteLargeFileResume";
import { ApplySharedDetailsConfirmationView } from "@/components/artwork/ApplySharedDetailsConfirmationView";
import { SharedDetailsSection } from "@/components/artwork/SharedDetailsSection";
import { useTiffPreviews } from "@/components/artwork/useTiffPreviews";
import {
  createFreshIntakeBatch,
  reduceClearBatchUi,
  type ClearBatchUiPhase,
} from "@/lib/artwork/batch-reset";
import {
  appendFilesToBatch,
  artworkNeedsMetadata,
  removeArtworkFromBatch,
  reorderArtworks,
  revokeArtworkDraftImage,
  totalBatchBytes,
  type AppendFilesRejection,
  type DuplicateMatch,
} from "@/lib/artwork/batch-files";
import {
  applySharedDetailsAppliedMessage,
  fillBlankArtworkFieldsFromShared,
  MAX_ARTWORKS_PER_BATCH,
  formatArtworkNumber,
  populatedSharedApplyFields,
  remainingArtworkSlots,
  requiresLargeFileDropboxIntake,
  resolveApplySharedDetails,
  sharedApplyWouldOverwrite,
  type ArtworkDraft,
  type BatchDraft,
  type BatchSharedDetails,
  type BatchValidationResult,
} from "@/lib/artwork/types";
import { hasBatchErrors, validateBatch } from "@/lib/artwork/validation";

export function NewArtworkBatchForm({
  archiveTarget = "production",
  initialBatch,
}: {
  archiveTarget?: "test" | "production" | "invalid";
  initialBatch?: BatchDraft;
}) {
  const [batch, setBatch] = useState<BatchDraft>(
    () => initialBatch ?? createFreshIntakeBatch().batch,
  );
  const [mode, setMode] = useState<"edit" | "review">("edit");
  const [errors, setErrors] = useState<BatchValidationResult>({ artworks: {} });
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyNotice, setApplyNotice] = useState<string | null>(null);
  const [clearPhase, setClearPhase] = useState<ClearBatchUiPhase>("idle");
  const [formEpoch, setFormEpoch] = useState(0);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [uploadRejects, setUploadRejects] = useState<AppendFilesRejection[]>([]);
  const [duplicatePrompt, setDuplicatePrompt] = useState<{
    duplicates: DuplicateMatch[];
    pending: File[];
  } | null>(null);
  const {
    previewByArtworkId,
    enqueueMissing,
    enqueueForArtwork,
    invalidateArtwork,
    resetAll: resetTiffPreviews,
  } = useTiffPreviews();
  const batchRef = useRef(batch);
  const batchDetailsRef = useRef<HTMLDivElement | null>(null);
  const skipInitialEditStepEntryRef = useRef(true);

  useEffect(() => {
    batchRef.current = batch;
  }, [batch]);

  useLayoutEffect(() => {
    skipInitialEditStepEntryRef.current = false;
  }, []);

  useEffect(() => {
    return () => {
      for (const artwork of batchRef.current.artworks) {
        revokeArtworkImage(artwork);
      }
    };
  }, []);

  function updateShared<K extends keyof BatchSharedDetails>(
    field: K,
    value: BatchSharedDetails[K],
  ) {
    setBatch((current) => {
      const shared = { ...current.shared, [field]: value };
      return {
        ...current,
        shared,
        artworks: fillBlankArtworkFieldsFromShared(
          current.artworks,
          shared,
          field,
        ),
      };
    });
  }

  function updateArtwork(id: string, next: ArtworkDraft) {
    setBatch((current) => ({
      ...current,
      artworks: current.artworks.map((artwork) =>
        artwork.id === id ? next : artwork,
      ),
    }));
    setErrors((current) => {
      if (!current.artworks[id] && !current.form) return current;
      const artworks = { ...current.artworks };
      delete artworks[id];
      return { form: undefined, artworks };
    });
  }

  function ingestFiles(files: File[], allowDuplicates = false) {
    const result = appendFilesToBatch(batchRef.current, files, {
      allowDuplicates,
      createPreviewUrls: true,
    });

    batchRef.current = result.batch;
    setBatch(result.batch);
    setUploadRejects(result.rejected);

    if (result.added.length > 0) {
      enqueueMissing(result.added);
    }

    if (result.duplicates.length > 0 && !allowDuplicates) {
      setDuplicatePrompt({
        duplicates: result.duplicates,
        pending: result.pendingDuplicates,
      });
    } else {
      setDuplicatePrompt(null);
    }

    if (result.added.length > 0) {
      const largeCount = result.added.filter(
        (artwork) =>
          artwork.image &&
          requiresLargeFileDropboxIntake(artwork.image.file.size),
      ).length;
      const created = `${result.added.length} image${result.added.length === 1 ? "" : "s"} selected · ${result.added.length} artwork entr${result.added.length === 1 ? "y" : "ies"} created`;
      setUploadNotice(
        largeCount > 0
          ? `${created}. ${largeCount} file${largeCount === 1 ? "" : "s"} exceed the direct-upload limit — after review, prepare large-file intake instead of rejecting them.`
          : created,
      );
      requestAnimationFrame(() => {
        batchDetailsRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    } else if (result.duplicates.length === 0 && result.rejected.length > 0) {
      setUploadNotice(null);
    }
  }

  function applyFreshIntake() {
    resetTiffPreviews();
    const fresh = createFreshIntakeBatch();
    batchRef.current = fresh.batch;
    setBatch(fresh.batch);
    setErrors(fresh.errors);
    setMode(fresh.mode);
    setApplyOpen(fresh.applyOpen);
    setApplyNotice(fresh.applyNotice);
    setClearPhase(fresh.clearPhase);
    setUploadNotice(fresh.uploadNotice);
    setUploadRejects(fresh.uploadRejects);
    setDuplicatePrompt(fresh.duplicatePrompt);
    setFormEpoch((current) => current + 1);
  }

  function removeArtwork(id: string) {
    const current = batchRef.current;
    const { batch: next, removed, returnedToEmpty } = removeArtworkFromBatch(
      current,
      id,
    );
    if (removed) revokeArtworkDraftImage(removed);
    invalidateArtwork(id);
    if (returnedToEmpty) {
      applyFreshIntake();
      return;
    }
    batchRef.current = next;
    setBatch(next);
  }

  function moveArtwork(id: string, direction: -1 | 1) {
    setBatch((current) => ({
      ...current,
      artworks: reorderArtworks(current.artworks, id, direction),
    }));
  }

  function confirmApplyShared() {
    setBatch((current) => ({
      ...current,
      artworks: resolveApplySharedDetails(
        current.artworks,
        current.shared,
        "apply",
      ),
    }));
    setApplyNotice(applySharedDetailsAppliedMessage(batch.artworks.length));
    setApplyOpen(false);
  }

  function resetBatch() {
    for (const artwork of batchRef.current.artworks) {
      revokeArtworkImage(artwork);
    }
    applyFreshIntake();
  }

  function requestClearBatch() {
    setClearPhase((current) => reduceClearBatchUi(current, "request-clear"));
  }

  function cancelClearBatch() {
    setClearPhase((current) => reduceClearBatchUi(current, "cancel"));
  }

  function confirmClearBatch() {
    if (clearPhase !== "confirm") return;
    resetBatch();
  }

  function handleReview() {
    const current = batchRef.current;
    const result = validateBatch(current);
    if (hasBatchErrors(result)) {
      setErrors(result);
      const firstInvalid = current.artworks.find((a) => result.artworks[a.id]);
      if (firstInvalid) {
        requestAnimationFrame(() => {
          document
            .getElementById(`artwork-card-${firstInvalid.id}`)
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
      return;
    }
    setErrors({ artworks: {} });
    setMode("review");
  }

  if (mode === "review") {
    return (
      <BatchReview
        shared={batch.shared}
        artworks={batch.artworks}
        tiffPreviewByArtworkId={previewByArtworkId}
        onBack={() => setMode("edit")}
        onReset={resetBatch}
        archiveTarget={archiveTarget}
      />
    );
  }

  const count = batch.artworks.length;
  const remainingSlots = remainingArtworkSlots(count);
  const needingMetadata = batch.artworks.filter(artworkNeedsMetadata).length;
  const validationErrorCount = Object.keys(errors.artworks).length;

  return (
    <div>
      <header className="max-w-2xl">
        <BatchStepHeading
          enterOnMount={!skipInitialEditStepEntryRef.current}
        >
          Add New Artwork
        </BatchStepHeading>
        {count > 0 ? (
          <p className="mt-3 text-sm text-[var(--ink-soft)]">
            {count} of {MAX_ARTWORKS_PER_BATCH} artworks in this batch
          </p>
        ) : null}
      </header>

      {count === 0 ? <IncompleteLargeFileResume /> : null}

      <form
        key={formEpoch}
        className="mt-10 space-y-8"
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          handleReview();
        }}
        onReset={(event) => {
          event.preventDefault();
        }}
        noValidate
      >
        {count === 0 ? (
          <BatchImageUploader
            disabled={remainingSlots === 0}
            remainingSlots={remainingSlots}
            onFilesSelected={(files) => ingestFiles(files)}
          />
        ) : null}

        <p role="status" aria-live="polite" className="sr-only">
          {uploadNotice ?? ""}
        </p>

        {uploadRejects.length > 0 ? (
          <div
            role="alert"
            className="border border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]"
          >
            <p className="font-medium">Some files could not be added</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {uploadRejects.map((reject, index) => (
                <li key={`${reject.code}-${index}`}>
                  {"file" in reject
                    ? reject.message
                    : reject.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {duplicatePrompt ? (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="duplicate-title"
            className="border border-[var(--accent)] bg-[var(--surface-elevated)] p-5 shadow-sm"
          >
            <h2
              id="duplicate-title"
              className="font-display text-xl text-[var(--ink)]"
            >
              Possible duplicate files
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              These files match an artwork already in the batch (same filename,
              size, and last-modified time, or the same selected file). Add them
              anyway only if that is intentional.
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[var(--ink)]">
              {duplicatePrompt.duplicates.map((dup) => (
                <li key={`${dup.existingArtworkId}-${dup.file.name}`}>
                  {dup.file.name} matches existing {dup.existingFilename}
                </li>
              ))}
            </ul>
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => {
                  const pending = duplicatePrompt.pending;
                  setDuplicatePrompt(null);
                  ingestFiles(pending, true);
                }}
                className="border border-[var(--ink)] bg-[var(--ink)] px-4 py-2 text-xs uppercase tracking-[0.12em] text-[var(--paper)]"
              >
                Add anyway
              </button>
              <button
                type="button"
                onClick={() => setDuplicatePrompt(null)}
                className="px-4 py-2 text-xs uppercase tracking-[0.12em] text-[var(--muted)] hover:text-[var(--ink)]"
              >
                Skip duplicates
              </button>
            </div>
          </div>
        ) : null}

        {errors.form ? (
          <div
            role="alert"
            className="border border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]"
          >
            {errors.form}
          </div>
        ) : null}

        {count > 0 ? (
          <>
            <div ref={batchDetailsRef}>
              <BatchSummaryBar
                artworkCount={count}
                maxArtworks={MAX_ARTWORKS_PER_BATCH}
                totalBytes={totalBatchBytes(batch.artworks)}
                needingMetadata={needingMetadata}
                validationErrors={validationErrorCount}
                canAddMore={remainingSlots > 0}
                onFilesSelected={(files) => ingestFiles(files)}
                onRequestClear={requestClearBatch}
              />
            </div>

            <SharedDetailsSection
              shared={batch.shared}
              onChange={updateShared}
              canApply={count > 0}
              onRequestApply={() => {
                setApplyNotice(null);
                setApplyOpen(true);
              }}
            />

            {applyNotice ? (
              <p
                role="status"
                aria-live="polite"
                className="border border-[var(--accent)] bg-[var(--accent-soft)] px-4 py-3 text-sm text-[var(--ink)]"
              >
                {applyNotice}
              </p>
            ) : null}

            <section
              aria-labelledby="artworks-heading"
              className="space-y-3"
            >
              <div>
                <h2
                  id="artworks-heading"
                  className="font-display text-2xl text-[var(--ink)]"
                >
                  Artworks
                </h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  One image per artwork. Preview inventory numbers follow current
                  order ({formatArtworkNumber(0)} → 1000). Enter titles and
                  dimensions quickly in the compact rows below.
                </p>
              </div>

              <div className="space-y-3">
                {batch.artworks.map((artwork, index) => (
                  <ArtworkCard
                    key={artwork.id}
                    artwork={artwork}
                    index={index}
                    total={batch.artworks.length}
                    errors={errors.artworks[artwork.id]}
                    onChange={(next) => updateArtwork(artwork.id, next)}
                    onRemove={() => removeArtwork(artwork.id)}
                    onMoveUp={() => moveArtwork(artwork.id, -1)}
                    onMoveDown={() => moveArtwork(artwork.id, 1)}
                    onImageReplaced={(next) => {
                      enqueueForArtwork(next);
                    }}
                    tiffPreview={previewByArtworkId[artwork.id]}
                  />
                ))}
              </div>
            </section>

            <div className="flex flex-col-reverse gap-3 border-t border-[var(--line)] pt-6 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={requestClearBatch}
                className="px-5 py-3 text-sm uppercase tracking-[0.14em] text-[var(--muted)] transition hover:text-[var(--ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              >
                Clear Batch…
              </button>
              <button
                type="button"
                onClick={handleReview}
                className="border border-[var(--ink)] bg-[var(--ink)] px-6 py-3 text-sm uppercase tracking-[0.14em] text-[var(--paper)] transition hover:bg-[var(--ink-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              >
                Review Batch
              </button>
            </div>
          </>
        ) : null}
      </form>
      {applyOpen ? (
        <ApplySharedDetailsConfirmationView
          artworkCount={count}
          fields={populatedSharedApplyFields(batch.shared)}
          wouldOverwrite={sharedApplyWouldOverwrite(
            batch.artworks,
            batch.shared,
          )}
          onConfirm={confirmApplyShared}
          onCancel={() => setApplyOpen(false)}
        />
      ) : null}
      {clearPhase === "confirm" ? (
        <ClearBatchConfirmationView
          onCancel={cancelClearBatch}
          onConfirm={confirmClearBatch}
        />
      ) : null}
    </div>
  );
}
