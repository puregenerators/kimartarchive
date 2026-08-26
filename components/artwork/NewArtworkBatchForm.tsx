"use client";

import { useEffect, useRef, useState } from "react";
import { ArtworkCard, revokeArtworkImage } from "@/components/artwork/ArtworkCard";
import { BatchImageUploader } from "@/components/artwork/BatchImageUploader";
import { BatchReview } from "@/components/artwork/BatchReview";
import { BatchSummaryBar } from "@/components/artwork/BatchSummaryBar";
import { ClearBatchConfirmationView } from "@/components/artwork/ClearBatchConfirmationView";
import { IncompleteLargeFileResume } from "@/components/artwork/IncompleteLargeFileResume";
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
  clearProcessingForArtwork,
  removeArtworkFromList,
  reorderArtworks,
  revokeArtworkDraftImage,
  totalBatchBytes,
  type AppendFilesRejection,
  type DuplicateMatch,
} from "@/lib/artwork/batch-files";
import {
  APPLYABLE_SHARED_FIELDS,
  DEFAULT_APPLY_SELECTION,
  applySharedDetailsToArtworks,
  MAX_ARTWORKS_PER_BATCH,
  formatArtworkNumber,
  previewInventoryIdForIndex,
  remainingArtworkSlots,
  requiresLargeFileDropboxIntake,
  type ApplyableSharedFieldKey,
  type ArtworkDraft,
  type BatchDraft,
  type BatchSharedDetails,
  type BatchValidationResult,
} from "@/lib/artwork/types";
import {
  applyUntitledToSelectedArtworks,
  artworkHasTitleToOverwrite,
  resolveArtworkTitle,
} from "@/lib/artwork/untitled";
import { hasBatchErrors, validateBatch } from "@/lib/artwork/validation";
import type { ArtworkProcessingState } from "@/lib/images/client-types";
import { isProcessingResultStale } from "@/lib/images/fingerprint";

export function NewArtworkBatchForm({
  archiveTarget = "production",
}: {
  archiveTarget?: "test" | "production" | "invalid";
}) {
  const [batch, setBatch] = useState<BatchDraft>(
    () => createFreshIntakeBatch().batch,
  );
  const [mode, setMode] = useState<"edit" | "review">("edit");
  const [errors, setErrors] = useState<BatchValidationResult>({ artworks: {} });
  const [applyOpen, setApplyOpen] = useState(false);
  const [applySelection, setApplySelection] = useState<ApplyableSharedFieldKey[]>(
    [...DEFAULT_APPLY_SELECTION],
  );
  const [untitledOpen, setUntitledOpen] = useState(false);
  const [untitledSelection, setUntitledSelection] = useState<string[]>([]);
  const [untitledOverwriteConfirm, setUntitledOverwriteConfirm] =
    useState(false);
  const [clearPhase, setClearPhase] = useState<ClearBatchUiPhase>("idle");
  const [formEpoch, setFormEpoch] = useState(0);
  const [showAddMore, setShowAddMore] = useState(false);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [uploadRejects, setUploadRejects] = useState<AppendFilesRejection[]>([]);
  const [duplicatePrompt, setDuplicatePrompt] = useState<{
    duplicates: DuplicateMatch[];
    pending: File[];
  } | null>(null);
  const [processingByArtworkId, setProcessingByArtworkId] = useState<
    Record<string, ArtworkProcessingState>
  >({});
  const {
    previewByArtworkId,
    enqueueMissing,
    enqueueForArtwork,
    invalidateArtwork,
    resetAll: resetTiffPreviews,
  } = useTiffPreviews();
  const batchRef = useRef(batch);
  const artworksSectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    batchRef.current = batch;
  }, [batch]);

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
    setBatch((current) => ({
      ...current,
      shared: { ...current.shared, [field]: value },
    }));
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
        artworksSectionRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    } else if (result.duplicates.length === 0 && result.rejected.length > 0) {
      setUploadNotice(null);
    }

    setShowAddMore(false);
  }

  function removeArtwork(id: string) {
    setBatch((current) => {
      const { artworks, removed } = removeArtworkFromList(current.artworks, id);
      if (removed) revokeArtworkDraftImage(removed);
      return { ...current, artworks };
    });
    setProcessingByArtworkId((current) =>
      clearProcessingForArtwork(current, id),
    );
    invalidateArtwork(id);
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
      artworks: applySharedDetailsToArtworks(
        current.artworks,
        current.shared,
        applySelection,
      ),
    }));
    setApplyOpen(false);
  }

  function confirmApplyUntitled() {
    const result = applyUntitledToSelectedArtworks(
      batch.artworks,
      untitledSelection,
      { overwriteTitled: untitledOverwriteConfirm },
    );
    if (result.blocked.length > 0) {
      return;
    }
    setBatch((current) => ({ ...current, artworks: result.artworks }));
    setErrors((current) => {
      const artworks = { ...current.artworks };
      for (const id of untitledSelection) {
        const existing = artworks[id];
        if (!existing?.title) continue;
        const next = { ...existing };
        delete next.title;
        if (Object.keys(next).length === 0) delete artworks[id];
        else artworks[id] = next;
      }
      return { form: undefined, artworks };
    });
    setUntitledOpen(false);
    setUntitledSelection([]);
    setUntitledOverwriteConfirm(false);
  }

  function resetBatch() {
    for (const artwork of batchRef.current.artworks) {
      revokeArtworkImage(artwork);
    }
    resetTiffPreviews();
    const fresh = createFreshIntakeBatch();
    batchRef.current = fresh.batch;
    setBatch(fresh.batch);
    setErrors(fresh.errors);
    setProcessingByArtworkId(fresh.processingByArtworkId);
    setMode(fresh.mode);
    setApplyOpen(fresh.applyOpen);
    setApplySelection([...fresh.applySelection]);
    setUntitledOpen(fresh.untitledOpen);
    setUntitledSelection(fresh.untitledSelection);
    setUntitledOverwriteConfirm(fresh.untitledOverwriteConfirm);
    setClearPhase(fresh.clearPhase);
    setShowAddMore(fresh.showAddMore);
    setUploadNotice(fresh.uploadNotice);
    setUploadRejects(fresh.uploadRejects);
    setDuplicatePrompt(fresh.duplicatePrompt);
    setFormEpoch((current) => current + 1);
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

  function updateProcessing(
    artworkId: string,
    state: ArtworkProcessingState,
  ) {
    setProcessingByArtworkId((current) => ({
      ...current,
      [artworkId]: state,
    }));
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

  function processingStats() {
    let testedSuccessfully = 0;
    let notYetTested = 0;

    batch.artworks.forEach((artwork, index) => {
      const state = processingByArtworkId[artwork.id] ?? { status: "idle" };
      if (!artwork.image) {
        notYetTested += 1;
        return;
      }
      const fingerprintInput = {
        title: resolveArtworkTitle(artwork),
        year: artwork.year,
        previewInventoryId: previewInventoryIdForIndex(index),
        imageName: artwork.image.file.name,
        imageSize: artwork.image.file.size,
        imageLastModified: artwork.image.file.lastModified,
      };
      if (state.status === "success") {
        const stale = isProcessingResultStale(
          state.fingerprint,
          fingerprintInput,
        );
        if (stale) notYetTested += 1;
        else testedSuccessfully += 1;
        return;
      }
      notYetTested += 1;
    });

    return { testedSuccessfully, notYetTested };
  }

  if (mode === "review") {
    return (
      <BatchReview
        shared={batch.shared}
        artworks={batch.artworks}
        processingByArtworkId={processingByArtworkId}
        tiffPreviewByArtworkId={previewByArtworkId}
        onProcessingChange={updateProcessing}
        onBack={() => setMode("edit")}
        onReset={resetBatch}
        archiveTarget={archiveTarget}
      />
    );
  }

  const count = batch.artworks.length;
  const remainingSlots = remainingArtworkSlots(count);
  const { testedSuccessfully, notYetTested } = processingStats();
  const needingMetadata = batch.artworks.filter(artworkNeedsMetadata).length;
  const validationErrorCount = Object.keys(errors.artworks).length;

  return (
    <div>
      <header className="max-w-2xl">
        <h1 className="font-display text-4xl tracking-tight text-[var(--ink)] sm:text-5xl">
          Add New Artwork
        </h1>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-[var(--muted)] leading-relaxed">
          <li>You can upload one image or a batch.</li>
          <li>Each image file becomes its own artwork entry.</li>
          <li>
            You can enter details that will apply to all artworks in the batch,
            like date and gallery.
          </li>
        </ul>
        {count > 0 ? (
          <p className="mt-3 text-sm text-[var(--ink-soft)]">
            {count} of {MAX_ARTWORKS_PER_BATCH} artworks in this batch
          </p>
        ) : null}
      </header>

      <IncompleteLargeFileResume />

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
        <BatchImageUploader
          disabled={remainingSlots === 0}
          remainingSlots={remainingSlots}
          onFilesSelected={(files) => ingestFiles(files)}
        />

        {uploadNotice ? (
          <p
            role="status"
            className="border border-[var(--accent)] bg-[var(--accent-soft)] px-4 py-3 text-sm text-[var(--ink)]"
          >
            {uploadNotice}
          </p>
        ) : null}

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

        <SharedDetailsSection
          shared={batch.shared}
          onChange={updateShared}
          canApply={count > 0}
          onRequestApply={() => {
            setApplySelection([...DEFAULT_APPLY_SELECTION]);
            setApplyOpen(true);
          }}
        />

        {applyOpen && count > 0 ? (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="apply-shared-title"
            className="border border-[var(--accent)] bg-[var(--surface-elevated)] p-5 shadow-sm"
          >
            <h2
              id="apply-shared-title"
              className="font-display text-xl text-[var(--ink)]"
            >
              Apply shared details to all artworks?
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Choose which fields to update. Only populated shared values are
              applied; blank shared fields leave each artwork’s existing value
              unchanged:
            </p>
            <ul className="mt-3 space-y-2 text-sm text-[var(--ink)]">
              {APPLYABLE_SHARED_FIELDS.map((field) => {
                const checked = applySelection.includes(field.key);
                return (
                  <li key={field.key}>
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={checked}
                        onChange={() => {
                          setApplySelection((current) =>
                            checked
                              ? current.filter((key) => key !== field.key)
                              : [...current, field.key],
                          );
                        }}
                      />
                      <span>
                        {field.label} ← {field.from}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-sm text-[var(--muted)]">
              Title, Height, Width, Depth, Notes, and images are never
              changed by this action. Use Apply Untitled to selected
              artworks to mark unknown titles.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={applySelection.length === 0}
                onClick={confirmApplyShared}
                className="border border-[var(--ink)] bg-[var(--ink)] px-4 py-2 text-xs uppercase tracking-[0.12em] text-[var(--paper)] disabled:opacity-40"
              >
                Apply selected
              </button>
              <button
                type="button"
                onClick={() => setApplyOpen(false)}
                className="px-4 py-2 text-xs uppercase tracking-[0.12em] text-[var(--muted)] hover:text-[var(--ink)]"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {count > 0 ? (
          <>
            <BatchSummaryBar
              artworkCount={count}
              maxArtworks={MAX_ARTWORKS_PER_BATCH}
              totalBytes={totalBatchBytes(batch.artworks)}
              needingMetadata={needingMetadata}
              validationErrors={validationErrorCount}
              testedSuccessfully={testedSuccessfully}
              notYetTested={notYetTested}
              canAddMore={remainingSlots > 0}
              onAddMore={() => setShowAddMore(true)}
              onRequestClear={requestClearBatch}
            />

            {showAddMore ? (
              <BatchImageUploader
                compact
                disabled={remainingSlots === 0}
                remainingSlots={remainingSlots}
                onFilesSelected={(files) => ingestFiles(files)}
              />
            ) : null}

            <section
              ref={artworksSectionRef}
              aria-labelledby="artworks-heading"
              className="space-y-3"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
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
                <button
                  type="button"
                  onClick={() => {
                    setUntitledSelection([]);
                    setUntitledOverwriteConfirm(false);
                    setUntitledOpen(true);
                  }}
                  className="shrink-0 self-start border border-[var(--line)] bg-[var(--surface-elevated)] px-4 py-2 text-xs uppercase tracking-[0.12em] text-[var(--ink)] transition hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                >
                  Apply Untitled to selected artworks
                </button>
              </div>

              {untitledOpen ? (
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="apply-untitled-title"
                  className="border border-[var(--accent)] bg-[var(--surface-elevated)] p-5 shadow-sm"
                >
                  <h2
                    id="apply-untitled-title"
                    className="font-display text-xl text-[var(--ink)]"
                  >
                    Apply Untitled to selected artworks
                  </h2>
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    Selected works will be archived with the title Untitled.
                    Inventory IDs keep them unique. This does not run unless you
                    choose artworks below.
                  </p>
                  <ul className="mt-3 space-y-2 text-sm text-[var(--ink)]">
                    {batch.artworks.map((artwork, index) => {
                      const checked = untitledSelection.includes(artwork.id);
                      const archived = resolveArtworkTitle(artwork);
                      return (
                        <li key={artwork.id}>
                          <label className="flex items-start gap-2">
                            <input
                              type="checkbox"
                              className="mt-1"
                              checked={checked}
                              onChange={() => {
                                setUntitledOverwriteConfirm(false);
                                setUntitledSelection((current) =>
                                  checked
                                    ? current.filter((id) => id !== artwork.id)
                                    : [...current, artwork.id],
                                );
                              }}
                            />
                            <span>
                              Artwork {formatArtworkNumber(index)} ·{" "}
                              {archived || "No title yet"}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                  {batch.artworks.some(
                    (artwork) =>
                      untitledSelection.includes(artwork.id) &&
                      artworkHasTitleToOverwrite(artwork),
                  ) ? (
                    <label className="mt-4 flex items-start gap-2 text-sm text-[var(--ink)]">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={untitledOverwriteConfirm}
                        onChange={(event) =>
                          setUntitledOverwriteConfirm(event.target.checked)
                        }
                      />
                      <span>
                        Replace existing titles with Untitled. This cannot be
                        undone except by unchecking Missing / no known title on
                        each card.
                      </span>
                    </label>
                  ) : null}
                  <div className="mt-5 flex flex-wrap gap-3">
                    <button
                      type="button"
                      disabled={
                        untitledSelection.length === 0 ||
                        (batch.artworks.some(
                          (artwork) =>
                            untitledSelection.includes(artwork.id) &&
                            artworkHasTitleToOverwrite(artwork),
                        ) &&
                          !untitledOverwriteConfirm)
                      }
                      onClick={confirmApplyUntitled}
                      className="border border-[var(--ink)] bg-[var(--ink)] px-4 py-2 text-xs uppercase tracking-[0.12em] text-[var(--paper)] disabled:opacity-40"
                    >
                      Apply Untitled
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setUntitledOpen(false);
                        setUntitledSelection([]);
                        setUntitledOverwriteConfirm(false);
                      }}
                      className="px-4 py-2 text-xs uppercase tracking-[0.12em] text-[var(--muted)] hover:text-[var(--ink)]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}

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
                      setProcessingByArtworkId((current) =>
                        clearProcessingForArtwork(current, artwork.id),
                      );
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
      {clearPhase === "confirm" ? (
        <ClearBatchConfirmationView
          onCancel={cancelClearBatch}
          onConfirm={confirmClearBatch}
        />
      ) : null}
    </div>
  );
}
