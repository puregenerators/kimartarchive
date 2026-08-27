"use client";

import { useEffect, useRef, useState } from "react";
import { BatchStepHeading } from "@/components/artwork/BatchStepHeading";
import { BatchSubmissionReport } from "@/components/artwork/BatchSubmissionReport";
import {
  BatchSubmitConfirmationView,
  BatchSubmitFailureView,
} from "@/components/artwork/BatchSubmitConfirmationView";
import { BatchSubmittingStatusView, type IntakeProgressItem } from "@/components/artwork/BatchSubmittingStatusView";
import { scrollBatchPageToTop } from "@/lib/artwork/step-focus";
import type { SubmitFailureInfo } from "@/lib/artwork/submit-confirm";
import { FilenameDisplay } from "@/components/artwork/FilenameDisplay";
import {
  ArtworkImageThumb,
  ArtworkImageThumbFooterNote,
} from "@/components/artwork/ArtworkImageThumb";
import { planFilenamesForArtwork } from "@/lib/artwork/filenames";
import {
  MAX_FILE_SIZE_LABEL,
  effectiveOverride,
  formatArtworkNumber,
  previewInventoryIdForIndex,
  requiresLargeFileDropboxIntake,
  type ArtworkDraft,
  type BatchSharedDetails,
} from "@/lib/artwork/types";
import { resolveArtworkTitle } from "@/lib/artwork/untitled";
import {
  describeImageType,
  formatDimensions,
  formatFileSize,
} from "@/lib/artwork/validation";
import type { TiffPreviewState } from "@/lib/images/preview-client";
import {
  batchDraftToSubmissionPayload,
} from "@/lib/submission/validate-input";
import { uploadMasterToTemporaryLink } from "@/lib/submission/browser-master-upload";
import { LargeMasterIntakePanel } from "@/components/artwork/LargeMasterIntakePanel";
import type { PreparedArtwork } from "@/lib/submission/direct-intake-types";
import {
  largeFileNeedsUploadHeading,
  statusFromLargeFileProcessError,
  type LargeFileCheckResult,
  type LargeFileIntakeStatus,
} from "@/lib/submission/large-file-intake-logic";
import type {
  ArtworkSubmissionResult,
  BatchSubmissionResult,
} from "@/lib/submission/types";

type LargeFilePanelState = {
  clientArtworkId: string;
  title: string;
  claimId: string;
  inventoryId: number;
  folderName: string;
  masterFilename: string;
  folderWebUrl: string | null;
  status: LargeFileIntakeStatus;
  message: string;
  canContinueProcessing: boolean;
  checking?: boolean;
  processing?: boolean;
  byteLengthLabel?: string | null;
  dimensionsLabel?: string | null;
};

function largeFileDimensionsLabel(check: LargeFileCheckResult): string | null {
  if (check.width && check.height) {
    const depth = check.bitDepth ? ` · ${check.bitDepth}-bit` : "";
    return `${check.width}×${check.height}px${depth}`;
  }
  return null;
}

type ArchiveTargetProp = "test" | "production" | "invalid";

type BatchReviewProps = {
  shared: BatchSharedDetails;
  artworks: ArtworkDraft[];
  tiffPreviewByArtworkId?: Record<string, TiffPreviewState>;
  onBack: () => void;
  onReset: () => void;
  archiveTarget: ArchiveTargetProp;
};

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-[var(--line)] py-2 sm:grid-cols-[9rem_1fr] sm:gap-3">
      <dt className="text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
        {label}
      </dt>
      <dd className="text-sm text-[var(--ink)] whitespace-pre-wrap">
        {value.trim() ? value : "—"}
      </dd>
    </div>
  );
}

function totalSourceBytes(artworks: ArtworkDraft[]): number {
  return artworks.reduce(
    (sum, artwork) => sum + (artwork.image?.file.size ?? 0),
    0,
  );
}

function ReviewArtworkCard({
  artwork,
  index,
  shared,
  tiffPreview,
}: {
  artwork: ArtworkDraft;
  index: number;
  shared: BatchSharedDetails;
  tiffPreview?: TiffPreviewState;
}) {
  const previewId = previewInventoryIdForIndex(index);
  const archivedTitle = resolveArtworkTitle(artwork);
  const plan = artwork.image
    ? planFilenamesForArtwork({
        year: artwork.year.trim(),
        inventoryId: previewId,
        title: archivedTitle,
        masterFilename: artwork.image.file.name,
      })
    : null;

  const exhibition = effectiveOverride(
    artwork.overrides.exhibition,
    shared.exhibition,
  );
  const gallery = effectiveOverride(
    artwork.overrides.gallery,
    shared.gallery,
  );
  const photographer = effectiveOverride(
    artwork.overrides.photographer,
    shared.photographer,
  );

  return (
    <article
      id={`review-artwork-${artwork.id}`}
      className="border border-[var(--line)] bg-[var(--surface)] p-4 sm:p-5"
    >
      <div className="grid gap-5 lg:grid-cols-[10rem_minmax(0,1fr)]">
        <div>
          <div className="h-36 w-full overflow-hidden bg-[var(--surface-muted)] sm:h-40">
            <ArtworkImageThumb
              image={artwork.image}
              tiffPreview={tiffPreview}
              className="h-full w-full object-cover"
            />
          </div>
          {artwork.image ? (
            <div className="mt-2 space-y-0.5">
              <p className="text-xs text-[var(--muted)]">
                {describeImageType(artwork.image.file)} ·{" "}
                {formatFileSize(artwork.image.file.size)}
              </p>
              <ArtworkImageThumbFooterNote
                image={artwork.image}
                tiffPreview={tiffPreview}
              />
            </div>
          ) : null}
        </div>

        <div>
          <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]">
            Artwork {formatArtworkNumber(index)} · Preview inventory{" "}
            {previewId}
          </p>
          <h3 className="mt-1 font-display text-2xl text-[var(--ink)]">
            {archivedTitle}
          </h3>
          {artwork.image &&
          requiresLargeFileDropboxIntake(artwork.image.file.size) ? (
            <p className="mt-2 text-sm text-[var(--ink)]">
              This master is over {MAX_FILE_SIZE_LABEL}. Direct upload cannot
              be used. Prepare large-file intake, then upload through Dropbox.
              Preview availability does not affect whether the original file
              can be added.
            </p>
          ) : null}
          <dl className="mt-3">
            <MetaRow label="Title" value={archivedTitle} />
            <MetaRow label="Year" value={artwork.year} />
            <MetaRow label="Medium" value={artwork.medium} />
            <MetaRow label="Dimensions" value={formatDimensions(artwork)} />
            <MetaRow label="Exhibition" value={exhibition} />
            <MetaRow label="Gallery / Venue" value={gallery} />
            <MetaRow label="Photographer" value={photographer} />
            <MetaRow label="Notes" value={artwork.notes} />
          </dl>

          {plan ? (
            <div className="mt-4 max-w-xl">
              <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
                Planned filenames (preview IDs only)
              </p>
              <ul className="mt-2 space-y-2">
                <li>
                  <FilenameDisplay
                    filename={plan.master}
                    label="planned master"
                  />
                </li>
                <li>
                  <FilenameDisplay
                    filename={plan.hr}
                    label="planned high-resolution JPG"
                  />
                </li>
                <li>
                  <FilenameDisplay filename={plan.web} label="planned web JPG" />
                </li>
                <li>
                  <FilenameDisplay
                    filename={plan.thumb}
                    label="planned thumbnail JPG"
                  />
                </li>
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function BatchReview({
  shared,
  artworks,
  tiffPreviewByArtworkId = {},
  onBack,
  onReset,
  archiveTarget,
}: BatchReviewProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [submitError, setSubmitError] = useState<SubmitFailureInfo | null>(
    null,
  );
  const [intakeProgress, setIntakeProgress] = useState<IntakeProgressItem[]>(
    [],
  );
  const [largeFilePanels, setLargeFilePanels] = useState<LargeFilePanelState[]>(
    [],
  );
  const [submissionResult, setSubmissionResult] = useState<Extract<
    BatchSubmissionResult,
    { ok: true }
  > | null>(null);
  const attemptIdRef = useRef<string | null>(null);
  const preparedRef = useRef<PreparedArtwork[] | null>(null);
  const submitStartedRef = useRef<number | null>(null);
  const submitLockRef = useRef(false);

  const locked = submitting || Boolean(submissionResult) || largeFilePanels.length > 0;

  const sourceBytes = totalSourceBytes(artworks);
  const largeMasterCount = artworks.filter(
    (artwork) =>
      artwork.image && requiresLargeFileDropboxIntake(artwork.image.file.size),
  ).length;

  useEffect(() => {
    if (!submitting) return;
    const timer = window.setInterval(() => {
      const started = submitStartedRef.current;
      if (!started) return;
      setElapsedSec(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [submitting]);

  function openConfirm() {
    if (submitLockRef.current || submitting) return;
    if (!attemptIdRef.current) {
      attemptIdRef.current = crypto.randomUUID();
    }
    setSubmitError(null);
    setConfirmOpen(true);
  }

  function stopSubmitting() {
    submitLockRef.current = false;
    setSubmitting(false);
  }

  async function runSubmit() {
    if (submitLockRef.current || submitting || !attemptIdRef.current) return;

    submitLockRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    setConfirmOpen(false);
    scrollBatchPageToTop();
    submitStartedRef.current = Date.now();
    setElapsedSec(0);
    setIntakeProgress(
      artworks.map((artwork) => ({
        title: artwork.title || "Untitled",
        stage: "Preparing inventory claims…",
        percent: null,
        error: null,
      })),
    );

    const payload = batchDraftToSubmissionPayload({ shared, artworks });
    const files = artworks.flatMap((artwork) =>
      artwork.image
        ? [
            {
              clientArtworkId: artwork.id,
              filename: artwork.image.file.name,
              mimeType: artwork.image.file.type,
              byteLength: artwork.image.file.size,
            },
          ]
        : [],
    );
    const filesById = new Map(
      artworks
        .filter((artwork) => artwork.image)
        .map((artwork) => [artwork.id, artwork.image!.file]),
    );

    const setItem = (
      clientArtworkId: string,
      title: string,
      patch: Partial<IntakeProgressItem>,
    ) => {
      setIntakeProgress((current) => {
        const next = [...current];
        const index = next.findIndex((item) => item.title === title);
        const item: IntakeProgressItem = {
          title,
          stage: patch.stage ?? next[index]?.stage ?? "Starting…",
          percent: patch.percent ?? next[index]?.percent ?? null,
          error: patch.error ?? next[index]?.error ?? null,
        };
        if (index >= 0) next[index] = item;
        else next.push(item);
        void clientArtworkId;
        return next;
      });
    };

    let firstFailure: SubmitFailureInfo | null = null;
    const recordFailure = (failure: SubmitFailureInfo) => {
      if (!firstFailure) firstFailure = failure;
    };

    try {
      const prepareResponse = await fetch("/api/artwork-batches/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionAttemptId: attemptIdRef.current,
          shared: payload.shared,
          artworks: payload.artworks,
          files,
          retryClaims: (preparedRef.current ?? []).map((entry) => ({
            clientArtworkId: entry.clientArtworkId,
            claimId: entry.claimId,
            inventoryId: entry.inventoryId,
          })),
        }),
      });
      const prepared = (await prepareResponse.json()) as
        | {
            ok: true;
            kind: "prepared";
            submissionAttemptId: string;
            archiveTarget: "test" | "production";
            sheetUrl: string | null;
            driveRootUrl: string | null;
            artworks: PreparedArtwork[];
          }
        | Extract<BatchSubmissionResult, { ok: false }>;

      if (!prepared.ok) {
        setSubmitError({
          message: prepared.message,
          stage: "Preparing inventory claims",
        });
        stopSubmitting();
        if (prepared.kind === "duplicate_attempt") {
          attemptIdRef.current = crypto.randomUUID();
          preparedRef.current = null;
        }
        return;
      }

      preparedRef.current = prepared.artworks;
      const results: ArtworkSubmissionResult[] = [];
      const nextLargePanels: LargeFilePanelState[] = [];

      for (const ready of prepared.artworks) {
        const artwork = payload.artworks.find(
          (entry) => entry.clientArtworkId === ready.clientArtworkId,
        );
        const file = filesById.get(ready.clientArtworkId);
        const title =
          artworks.find((entry) => entry.id === ready.clientArtworkId)?.title ||
          ready.masterFilename;
        if (!artwork || !file) {
          const message = "Source file is missing from this browser session.";
          recordFailure({
            message,
            stage: "Preparing",
            inventoryId: ready.inventoryId,
          });
          setItem(ready.clientArtworkId, title, {
            stage: "Failed",
            error: message,
          });
          continue;
        }

        if (
          ready.requiresManualDropboxUpload ||
          requiresLargeFileDropboxIntake(file.size)
        ) {
          nextLargePanels.push({
            clientArtworkId: ready.clientArtworkId,
            title,
            claimId: ready.claimId,
            inventoryId: ready.inventoryId,
            folderName: ready.folderName,
            masterFilename: ready.masterFilename,
            folderWebUrl: ready.folderWebUrl,
            status: ready.masterAlreadyUploaded
              ? "master_found"
              : "waiting_for_dropbox",
            message: ready.masterAlreadyUploaded
              ? "Master file found"
              : "",
            canContinueProcessing: Boolean(ready.masterAlreadyUploaded),
            byteLengthLabel: formatFileSize(file.size),
          });
          setItem(ready.clientArtworkId, title, {
            stage: "Waiting for Dropbox upload",
            percent: null,
            error: null,
          });
          continue;
        }

        setItem(ready.clientArtworkId, title, {
          stage: ready.masterAlreadyUploaded
            ? "Master already in Dropbox"
            : "Requesting upload link…",
          percent: ready.masterAlreadyUploaded ? 1 : 0,
          error: null,
        });

        const linkResponse = await fetch("/api/artwork-batches/upload-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            claimId: ready.claimId,
            inventoryId: ready.inventoryId,
            clientArtworkId: ready.clientArtworkId,
            filename: ready.masterFilename,
            dropboxPath: ready.masterPath,
            mimeType: file.type,
            byteLength: file.size,
            year: artwork.year,
            title: artwork.title,
            originalFilename: artwork.originalFilename,
          }),
        });
        const linkJson = (await linkResponse.json()) as
          | {
              ok: true;
              alreadyUploaded: boolean;
              uploadUrl?: string;
            }
          | { ok: false; message: string };

        if (!linkJson.ok) {
          recordFailure({
            message: linkJson.message,
            stage: "Requesting upload link",
            inventoryId: ready.inventoryId,
          });
          setItem(ready.clientArtworkId, title, {
            stage: "Upload link failed",
            error: linkJson.message,
          });
          continue;
        }

        if (!linkJson.alreadyUploaded) {
          if (!linkJson.uploadUrl) {
            const message = "Dropbox did not return an upload link.";
            recordFailure({
              message,
              stage: "Requesting upload link",
              inventoryId: ready.inventoryId,
            });
            setItem(ready.clientArtworkId, title, {
              stage: "Upload link failed",
              error: message,
            });
            continue;
          }
          setItem(ready.clientArtworkId, title, {
            stage: "Uploading master to Dropbox…",
            percent: 0,
          });
          try {
            await uploadMasterToTemporaryLink({
              uploadUrl: linkJson.uploadUrl,
              file,
              onProgress: (ratio) => {
                setItem(ready.clientArtworkId, title, {
                  stage: "Uploading master to Dropbox…",
                  percent: ratio,
                });
              },
            });
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : "Dropbox rejected the master upload.";
            recordFailure({
              message,
              stage: "Uploading master to Dropbox",
              inventoryId: ready.inventoryId,
            });
            setItem(ready.clientArtworkId, title, {
              stage: "Master upload failed",
              error: message,
            });
            continue;
          }
        }

        setItem(ready.clientArtworkId, title, {
          stage: "Generating all file sizes",
          percent: 1,
        });

        const processResponse = await fetch("/api/artwork-batches/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            submissionAttemptId: attemptIdRef.current,
            artwork,
            shared: payload.shared,
            claimId: ready.claimId,
            inventoryId: ready.inventoryId,
            dropboxPath: ready.masterPath,
          }),
        });
        const processResult =
          (await processResponse.json()) as ArtworkSubmissionResult;
        results.push(processResult);
        if (!processResult.ok) {
          recordFailure({
            message: processResult.message || "Processing failed",
            stage: processResult.failedOperation
              ? processResult.failedOperation.replace(/_/g, " ")
              : "Processing",
            inventoryId: processResult.inventoryId,
          });
        }
        setItem(ready.clientArtworkId, title, {
          stage: processResult.ok
            ? "Completed"
            : processResult.message || "Processing failed",
          percent: 1,
          error: processResult.ok ? null : processResult.message,
        });
      }

      const completed = results.filter(
        (result) => result.ok && result.stage === "completed",
      ).length;
      const reconciliationRequired = results.filter(
        (result) => result.ok && result.stage === "reconciliation_required",
      ).length;
      const failed = results.filter((result) => !result.ok).length;

      if (nextLargePanels.length > 0) {
        setLargeFilePanels(nextLargePanels);
        stopSubmitting();
        return;
      }

      if (results.length === 0) {
        setSubmitError(
          firstFailure ?? {
            message:
              "No artworks were processed. Check the upload errors and retry.",
          },
        );
        stopSubmitting();
        return;
      }

      setSubmissionResult({
        ok: true,
        kind: "completed",
        submissionAttemptId: prepared.submissionAttemptId,
        archiveTarget: prepared.archiveTarget,
        completedAt: new Date().toISOString(),
        total: results.length,
        completed,
        failed,
        reconciliationRequired,
        artworks: results,
        sheetUrl: prepared.sheetUrl,
        driveRootUrl: prepared.driveRootUrl,
      });
      stopSubmitting();
    } catch {
      setSubmitError(
        firstFailure ?? {
          message:
            "Could not finish submission. The master may already be in Dropbox. Retry processing before starting a new attempt.",
        },
      );
      stopSubmitting();
    }
  }

  async function checkLargeFilePanel(claimId: string, inventoryId: number) {
    setLargeFilePanels((current) =>
      current.map((entry) =>
        entry.claimId === claimId ? { ...entry, checking: true } : entry,
      ),
    );
    try {
      const response = await fetch("/api/artwork-batches/check-master", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimId, inventoryId }),
      });
      const data = (await response.json()) as
        | LargeFileCheckResult
        | { ok: false; message: string };
      setLargeFilePanels((current) =>
        current.map((entry) => {
          if (entry.claimId !== claimId) return entry;
          if (!data.ok) {
            return {
              ...entry,
              checking: false,
              message: data.message,
              canContinueProcessing: false,
            };
          }
          return {
            ...entry,
            checking: false,
            status: data.status,
            message: data.message,
            folderWebUrl: data.folderWebUrl,
            canContinueProcessing: data.canContinueProcessing,
            byteLengthLabel:
              data.byteLength != null
                ? formatFileSize(data.byteLength)
                : entry.byteLengthLabel,
            dimensionsLabel: largeFileDimensionsLabel(data),
          };
        }),
      );
    } catch {
      setLargeFilePanels((current) =>
        current.map((entry) =>
          entry.claimId === claimId
            ? {
                ...entry,
                checking: false,
                message: "Could not check Dropbox for this master.",
                canContinueProcessing: false,
              }
            : entry,
        ),
      );
    }
  }

  async function continueLargeFilePanel(claimId: string, inventoryId: number) {
    setLargeFilePanels((current) =>
      current.map((entry) =>
        entry.claimId === claimId
          ? { ...entry, processing: true, status: "processing" }
          : entry,
      ),
    );
    try {
      const response = await fetch("/api/artwork-batches/large-file/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimId, inventoryId }),
      });
      const data = (await response.json()) as
        | ArtworkSubmissionResult
        | { ok: false; errorCode?: string; message: string; status?: LargeFileIntakeStatus };
      setLargeFilePanels((current) =>
        current.map((entry) => {
          if (entry.claimId !== claimId) return entry;
          if (data.ok) {
            return {
              ...entry,
              processing: false,
              status: "completed" as const,
              message: "Artwork added to the archive",
              canContinueProcessing: false,
            };
          }
          const nextStatus = statusFromLargeFileProcessError(data);
          return {
            ...entry,
            processing: false,
            status: nextStatus,
            message: data.message,
            canContinueProcessing: false,
          };
        }),
      );
    } catch {
      setLargeFilePanels((current) =>
        current.map((entry) =>
          entry.claimId === claimId
            ? {
                ...entry,
                processing: false,
                status: "failed",
                message: "Processing failed. The inventory ID was not replaced.",
                canContinueProcessing: false,
              }
            : entry,
        ),
      );
    }
  }

  if (submissionResult) {
    return (
      <BatchSubmissionReport
        result={submissionResult}
        onStartNewBatch={onReset}
      />
    );
  }

  return (
    <>
      <div className="animate-fade-in">
        <header className="max-w-2xl">
          <p className="text-xs uppercase tracking-[0.22em] text-[var(--accent)]">
            Kim&apos;s Artwork Archive
          </p>
          <BatchStepHeading className="mt-3">Review batch</BatchStepHeading>
          <p className="mt-4 text-[var(--muted)] leading-relaxed">
            {largeFilePanels.length > 0
              ? largeFileNeedsUploadHeading(largeFilePanels.length)
              : `${artworks.length} artwork${artworks.length === 1 ? "" : "s"} ready for review. Preview inventory numbers are temporary.`}
          </p>
        </header>

        {archiveTarget === "test" ? (
          <div
            role="status"
            className="mt-6 border-2 border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]"
          >
            <p className="font-medium uppercase tracking-[0.14em]">
              Test archive active
            </p>
            <p className="mt-1">
              Submit Batch will write to the TEST Sheet and Dropbox App Folder. It
              will not fall back to production.
            </p>
          </div>
        ) : null}

        {submitting ? (
          <BatchSubmittingStatusView
            artworkCount={artworks.length}
            elapsedSec={elapsedSec}
            items={intakeProgress}
          />
        ) : largeFilePanels.length > 0 ? null : (
          <div
            role="status"
            className="mt-8 border border-[var(--accent)] bg-[var(--accent-soft)] px-4 py-4 text-sm text-[var(--ink)]"
          >
            <p className="font-medium">
              Review the artwork details below. Final inventory numbers will be
              assigned when you submit.
            </p>
            {largeMasterCount > 0 ? (
              <p className="mt-1 text-[var(--muted)]">
                {largeMasterCount} master{largeMasterCount === 1 ? "" : "s"} exceed{" "}
                {MAX_FILE_SIZE_LABEL} and will use Dropbox intake instead of a
                direct upload.
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={locked}
                onClick={openConfirm}
                className="border border-[var(--ink)] bg-[var(--ink)] px-4 py-2 text-xs uppercase tracking-[0.12em] text-[var(--paper)] transition enabled:hover:bg-[var(--ink-soft)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              >
                {largeMasterCount > 0
                  ? "Prepare large-file intake"
                  : "Submit Batch"}
              </button>
            </div>
          </div>
        )}

        {largeFilePanels.length > 0 ? (
          <section className="mt-8 space-y-4" aria-label="Large-file upload">
            {largeFilePanels.map((panel) => (
              <LargeMasterIntakePanel
                key={panel.claimId}
                inventoryId={panel.inventoryId}
                title={panel.title}
                folderName={panel.folderName}
                masterFilename={panel.masterFilename}
                folderWebUrl={panel.folderWebUrl}
                status={panel.status}
                message={panel.message}
                byteLengthLabel={panel.byteLengthLabel}
                dimensionsLabel={panel.dimensionsLabel}
                checking={panel.checking}
                processing={panel.processing}
                canContinueProcessing={panel.canContinueProcessing}
                onCheck={() => {
                  void checkLargeFilePanel(panel.claimId, panel.inventoryId);
                }}
                onContinue={() => {
                  void continueLargeFilePanel(panel.claimId, panel.inventoryId);
                }}
                onStartNewBatch={
                  largeFilePanels.every((entry) => entry.status === "completed")
                    ? onReset
                    : undefined
                }
              />
            ))}
          </section>
        ) : null}

        {submitError ? <BatchSubmitFailureView failure={submitError} /> : null}

        {largeFilePanels.length === 0 ? (
          <>
            <section
              className="mt-10 space-y-6"
              aria-labelledby="review-artworks-heading"
            >
              <h2
                id="review-artworks-heading"
                className="font-display text-xl text-[var(--ink)]"
              >
                Artworks
              </h2>

              {artworks.map((artwork, index) => (
                <ReviewArtworkCard
                  key={artwork.id}
                  artwork={artwork}
                  index={index}
                  shared={shared}
                  tiffPreview={tiffPreviewByArtworkId[artwork.id]}
                />
              ))}
            </section>

            <div className="mt-10 flex flex-col-reverse gap-3 border-t border-[var(--line)] pt-6 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={locked}
                onClick={onReset}
                className="px-5 py-3 text-sm uppercase tracking-[0.14em] text-[var(--muted)] transition hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              >
                Reset Batch
              </button>
              <button
                type="button"
                disabled={locked}
                onClick={onBack}
                className="border border-[var(--ink)] bg-[var(--ink)] px-6 py-3 text-sm uppercase tracking-[0.14em] text-[var(--paper)] transition hover:bg-[var(--ink-soft)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              >
                Back to Edit
              </button>
            </div>
          </>
        ) : null}

      </div>
      {confirmOpen && !submitting ? (
        <BatchSubmitConfirmationView
          artworkCount={artworks.length}
          sourceBytes={sourceBytes}
          largeFileCount={largeMasterCount}
          onConfirm={() => {
            void runSubmit();
          }}
          onBack={() => {
            setConfirmOpen(false);
            attemptIdRef.current = null;
          }}
        />
      ) : null}
    </>
  );
}
