/**
 * Typed model for permanent artwork batch submission.
 * The app is a temporary processing/delivery tool; Dropbox (files) and Sheets
 * (metadata) are the archive. DriveResourceRef holds storage refs for either backend.
 */

export const CLAIM_STATUSES = [
  "Claimed",
  "Processing",
  "Completed",
  "Failed",
] as const;

export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const ARTWORK_SUBMISSION_STAGES = [
  "pending",
  "claimed",
  "processing",
  "folder_created",
  "master_uploaded",
  "derivatives_generated",
  "hr_uploaded",
  "web_uploaded",
  "metadata_uploaded",
  "sheet_row_appended",
  "completed",
  "failed",
  "reconciliation_required",
] as const;

export type ArtworkSubmissionStage =
  (typeof ARTWORK_SUBMISSION_STAGES)[number];

/** Concrete operation that failed (distinct from last successfully completed stage). */
export const SUBMISSION_FAILED_OPERATIONS = [
  "mark_claim_processing",
  "create_folder",
  "upload_master",
  "generate_derivatives",
  "upload_hr",
  "upload_web",
  "upload_metadata",
  "append_inventory_row",
  "mark_claim_completed",
] as const;

export type SubmissionFailedOperation =
  (typeof SUBMISSION_FAILED_OPERATIONS)[number];

export type SubmissionErrorCode =
  | "PREFLIGHT_FAILED"
  | "INVALID_BATCH"
  | "DUPLICATE_ATTEMPT"
  | "MISSING_FILE"
  | "DUPLICATE_FILE_ASSOCIATION"
  | "FILE_TOO_LARGE"
  | "BATCH_TOO_LARGE"
  | "TOO_MANY_ARTWORKS"
  | "FOLDER_CONFLICT"
  | "DRIVE_UPLOAD_FAILED"
  | "DRIVE_FOLDER_FAILED"
  | "IMAGE_PROCESSING_FAILED"
  | "SHEET_APPEND_FAILED"
  | "CLAIM_UPDATE_FAILED"
  | "CLEANUP_FAILED"
  | "GOOGLE_TRANSIENT"
  | "UNKNOWN";

export type ReconciliationWarning = {
  code:
    | "CLAIM_STATUS_UPDATE_FAILED"
    | "FAILED_INTAKE_MOVE_FAILED"
    | "CLAIM_MARK_FAILED_FAILED"
    | "INVENTORY_ROW_WITHOUT_COMPLETED_CLAIM"
    | "DRIVE_FILES_WITHOUT_INVENTORY_ROW"
    | "DRIVE_FILES_WITHOUT_METADATA";
  message: string;
};

export type ArtworkSubmissionInput = {
  /** Stable client-side artwork ID. */
  clientArtworkId: string;
  /** Zero-based order within the batch. */
  order: number;
  title: string;
  year: string;
  medium: string;
  height: string;
  width: string;
  depth: string;
  dimensionUnit: string;
  notes: string;
  overrides: {
    exhibition: string;
    gallery: string;
    photographer: string;
  };
  originalFilename: string;
};

export type ArtworkBatchSubmissionInput = {
  submissionAttemptId: string;
  shared: {
    exhibition: string;
    gallery: string;
    exhibitionYear: string;
    photographer: string;
  };
  artworks: ArtworkSubmissionInput[];
};

/** Resolved final metadata after shared defaults + overrides. */
export type ResolvedArtworkMetadata = {
  title: string;
  year: string;
  medium: string;
  height: string;
  width: string;
  depth: string;
  dimensionUnit: string;
  notes: string;
  exhibition: string;
  gallery: string;
  photographer: string;
};

export type ClaimedArtwork = {
  clientArtworkId: string;
  order: number;
  claimId: string;
  inventoryId: number;
  claimStatus: ClaimStatus;
};

export type DriveResourceRef = {
  id: string;
  name: string;
  webViewLink: string;
};

export type CleanupResult = {
  tempFilesRemoved: boolean;
  folderMovedToFailedIntake: boolean | null;
  cleanupWarnings: string[];
};

export type ArtworkSubmissionBase = {
  clientArtworkId: string;
  order: number;
  title: string;
  inventoryId: number | null;
  claimId: string | null;
  stage: ArtworkSubmissionStage;
  driveFolder: DriveResourceRef | null;
  master: DriveResourceRef | null;
  hr: DriveResourceRef | null;
  web: DriveResourceRef | null;
  metadata: DriveResourceRef | null;
  sheetRowWritten: boolean;
  claimStatus: ClaimStatus | null;
  cleanup: CleanupResult;
  startedAt: string | null;
  finishedAt: string | null;
};

export type ArtworkSubmissionSuccess = ArtworkSubmissionBase & {
  ok: true;
  stage: "completed" | "reconciliation_required";
  inventoryId: number;
  claimId: string;
  driveFolder: DriveResourceRef;
  master: DriveResourceRef;
  hr: DriveResourceRef;
  web: DriveResourceRef;
  metadata: DriveResourceRef;
  sheetRowWritten: true;
  reconciliationWarnings: ReconciliationWarning[];
};

export type ArtworkSubmissionFailure = ArtworkSubmissionBase & {
  ok: false;
  /**
   * Last successfully completed stage (never a past-tense success for the
   * operation that failed — e.g. not `master_uploaded` when master is missing).
   */
  stage: ArtworkSubmissionStage;
  lastCompletedStage: ArtworkSubmissionStage;
  failedOperation: SubmissionFailedOperation | null;
  errorCode: SubmissionErrorCode;
  message: string;
  reconciliationWarnings: ReconciliationWarning[];
};

export type ArtworkSubmissionResult =
  | ArtworkSubmissionSuccess
  | ArtworkSubmissionFailure;

export type BatchSubmissionResult =
  | {
      ok: true;
      kind: "completed";
      submissionAttemptId: string;
      archiveTarget: "test" | "production";
      completedAt: string;
      total: number;
      completed: number;
      failed: number;
      reconciliationRequired: number;
      artworks: ArtworkSubmissionResult[];
      sheetUrl: string | null;
      driveRootUrl: string | null;
    }
  | {
      ok: false;
      kind: "preflight_failed" | "duplicate_attempt" | "invalid_request";
      submissionAttemptId: string | null;
      archiveTarget: "test" | "production" | null;
      code: SubmissionErrorCode;
      message: string;
      completedAt: string;
    };

export type EmptyCleanupResult = CleanupResult;

export function emptyCleanupResult(): CleanupResult {
  return {
    tempFilesRemoved: false,
    folderMovedToFailedIntake: null,
    cleanupWarnings: [],
  };
}
