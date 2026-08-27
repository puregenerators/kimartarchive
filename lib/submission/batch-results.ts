/**
 * Normalize, summarize, and present per-artwork batch submission results.
 * Client-safe — no secrets, stack traces, or independent counters.
 */

import type {
  ArtworkSubmissionFailure,
  ArtworkSubmissionResult,
  ArtworkSubmissionStage,
  ArtworkSubmissionSuccess,
  BatchSubmissionResult,
  ClaimStatus,
  CleanupResult,
  DriveResourceRef,
  ReconciliationWarning,
  SubmissionErrorCode,
  SubmissionFailedOperation,
} from "@/lib/submission/types";
import {
  ARTWORK_SUBMISSION_STAGES,
  SUBMISSION_FAILED_OPERATIONS,
  emptyCleanupResult,
} from "@/lib/submission/types";

export type BatchArtworkResultSummary = {
  total: number;
  completed: number;
  failed: number;
  reconciliationRequired: number;
};

export type ArtworkResultIdentity = {
  clientArtworkId: string;
  order: number;
  title: string;
  inventoryId?: number | null;
  claimId?: string | null;
  driveFolder?: DriveResourceRef | null;
  master?: DriveResourceRef | null;
  hr?: DriveResourceRef | null;
  web?: DriveResourceRef | null;
  thumb?: DriveResourceRef | null;
  metadata?: DriveResourceRef | null;
  sheetRowWritten?: boolean;
  lastCompletedStage?: ArtworkSubmissionStage;
  failedOperation?: SubmissionFailedOperation | null;
  errorCode?: SubmissionErrorCode;
  claimStatus?: ClaimStatus | null;
  startedAt?: string | null;
  finishedAt?: string | null;
};

export type PartitionedArtworkResults = {
  successes: ArtworkSubmissionSuccess[];
  failures: ArtworkSubmissionFailure[];
  reconciliations: ArtworkSubmissionSuccess[];
};

const STAGE_SET = new Set<string>(ARTWORK_SUBMISSION_STAGES);
const OPERATION_SET = new Set<string>(SUBMISSION_FAILED_OPERATIONS);

const FAILED_OPERATION_LABELS: Record<SubmissionFailedOperation, string> = {
  mark_claim_processing: "Inventory claim update",
  create_folder: "Dropbox folder creation",
  upload_master: "Master file upload",
  generate_derivatives: "High-resolution generation",
  generate_thumbnail: "Thumbnail generation",
  upload_hr: "High-resolution upload",
  upload_web: "Web version upload",
  upload_thumb: "Thumbnail upload",
  upload_metadata: "Metadata file upload",
  append_inventory_row: "Inventory row creation",
  mark_claim_completed: "Final verification",
};

const STAGE_LABELS: Record<ArtworkSubmissionStage, string> = {
  pending: "Preparation",
  claimed: "Inventory claim",
  processing: "Processing",
  folder_created: "Dropbox folder creation",
  master_uploaded: "Master file upload",
  derivatives_generated: "High-resolution generation",
  hr_uploaded: "High-resolution upload",
  web_uploaded: "Web version upload",
  thumb_uploaded: "Thumbnail upload",
  metadata_uploaded: "Metadata file upload",
  sheet_row_appended: "Inventory row creation",
  completed: "Completion",
  failed: "Processing",
  reconciliation_required: "Final verification",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isStage(value: unknown): value is ArtworkSubmissionStage {
  return typeof value === "string" && STAGE_SET.has(value);
}

function isFailedOperation(value: unknown): value is SubmissionFailedOperation {
  return typeof value === "string" && OPERATION_SET.has(value);
}

function isClaimStatus(value: unknown): value is ClaimStatus {
  return (
    value === "Claimed" ||
    value === "Processing" ||
    value === "Completed" ||
    value === "Failed" ||
    value === "Abandoned"
  );
}

function isDriveRef(value: unknown): value is DriveResourceRef {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.webViewLink === "string"
  );
}

function isReconciliationWarning(value: unknown): value is ReconciliationWarning {
  if (!isRecord(value)) return false;
  return typeof value.code === "string" && typeof value.message === "string";
}

function readCleanup(value: unknown): CleanupResult {
  if (!isRecord(value)) return emptyCleanupResult();
  return {
    tempFilesRemoved: Boolean(value.tempFilesRemoved),
    folderMovedToFailedIntake:
      value.folderMovedToFailedIntake === true
        ? true
        : value.folderMovedToFailedIntake === false
          ? false
          : null,
    cleanupWarnings: Array.isArray(value.cleanupWarnings)
      ? value.cleanupWarnings.filter((entry): entry is string => typeof entry === "string")
      : [],
  };
}

/**
 * Keep only a short, user-facing sentence. Never pass stack traces,
 * tokens, or credential-looking strings through to the UI.
 */
export function userFacingSubmissionMessage(
  message: unknown,
  fallback = "This artwork could not be completed.",
): string {
  if (typeof message !== "string") return fallback;
  const firstLine = message.trim().split(/\r?\n/)[0]?.trim() ?? "";
  if (!firstLine) return fallback;
  if (
    /bearer\s+[a-z0-9._\-]+/i.test(firstLine) ||
    /refresh_token|access_token|api[_-]?key|authorization:/i.test(firstLine)
  ) {
    return fallback;
  }
  if (/\s+at\s+\S+\s+\(/.test(firstLine) || /(?:^|\s)at\s+\S+\.\S+:\d+/.test(firstLine)) {
    return fallback;
  }
  return firstLine.slice(0, 400);
}

export function failedDuringLabel(
  failedOperation: SubmissionFailedOperation | null | undefined,
  stage?: ArtworkSubmissionStage | null,
): string {
  if (failedOperation && FAILED_OPERATION_LABELS[failedOperation]) {
    return FAILED_OPERATION_LABELS[failedOperation];
  }
  if (stage && STAGE_LABELS[stage]) return STAGE_LABELS[stage];
  return "Processing";
}

export function createArtworkSubmissionFailure(
  params: ArtworkResultIdentity & { message: string },
): ArtworkSubmissionFailure {
  const now = new Date().toISOString();
  return {
    ok: false,
    clientArtworkId: params.clientArtworkId,
    order: params.order,
    title: params.title,
    inventoryId: params.inventoryId ?? null,
    claimId: params.claimId ?? null,
    stage: params.lastCompletedStage ?? "failed",
    lastCompletedStage: params.lastCompletedStage ?? "pending",
    failedOperation: params.failedOperation ?? null,
    driveFolder: params.driveFolder ?? null,
    master: params.master ?? null,
    hr: params.hr ?? null,
    web: params.web ?? null,
    thumb: params.thumb ?? null,
    metadata: params.metadata ?? null,
    sheetRowWritten: params.sheetRowWritten ?? false,
    claimStatus: params.claimStatus ?? null,
    cleanup: emptyCleanupResult(),
    startedAt: params.startedAt ?? now,
    finishedAt: params.finishedAt ?? now,
    reconciliationWarnings: [],
    errorCode: params.errorCode ?? "UNKNOWN",
    message: userFacingSubmissionMessage(params.message),
  };
}

function readDriveRef(
  value: unknown,
  fallback: DriveResourceRef | null | undefined,
): DriveResourceRef | null {
  if (isDriveRef(value)) return value;
  return fallback ?? null;
}

export function normalizeArtworkSubmissionResult(
  value: unknown,
  fallback: ArtworkResultIdentity,
): ArtworkSubmissionResult {
  if (isRecord(value) && value.ok === true) {
    const stage = isStage(value.stage) ? value.stage : null;
    if (stage === "completed" || stage === "reconciliation_required") {
      return value as ArtworkSubmissionSuccess;
    }
    return createArtworkSubmissionFailure({
      ...fallback,
      clientArtworkId:
        typeof value.clientArtworkId === "string" && value.clientArtworkId
          ? value.clientArtworkId
          : fallback.clientArtworkId,
      title:
        typeof value.title === "string" && value.title
          ? value.title
          : fallback.title,
      inventoryId:
        typeof value.inventoryId === "number" ? value.inventoryId : fallback.inventoryId,
      claimId: typeof value.claimId === "string" ? value.claimId : fallback.claimId,
      lastCompletedStage: stage ?? fallback.lastCompletedStage ?? "processing",
      message:
        typeof value.message === "string"
          ? value.message
          : "This artwork did not finish in a known state.",
      errorCode: "UNKNOWN",
    });
  }

  if (isRecord(value) && value.ok === false) {
    const lastCompletedStage = isStage(value.lastCompletedStage)
      ? value.lastCompletedStage
      : isStage(value.stage)
        ? value.stage
        : (fallback.lastCompletedStage ?? "pending");
    const warnings = Array.isArray(value.reconciliationWarnings)
      ? value.reconciliationWarnings.filter(isReconciliationWarning)
      : [];
    return {
      ok: false,
      clientArtworkId:
        typeof value.clientArtworkId === "string" && value.clientArtworkId
          ? value.clientArtworkId
          : fallback.clientArtworkId,
      order: typeof value.order === "number" ? value.order : fallback.order,
      title:
        typeof value.title === "string" && value.title
          ? value.title
          : fallback.title,
      inventoryId:
        typeof value.inventoryId === "number"
          ? value.inventoryId
          : (fallback.inventoryId ?? null),
      claimId:
        typeof value.claimId === "string"
          ? value.claimId
          : (fallback.claimId ?? null),
      stage: lastCompletedStage,
      lastCompletedStage,
      failedOperation: isFailedOperation(value.failedOperation)
        ? value.failedOperation
        : (fallback.failedOperation ?? null),
      driveFolder: readDriveRef(value.driveFolder, fallback.driveFolder),
      master: readDriveRef(value.master, fallback.master),
      hr: readDriveRef(value.hr, fallback.hr),
      web: readDriveRef(value.web, fallback.web),
      thumb: readDriveRef(value.thumb, fallback.thumb),
      metadata: readDriveRef(value.metadata, fallback.metadata),
      sheetRowWritten:
        typeof value.sheetRowWritten === "boolean"
          ? value.sheetRowWritten
          : Boolean(fallback.sheetRowWritten),
      claimStatus: isClaimStatus(value.claimStatus)
        ? value.claimStatus
        : (fallback.claimStatus ?? null),
      cleanup: readCleanup(value.cleanup),
      startedAt:
        typeof value.startedAt === "string"
          ? value.startedAt
          : (fallback.startedAt ?? new Date().toISOString()),
      finishedAt:
        typeof value.finishedAt === "string"
          ? value.finishedAt
          : (fallback.finishedAt ?? new Date().toISOString()),
      reconciliationWarnings: warnings,
      errorCode:
        typeof value.errorCode === "string"
          ? (value.errorCode as SubmissionErrorCode)
          : (fallback.errorCode ?? "UNKNOWN"),
      message: userFacingSubmissionMessage(
        value.message,
        "This artwork could not be completed.",
      ),
    };
  }

  return createArtworkSubmissionFailure({
    ...fallback,
    message: "This artwork could not be completed.",
    errorCode: "UNKNOWN",
  });
}

/**
 * Derive batch counts from the result array. Unexpected statuses are counted
 * as failed so they cannot silently vanish from the summary.
 */
export function summarizeBatchArtworkResults(
  artworks: readonly ArtworkSubmissionResult[],
): BatchArtworkResultSummary {
  let completed = 0;
  let failed = 0;
  let reconciliationRequired = 0;

  for (const artwork of artworks) {
    if (artwork.ok && artwork.stage === "completed") {
      completed += 1;
    } else if (artwork.ok && artwork.stage === "reconciliation_required") {
      reconciliationRequired += 1;
    } else {
      failed += 1;
    }
  }

  const total = artworks.length;
  if (completed + failed + reconciliationRequired !== total) {
    failed = total - completed - reconciliationRequired;
  }

  return { total, completed, failed, reconciliationRequired };
}

export function partitionBatchArtworkResults(
  artworks: readonly ArtworkSubmissionResult[],
): PartitionedArtworkResults {
  const successes: ArtworkSubmissionSuccess[] = [];
  const failures: ArtworkSubmissionFailure[] = [];
  const reconciliations: ArtworkSubmissionSuccess[] = [];

  artworks.forEach((artwork, index) => {
    const normalized = normalizeArtworkSubmissionResult(artwork, {
      clientArtworkId: artwork.clientArtworkId || `artwork-${index}`,
      order: artwork.order,
      title: artwork.title || "Untitled",
      inventoryId: artwork.inventoryId,
      claimId: artwork.claimId,
    });
    if (normalized.ok && normalized.stage === "completed") {
      successes.push(normalized);
      return;
    }
    if (normalized.ok && normalized.stage === "reconciliation_required") {
      reconciliations.push(normalized);
      return;
    }
    if (!normalized.ok) {
      failures.push(normalized);
    }
  });

  return { successes, failures, reconciliations };
}

export function buildCompletedBatchResult(params: {
  submissionAttemptId: string;
  archiveTarget: "test" | "production";
  completedAt?: string;
  artworks: ArtworkSubmissionResult[];
  sheetUrl: string | null;
  driveRootUrl: string | null;
}): Extract<BatchSubmissionResult, { ok: true }> {
  const artworks = params.artworks.map((artwork, index) =>
    normalizeArtworkSubmissionResult(artwork, {
      clientArtworkId: artwork.clientArtworkId || `artwork-${index}`,
      order: typeof artwork.order === "number" ? artwork.order : index,
      title: artwork.title || "Untitled",
      inventoryId: artwork.inventoryId,
      claimId: artwork.claimId,
    }),
  );
  const summary = summarizeBatchArtworkResults(artworks);

  return {
    ok: true,
    kind: "completed",
    submissionAttemptId: params.submissionAttemptId,
    archiveTarget: params.archiveTarget,
    completedAt: params.completedAt ?? new Date().toISOString(),
    total: summary.total,
    completed: summary.completed,
    failed: summary.failed,
    reconciliationRequired: summary.reconciliationRequired,
    artworks,
    sheetUrl: params.sheetUrl,
    driveRootUrl: params.driveRootUrl,
  };
}

export function submissionReportHeading(
  summary: BatchArtworkResultSummary,
): string {
  if (summary.failed === 0 && summary.reconciliationRequired === 0) {
    return "Submission complete";
  }
  return "Submission finished with issues";
}

export function submissionReportLead(summary: BatchArtworkResultSummary): string {
  if (summary.total === 0) {
    return "No artworks were recorded for this submission.";
  }
  if (summary.failed === 0 && summary.reconciliationRequired === 0) {
    return "Artwork files and metadata have been saved to Dropbox. Inventory details have been added to Google Sheets.";
  }

  const submitted =
    summary.total === 1
      ? "1 artwork was submitted"
      : `${summary.total} artworks were submitted`;
  const needsAttention = summary.failed + summary.reconciliationRequired;
  const attention =
    needsAttention === 1
      ? "1 needs attention"
      : `${needsAttention} need attention`;
  return `${submitted}. ${summary.completed} completed successfully and ${attention}.`;
}

export function failedArtworkProgressLines(
  artwork: ArtworkSubmissionFailure,
): string[] {
  const failedOp = artwork.failedOperation;
  const lines: string[] = [];

  const folderFailed = failedOp === "create_folder";
  const showFolder = folderFailed || (!artwork.driveFolder && !artwork.master);
  if (showFolder) {
    if (artwork.driveFolder) lines.push("Dropbox folder created");
    else if (folderFailed) lines.push("Dropbox folder failed");
    else lines.push("Dropbox folder not attempted");
  }

  if (artwork.master) lines.push("Master file saved");
  else if (failedOp === "upload_master") lines.push("Master file failed");
  else lines.push("Master file not attempted");

  if (artwork.hr) lines.push("High resolution saved");
  else if (failedOp === "generate_derivatives" || failedOp === "upload_hr") {
    lines.push("High resolution failed");
  } else {
    lines.push("High resolution not attempted");
  }

  if (artwork.web) lines.push("Web version saved");
  else if (failedOp === "upload_web") lines.push("Web version failed");
  else lines.push("Web version not attempted");

  const thumbRelevant =
    Boolean(artwork.thumb) ||
    failedOp === "generate_thumbnail" ||
    failedOp === "upload_thumb";
  if (thumbRelevant) {
    if (artwork.thumb) lines.push("Thumbnail saved");
    else if (failedOp === "generate_thumbnail" || failedOp === "upload_thumb") {
      lines.push("Thumbnail failed");
    } else {
      lines.push("Thumbnail not attempted");
    }
  }

  lines.push(
    artwork.sheetRowWritten
      ? "Inventory row recorded"
      : "Inventory row not recorded",
  );

  return lines;
}

export function preparedFolderRef(ready: {
  folderPath: string;
  folderName: string;
  folderWebUrl: string | null;
}): DriveResourceRef | null {
  if (!ready.folderWebUrl) return null;
  return {
    id: ready.folderPath,
    name: ready.folderName,
    webViewLink: ready.folderWebUrl,
  };
}
