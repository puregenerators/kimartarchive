"use client";

import { useEffect, useRef, useState } from "react";
import { BatchSubmissionReport } from "@/components/artwork/BatchSubmissionReport";
import { BatchSubmittingStatusView, type IntakeProgressItem } from "@/components/artwork/BatchSubmittingStatusView";
import { FilenameDisplay } from "@/components/artwork/FilenameDisplay";
import {
  ArtworkImageThumb,
  ArtworkImageThumbFooterNote,
} from "@/components/artwork/ArtworkImageThumb";
import { ProcessingResultPanel } from "@/components/artwork/ProcessingResultPanel";
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
import type {
  ArtworkProcessingState,
  ArtworkProcessingSuccess,
  ProcessArtworkImageApiFailure,
  ProcessArtworkImageApiSuccess,
} from "@/lib/images/client-types";
import {
  buildImageProcessingFingerprint,
  isProcessingResultStale,
} from "@/lib/images/fingerprint";
import {
  buildSourceFileFingerprint,
  resolveTiffPreviewUrl,
  type TiffPreviewState,
} from "@/lib/images/preview-client";
import {
  batchDraftToSubmissionPayload,
} from "@/lib/submission/validate-input";
import { uploadMasterToTemporaryLink } from "@/lib/submission/browser-master-upload";
import { LargeMasterIntakePanel } from "@/components/artwork/LargeMasterIntakePanel";
import type { PreparedArtwork } from "@/lib/submission/direct-intake-types";
import type {
  LargeFileCheckResult,
  LargeFileIntakeStatus,
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
  result?: ArtworkSubmissionResult;
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
  processingByArtworkId: Record<string, ArtworkProcessingState>;
  tiffPreviewByArtworkId?: Record<string, TiffPreviewState>;
  onProcessingChange: (
    artworkId: string,
    state: ArtworkProcessingState,
  ) => void;
  onBack: () => void;
  onReset: () => void;
  archiveTarget: ArchiveTargetProp;
};

function isFreshSuccess(
  artwork: ArtworkDraft,
  index: number,
  processing: ArtworkProcessingState,
): boolean {
  if (processing.status !== "success" || !artwork.image) return false;
  return !isProcessingResultStale(processing.fingerprint, {
    title: resolveArtworkTitle(artwork),
    year: artwork.year,
    previewInventoryId: previewInventoryIdForIndex(index),
    imageName: artwork.image.file.name,
    imageSize: artwork.image.file.size,
    imageLastModified: artwork.image.file.lastModified,
  });
}

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

function resolveSuccess(
  state: ArtworkProcessingState,
): ArtworkProcessingSuccess | null {
  if (state.status === "success") return state;
  if (state.status === "stale") return state.previous;
  return null;
}

function statusLabel(
  state: ArtworkProcessingState,
  stale: boolean,
): string {
  if (state.status === "processing") return "Processing";
  if (state.status === "error") return "Processing failed";
  if (state.status === "success" && stale) return "Processed (stale)";
  if (state.status === "success") return "Processed successfully";
  if (state.status === "stale") return "Processed (stale)";
  return "Not tested";
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
  processing,
  tiffPreview,
  onProcessingChange,
  autoTestToken,
  onAutoTestConsumed,
  locked,
}: {
  artwork: ArtworkDraft;
  index: number;
  shared: BatchSharedDetails;
  processing: ArtworkProcessingState;
  tiffPreview?: TiffPreviewState;
  onProcessingChange: (state: ArtworkProcessingState) => void;
  autoTestToken?: number | null;
  onAutoTestConsumed?: () => void;
  locked: boolean;
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

  const fingerprintInput = artwork.image
    ? {
        title: archivedTitle,
        year: artwork.year,
        previewInventoryId: previewId,
        imageName: artwork.image.file.name,
        imageSize: artwork.image.file.size,
        imageLastModified: artwork.image.file.lastModified,
      }
    : null;

  const fingerprint = fingerprintInput
    ? buildImageProcessingFingerprint(fingerprintInput)
    : null;

  const successResult = resolveSuccess(processing);
  const stale =
    Boolean(successResult) &&
    Boolean(fingerprintInput) &&
    isProcessingResultStale(successResult!.fingerprint, fingerprintInput!);

  async function handleTestProcessing() {
    if (!artwork.image || !plan || !fingerprint) return;
    if (processing.status === "processing" || locked) return;

    onProcessingChange({ status: "processing" });

    try {
      const body = new FormData();
      body.set("file", artwork.image.file);
      body.set("artworkId", artwork.id);
      body.set("originalFilename", artwork.image.file.name);
      body.set("title", archivedTitle);
      body.set("year", artwork.year.trim());
      body.set("inventoryId", String(previewId));
      body.set("masterFilename", plan.master);
      body.set("hrFilename", plan.hr);
      body.set("webFilename", plan.web);
      body.set("thumbFilename", plan.thumb);

      const response = await fetch("/api/dev/process-artwork-image", {
        method: "POST",
        body,
      });

      const data = (await response.json()) as
        | ProcessArtworkImageApiSuccess
        | ProcessArtworkImageApiFailure;

      if (!response.ok || !data.ok) {
        const failure = data as ProcessArtworkImageApiFailure;
        onProcessingChange({
          status: "error",
          fingerprint,
          code: failure.error?.code ?? "SHARP_DECODE_FAILURE",
          message:
            failure.error?.message ??
            "Image processing failed. Check the source file and try again.",
        });
        return;
      }

      onProcessingChange({
        status: "success",
        fingerprint,
        resultId: data.resultId,
        expiresAt: data.expiresAt,
        durationMs: data.durationMs,
        warnings: data.warnings,
        source: data.source,
        master: data.master,
        hr: data.hr,
        web: data.web,
        thumb: data.thumb,
        comparisons: data.comparisons,
      });
    } catch {
      onProcessingChange({
        status: "error",
        fingerprint,
        code: "SHARP_DECODE_FAILURE",
        message:
          "Could not reach the local processing endpoint. Is the app running?",
      });
    }
  }

  useEffect(() => {
    if (autoTestToken == null) return;
    onAutoTestConsumed?.();
    void handleTestProcessing();
    // Intentionally keyed only on the auto-test token from the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTestToken]);

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

  const isBusy = processing.status === "processing";

  const sourcePreviewUrl = (() => {
    if (!artwork.image) return null;
    if (artwork.image.previewUrl) return artwork.image.previewUrl;
    if (!artwork.image.isTiff) return null;
    return resolveTiffPreviewUrl(
      tiffPreview,
      buildSourceFileFingerprint({
        imageName: artwork.image.file.name,
        imageSize: artwork.image.file.size,
        imageLastModified: artwork.image.file.lastModified,
      }),
    );
  })();

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

          {plan && (!successResult || stale) ? (
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

          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-[var(--line)] pt-4">
            <button
              type="button"
              disabled={
                !artwork.image ||
                !plan ||
                isBusy ||
                locked ||
                requiresLargeFileDropboxIntake(artwork.image.file.size)
              }
              onClick={() => {
                void handleTestProcessing();
              }}
              className="border border-[var(--ink)] bg-[var(--ink)] px-4 py-2 text-xs uppercase tracking-[0.12em] text-[var(--paper)] transition enabled:hover:bg-[var(--ink-soft)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              {isBusy
              ? "Processing…"
              : artwork.image &&
                  requiresLargeFileDropboxIntake(artwork.image.file.size)
                ? "Use Dropbox intake"
                : "Test image processing"}
            </button>
            <p className="text-sm text-[var(--muted)]" aria-live="polite">
              Status:{" "}
              <span className="text-[var(--ink)]">
                {statusLabel(processing, stale)}
              </span>
            </p>
          </div>

          {processing.status === "error" ? (
            <div
              role="alert"
              className="mt-4 border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]"
            >
              <p className="font-medium">
                Processing failed for artwork {formatArtworkNumber(index)}
              </p>
              <p className="mt-1">{processing.message}</p>
              <p className="mt-1 text-xs opacity-80">{processing.code}</p>
            </div>
          ) : null}

          {successResult ? (
            <ProcessingResultPanel
              result={successResult}
              sourcePreviewUrl={sourcePreviewUrl}
              isTiff={Boolean(artwork.image?.isTiff)}
              stale={stale}
            />
          ) : null}
        </div>
      </div>
    </article>
  );
}

function SharedMetaRows({ shared }: { shared: BatchSharedDetails }) {
  return (
    <>
      <MetaRow label="Exhibition" value={shared.exhibition} />
      <MetaRow label="Gallery / Venue" value={shared.gallery} />
      <MetaRow label="Exhibition year" value={shared.exhibitionYear} />
      <MetaRow label="Photographer" value={shared.photographer} />
    </>
  );
}

function sharedHasValues(shared: BatchSharedDetails): boolean {
  return (
    shared.exhibition.trim() !== "" ||
    shared.gallery.trim() !== "" ||
    shared.exhibitionYear.trim() !== "" ||
    shared.photographer.trim() !== ""
  );
}

export function BatchReview({
  shared,
  artworks,
  processingByArtworkId,
  tiffPreviewByArtworkId = {},
  onProcessingChange,
  onBack,
  onReset,
  archiveTarget,
}: BatchReviewProps) {
  const [autoTest, setAutoTest] = useState<{
    artworkId: string;
    token: number;
  } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
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
  const directResultsRef = useRef<ArtworkSubmissionResult[]>([]);
  const preparedMetaRef = useRef<{
    submissionAttemptId: string;
    archiveTarget: "test" | "production";
    sheetUrl: string | null;
    driveRootUrl: string | null;
  } | null>(null);

  const anyBusy = artworks.some(
    (artwork) => processingByArtworkId[artwork.id]?.status === "processing",
  );
  const locked = submitting || Boolean(submissionResult) || largeFilePanels.length > 0;

  const nextUnprocessed = artworks.find((artwork, index) => {
    const state = processingByArtworkId[artwork.id] ?? { status: "idle" };
    if (state.status === "processing") return false;
    return !isFreshSuccess(artwork, index, state);
  });

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

  function testNextUnprocessed() {
    if (!nextUnprocessed || anyBusy || locked) return;
    document
      .getElementById(`review-artwork-${nextUnprocessed.id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
    setAutoTest({
      artworkId: nextUnprocessed.id,
      token: Date.now(),
    });
  }

  function openConfirm() {
    if (!attemptIdRef.current) {
      attemptIdRef.current = crypto.randomUUID();
    }
    setConfirmed(false);
    setSubmitError(null);
    setConfirmOpen(true);
  }

  async function runSubmit() {
    if (!confirmed || submitting || !attemptIdRef.current) return;

    setSubmitting(true);
    setSubmitError(null);
    setConfirmOpen(false);
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
        setSubmitError(prepared.message);
        setSubmitting(false);
        if (prepared.kind === "duplicate_attempt") {
          attemptIdRef.current = crypto.randomUUID();
          preparedRef.current = null;
        }
        return;
      }

      preparedRef.current = prepared.artworks;
      preparedMetaRef.current = {
        submissionAttemptId: prepared.submissionAttemptId,
        archiveTarget: prepared.archiveTarget,
        sheetUrl: prepared.sheetUrl,
        driveRootUrl: prepared.driveRootUrl,
      };
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
          setItem(ready.clientArtworkId, title, {
            stage: "Failed",
            error: "Source file is missing from this browser session.",
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
              ? "A file is already at the reserved master path. Check it before continuing."
              : "Inventory ID reserved. Upload the expected filename through Dropbox, then check.",
            canContinueProcessing: false,
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
          setItem(ready.clientArtworkId, title, {
            stage: "Upload link failed",
            error: linkJson.message,
          });
          continue;
        }

        if (!linkJson.alreadyUploaded) {
          if (!linkJson.uploadUrl) {
            setItem(ready.clientArtworkId, title, {
              stage: "Upload link failed",
              error: "Dropbox did not return an upload link.",
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
            setItem(ready.clientArtworkId, title, {
              stage: "Master upload failed",
              error:
                error instanceof Error
                  ? error.message
                  : "Dropbox rejected the master upload.",
            });
            continue;
          }
        }

        setItem(ready.clientArtworkId, title, {
          stage: "Generating derivatives…",
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
        directResultsRef.current = results;
        setLargeFilePanels(nextLargePanels);
        setSubmitting(false);
        return;
      }

      if (results.length === 0) {
        setSubmitError("No artworks were processed. Check the upload errors and retry.");
        setSubmitting(false);
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
      setSubmitting(false);
    } catch {
      setSubmitError(
        "Could not finish submission. The master may already be in Dropbox. Retry processing before starting a new attempt.",
      );
      setSubmitting(false);
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
              status: "failed",
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
              data.byteLength != null ? formatFileSize(data.byteLength) : null,
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
                status: "failed",
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
        | { ok: false; errorCode?: string; message: string };
      setLargeFilePanels((current) => {
        const next = current.map((entry) => {
          if (entry.claimId !== claimId) return entry;
          if (data.ok) {
            return {
              ...entry,
              processing: false,
              status: "completed" as const,
              message: "Derivatives, metadata, and the inventory row are complete.",
              canContinueProcessing: false,
              result: data,
            };
          }
          const local =
            "errorCode" in data && data.errorCode === "LOCAL_PROCESSING_REQUIRED";
          const nextStatus: LargeFileIntakeStatus = local
            ? "local_processing_required"
            : "failed";
          return {
            ...entry,
            processing: false,
            status: nextStatus,
            message: data.message,
            canContinueProcessing: false,
            result:
              "ok" in data && data.ok === false && "stage" in data
                ? data
                : undefined,
          };
        });
        const terminal = next.every(
          (entry) =>
            entry.status === "completed" ||
            entry.status === "failed" ||
            entry.status === "local_processing_required",
        );
        if (terminal && preparedMetaRef.current) {
          const largeResults = next
            .map((entry) => entry.result)
            .filter((entry): entry is ArtworkSubmissionResult => Boolean(entry));
          const artworks = [...directResultsRef.current, ...largeResults];
          if (artworks.length > 0) {
            queueMicrotask(() => {
              setSubmissionResult({
                ok: true,
                kind: "completed",
                submissionAttemptId: preparedMetaRef.current!.submissionAttemptId,
                archiveTarget: preparedMetaRef.current!.archiveTarget,
                completedAt: new Date().toISOString(),
                total: artworks.length,
                completed: artworks.filter(
                  (result) => result.ok && result.stage === "completed",
                ).length,
                failed: artworks.filter((result) => !result.ok).length,
                reconciliationRequired: artworks.filter(
                  (result) => result.ok && result.stage === "reconciliation_required",
                ).length,
                artworks,
                sheetUrl: preparedMetaRef.current!.sheetUrl,
                driveRootUrl: preparedMetaRef.current!.driveRootUrl,
              });
            });
          }
        }
        return next;
      });
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
    <div className="animate-fade-in">
      <header className="max-w-2xl">
        <p className="text-xs uppercase tracking-[0.22em] text-[var(--accent)]">
          Kim&apos;s Artwork Archive
        </p>
        <h1 className="mt-3 font-display text-4xl tracking-tight text-[var(--ink)] sm:text-5xl">
          Review batch
        </h1>
        <p className="mt-4 text-[var(--muted)] leading-relaxed">
          {artworks.length} artwork{artworks.length === 1 ? "" : "s"} ready for
          review. Preview inventory numbers are temporary.
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
        >
          {sharedHasValues(shared) ? (
            <div className="mt-4 border-t border-[var(--accent)] pt-3">
              <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
                Shared details
              </p>
              <dl>
                <SharedMetaRows shared={shared} />
              </dl>
            </div>
          ) : null}
        </BatchSubmittingStatusView>
      ) : largeFilePanels.length > 0 ? (
        <div
          role="status"
          className="mt-8 border border-[var(--accent)] bg-[var(--accent-soft)] px-4 py-4 text-sm text-[var(--ink)]"
        >
          <p className="font-medium">Large-file intake is waiting on Dropbox</p>
          <p className="mt-1 text-[var(--muted)]">
            Inventory IDs are already claimed. Checking or continuing does not
            allocate a new ID. The Artwork Inventory row is not written until
            processing succeeds.
          </p>
        </div>
      ) : (
        <div
          role="status"
          className="mt-8 border border-[var(--accent)] bg-[var(--accent-soft)] px-4 py-4 text-sm text-[var(--ink)]"
        >
          <p className="font-medium">
            Local preview until you submit. Permanent delivery writes to Dropbox
            and Google Sheets only.
          </p>
          <p className="mt-1 text-[var(--muted)]">
            Preview inventory numbers are not final. Optional: test image
            processing locally before submission. Dev test results are not
            reused for permanent delivery.
            {largeMasterCount > 0
              ? ` ${largeMasterCount} master${largeMasterCount === 1 ? "" : "s"} exceed ${MAX_FILE_SIZE_LABEL} and will use Dropbox intake instead of a direct upload.`
              : ""}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={!nextUnprocessed || anyBusy || locked}
              onClick={testNextUnprocessed}
              className="border border-[var(--line)] bg-[var(--surface-elevated)] px-4 py-2 text-xs uppercase tracking-[0.12em] text-[var(--ink)] transition enabled:hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              {anyBusy
                ? "Processing…"
                : nextUnprocessed
                  ? "Test next unprocessed artwork"
                  : "All artworks tested"}
            </button>
            <button
              type="button"
              disabled={locked || anyBusy}
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
        <section
          className="mt-8 space-y-4"
          aria-labelledby="large-file-intake-heading"
        >
          <h2
            id="large-file-intake-heading"
            className="font-display text-xl text-[var(--ink)]"
          >
            Large master via Dropbox
          </h2>
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
            />
          ))}
        </section>
      ) : null}

      {submitError ? (
        <div
          role="alert"
          className="mt-4 border border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]"
        >
          <p className="font-medium">Submission did not start or failed early</p>
          <p className="mt-1">{submitError}</p>
          <p className="mt-2 text-xs">
            The app does not automatically retry the whole batch. Check
            diagnostic records before creating a new submission attempt.
          </p>
        </div>
      ) : null}

      {confirmOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="submit-confirm-title"
          className="mt-6 border border-[var(--ink)] bg-[var(--surface-elevated)] p-5 shadow-sm"
        >
          <h2
            id="submit-confirm-title"
            className="font-display text-xl text-[var(--ink)]"
          >
            Confirm permanent submission
          </h2>
          {largeMasterCount > 0 ? (
            <p className="mt-2 text-sm text-[var(--muted)]">
              Files over {MAX_FILE_SIZE_LABEL} skip the direct Dropbox upload
              link. This claims inventory IDs, creates reserved folders, and
              waits for a manual Dropbox upload.
            </p>
          ) : null}
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--muted)]">Artworks</dt>
              <dd className="text-[var(--ink)]">{artworks.length}</dd>
            </div>
            {shared.exhibition.trim() ? (
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--muted)]">Exhibition</dt>
                <dd className="text-right text-[var(--ink)]">
                  {shared.exhibition}
                </dd>
              </div>
            ) : null}
            {shared.gallery.trim() ? (
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--muted)]">Gallery / Venue</dt>
                <dd className="text-right text-[var(--ink)]">{shared.gallery}</dd>
              </div>
            ) : null}
            {shared.exhibitionYear.trim() ? (
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--muted)]">Exhibition year</dt>
                <dd className="text-right text-[var(--ink)]">
                  {shared.exhibitionYear}
                </dd>
              </div>
            ) : null}
            {shared.photographer.trim() ? (
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--muted)]">Photographer</dt>
                <dd className="text-right text-[var(--ink)]">
                  {shared.photographer}
                </dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--muted)]">Total source size</dt>
              <dd className="text-[var(--ink)]">
                {formatFileSize(sourceBytes)}
              </dd>
            </div>
          </dl>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-[var(--muted)]">
            <li>Preview inventory numbers are not final.</li>
            <li>Permanent inventory IDs will be assigned from Inventory Claims.</li>
            <li>Files will be written to Dropbox.</li>
            <li>Rows will be written to Google Sheets.</li>
            <li>
              Failed attempts may permanently consume inventory IDs (gaps are
              not reused).
            </li>
            <li>
              This app does not retain the archive after delivery—local files
              and form state are disposable.
            </li>
            <li>
              Refreshing or losing the connection during submission may require
              checking Inventory Claims and Failed Intake before resubmitting.
            </li>
          </ul>
          <label className="mt-5 flex items-start gap-3 text-sm text-[var(--ink)]">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              className="mt-1"
            />
            <span>
              I understand this writes permanent Dropbox files and Sheet rows, and
              that failed inventory IDs remain consumed.
            </span>
          </label>
          <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => {
                setConfirmOpen(false);
                setConfirmed(false);
                attemptIdRef.current = null;
              }}
              className="px-5 py-3 text-sm uppercase tracking-[0.14em] text-[var(--muted)] transition hover:text-[var(--ink)]"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!confirmed}
              onClick={() => {
                void runSubmit();
              }}
              className="border border-[var(--ink)] bg-[var(--ink)] px-6 py-3 text-sm uppercase tracking-[0.14em] text-[var(--paper)] transition enabled:hover:bg-[var(--ink-soft)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {largeMasterCount > 0
                ? "Confirm and prepare intake"
                : "Confirm and submit"}
            </button>
          </div>
        </div>
      ) : null}

      <section className="mt-10" aria-labelledby="review-shared-heading">
        <h2
          id="review-shared-heading"
          className="font-display text-xl text-[var(--ink)]"
        >
          Shared details
        </h2>
        <dl className="mt-3 border border-[var(--line)] bg-[var(--surface)] px-4">
          <SharedMetaRows shared={shared} />
        </dl>
      </section>

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
            processing={
              processingByArtworkId[artwork.id] ?? { status: "idle" }
            }
            tiffPreview={tiffPreviewByArtworkId[artwork.id]}
            onProcessingChange={(state) =>
              onProcessingChange(artwork.id, state)
            }
            autoTestToken={
              autoTest?.artworkId === artwork.id ? autoTest.token : null
            }
            onAutoTestConsumed={() => setAutoTest(null)}
            locked={locked}
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
    </div>
  );
}
