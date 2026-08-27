/**
 * Pure helpers for the authenticated large-master Dropbox fallback.
 * Files over the direct-upload cap skip temporary upload links; the reserved
 * path is always derived from the server-side claim, never from a client path.
 */

import { planFilenamesForArtwork } from "@/lib/artwork/filenames";
import {
  requiresLargeFileDropboxIntake,
} from "@/lib/artwork/types";
import { isSafePlannedFilename } from "@/lib/images/filename-safety";
import { DROPBOX_ARCHIVE_ROOT_DISPLAY, DROPBOX_ARCHIVE_ROOT_WEB_URL } from "@/lib/dropbox/types";
import { buildArtworkFolderName } from "@/lib/submission/claim-logic";
import { expectedMasterDropboxPath } from "@/lib/submission/upload-link-logic";
import type {
  ArtworkSubmissionInput,
  ClaimStatus,
} from "@/lib/submission/types";

export const PENDING_INTAKE_KIND = "pending_large_file_intake" as const;
export const PENDING_INTAKE_SCHEMA_VERSION = 1 as const;
export const PENDING_INTAKES_FOLDER = "/_system/pending-intakes";

/** Hobby Vercel Functions have 2 GB memory; leave headroom for Node + Sharp. */
export const VERCEL_FUNCTION_MEMORY_BYTES = 2 * 1024 * 1024 * 1024;

/** Peak RSS estimate above this is treated as unsafe to decode on Vercel. */
export const VERCEL_PROCESSING_SAFETY_BYTES = Math.floor(
  VERCEL_FUNCTION_MEMORY_BYTES * 0.7,
);

/**
 * Do not download a master into the hosted function above this size.
 * Transfer via Dropbox is unbounded; processing still has to fit in /tmp + RAM.
 */
export const VERCEL_SAFE_DOWNLOAD_BYTES = 512 * 1024 * 1024;

export const LARGE_FILE_INTAKE_STATUSES = [
  "waiting_for_dropbox",
  "file_not_found",
  "incorrect_filename",
  "unsupported_file",
  "master_found",
  "local_processing_required",
  "processing",
  "completed",
  "failed",
] as const;

export type LargeFileIntakeStatus = (typeof LARGE_FILE_INTAKE_STATUSES)[number];

export type PendingLargeFileIntake = {
  schemaVersion: typeof PENDING_INTAKE_SCHEMA_VERSION;
  kind: typeof PENDING_INTAKE_KIND;
  claimId: string;
  inventoryId: number;
  clientArtworkId: string;
  submissionAttemptId: string;
  folderName: string;
  folderPath: string;
  masterFilename: string;
  masterPath: string;
  originalFilename: string;
  declaredByteLength: number;
  artwork: ArtworkSubmissionInput;
  shared: {
    exhibition: string;
    gallery: string;
    exhibitionYear: string;
    photographer: string;
  };
  createdAt: string;
};

export type LargeFileMemoryEstimate = {
  width: number;
  height: number;
  channels: number;
  bytesPerSample: number;
  sourceByteLength: number;
  decodedBytes: number;
  estimatedPeakBytes: number;
  safeToProcessOnVercel: boolean;
};

const CLAIM_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_MASTER_EXTENSIONS = new Set([".tif", ".tiff", ".jpg", ".jpeg", ".png"]);

export { requiresLargeFileDropboxIntake };

export function isSafeClaimId(claimId: string): boolean {
  return CLAIM_ID_PATTERN.test(claimId.trim());
}

export function pendingIntakeDropboxPath(claimId: string): string | null {
  const id = claimId.trim();
  if (!isSafeClaimId(id)) return null;
  return `${PENDING_INTAKES_FOLDER}/${id}.json`;
}

export function dropboxFolderHomeUrl(folderName: string): string | null {
  if (!folderName || folderName.includes("/") || folderName.includes("\\")) {
    return null;
  }
  if (folderName.includes("..") || folderName.includes("\0")) return null;
  return `${DROPBOX_ARCHIVE_ROOT_WEB_URL}/${encodeURIComponent(folderName)}`;
}

export function preferSafeFolderUrl(params: {
  sharedUrl?: string | null;
  folderName: string;
}): string | null {
  const shared = params.sharedUrl?.trim() ?? "";
  if (shared.startsWith("https://www.dropbox.com/") && !/access_token=/i.test(shared)) {
    return shared;
  }
  return dropboxFolderHomeUrl(params.folderName);
}

export function bytesPerSampleFromSharpDepth(depth: string | undefined): number {
  switch ((depth ?? "").toLowerCase()) {
    case "uchar":
    case "char":
      return 1;
    case "ushort":
    case "short":
      return 2;
    case "uint":
    case "int":
    case "float":
      return 4;
    case "double":
      return 8;
    default:
      return 1;
  }
}

/**
 * Conservative peak-RSS estimate for sequential Sharp decode + JPEG encode
 * inside a 2 GB function. Includes source bytes (file-backed but often cached),
 * the full-bit-depth decode, an 8-bit working copy, and encode scratch.
 */
export function estimateProcessingMemory(params: {
  width: number;
  height: number;
  channels: number;
  bytesPerSample: number;
  sourceByteLength: number;
}): LargeFileMemoryEstimate {
  const width = Math.max(0, params.width);
  const height = Math.max(0, params.height);
  const channels = Math.max(1, params.channels);
  const bytesPerSample = Math.max(1, params.bytesPerSample);
  const decodedBytes = width * height * channels * bytesPerSample;
  const eightBitWorking = width * height * channels;
  const estimatedPeakBytes =
    params.sourceByteLength +
    decodedBytes +
    eightBitWorking * 2 +
    256 * 1024 * 1024;
  return {
    width,
    height,
    channels,
    bytesPerSample,
    sourceByteLength: params.sourceByteLength,
    decodedBytes,
    estimatedPeakBytes,
    safeToProcessOnVercel:
      estimatedPeakBytes <= VERCEL_PROCESSING_SAFETY_BYTES &&
      params.sourceByteLength <= VERCEL_SAFE_DOWNLOAD_BYTES,
  };
}

export function localProcessingRequiredReason(estimate: LargeFileMemoryEstimate): string {
  if (estimate.sourceByteLength > VERCEL_SAFE_DOWNLOAD_BYTES) {
    return "This master is too large to download into the hosted 2 GB function. Local processing is required.";
  }
  if (!estimate.safeToProcessOnVercel) {
    return "Pixel dimensions, bit depth, and estimated memory exceed the hosted 2 GB function budget. Local processing is required.";
  }
  return "Local processing is required.";
}

export const LARGE_FILE_WAITING_INSTRUCTION =
  "This master is too large to upload directly through the archive. Add it to the prepared Dropbox folder, then return here to finish processing.";

export const LARGE_FILE_FILE_NOT_FOUND_MESSAGE =
  "We couldn't find the expected file in the prepared folder. Confirm that the upload has finished and the filename matches exactly, then check again.";

export const LARGE_FILE_INCORRECT_FILENAME_MESSAGE =
  "The file in the prepared folder does not use the expected filename. Rename it to match exactly, then check again.";

export const LARGE_FILE_MASTER_FOUND_MESSAGE = "Master file found";

export const LARGE_FILE_COMPLETED_MESSAGE = "Artwork added to the archive";

const PREVIEW_OR_DECODE_LEAK_PATTERN =
  /could not be decoded|corrupted or an unsupported variant|preview unavailable/i;

export function isPreviewOrDecodeLeakMessage(message: string): boolean {
  return PREVIEW_OR_DECODE_LEAK_PATTERN.test(message);
}

export function largeFileNeedsUploadHeading(count: number): string {
  return count === 1
    ? "1 artwork needs a large-file upload"
    : `${count} artworks need a large-file upload`;
}

export function dropboxFolderDisplayPath(folderName: string): string {
  return `${DROPBOX_ARCHIVE_ROOT_DISPLAY}${folderName}`;
}

export function largeFileStatusLabel(status: LargeFileIntakeStatus): string {
  switch (status) {
    case "waiting_for_dropbox":
      return "Waiting for Dropbox upload";
    case "file_not_found":
      return "File not found";
    case "incorrect_filename":
      return "Incorrect filename";
    case "unsupported_file":
      return "Unsupported file";
    case "master_found":
      return LARGE_FILE_MASTER_FOUND_MESSAGE;
    case "local_processing_required":
      return "Local processing required";
    case "processing":
      return "Processing";
    case "completed":
      return LARGE_FILE_COMPLETED_MESSAGE;
    case "failed":
      return "Processing failed";
  }
}

export function visibleLargeFileIntakeMessage(
  status: LargeFileIntakeStatus,
  message: string,
): string | null {
  const trimmed = message.trim();
  if (status === "waiting_for_dropbox") {
    if (!trimmed || isPreviewOrDecodeLeakMessage(trimmed)) return null;
    if (/inventory id reserved/i.test(trimmed)) return null;
    return trimmed;
  }
  if (status === "file_not_found") return LARGE_FILE_FILE_NOT_FOUND_MESSAGE;
  if (status === "incorrect_filename") {
    return trimmed || LARGE_FILE_INCORRECT_FILENAME_MESSAGE;
  }
  if (status === "master_found") return LARGE_FILE_MASTER_FOUND_MESSAGE;
  if (status === "completed") return LARGE_FILE_COMPLETED_MESSAGE;
  if (
    isPreviewOrDecodeLeakMessage(trimmed) &&
    status !== "unsupported_file"
  ) {
    return null;
  }
  return trimmed || null;
}

export function statusFromLargeFileProcessError(data: {
  errorCode?: string;
  status?: LargeFileIntakeStatus;
}): LargeFileIntakeStatus {
  if (data.status) return data.status;
  if (data.errorCode === "LOCAL_PROCESSING_REQUIRED") {
    return "local_processing_required";
  }
  if (data.errorCode === "MISSING_FILE") return "file_not_found";
  return "failed";
}

export function canCheckOrProcessClaimStatus(status: string): boolean {
  return status === "Claimed" || status === "Processing";
}

export function isTerminalClaimStatus(status: string): boolean {
  return (
    status === "Completed" || status === "Failed" || status === "Abandoned"
  );
}

export type RequiredArchiveFilesPresence = {
  master: boolean;
  hr: boolean;
  web: boolean;
  thumb: boolean;
  metadata: boolean;
};

export type ArchiveCompletenessEvidence = {
  hasInventorySheetRow: boolean;
  folderExists: boolean;
  files: RequiredArchiveFilesPresence;
};

export type RequiredCompletedArchivePaths = {
  folderPath: string;
  masterPath: string;
  hrPath: string;
  webPath: string;
  thumbPath: string;
  metadataPath: string;
};

export type IntakeSideEffect =
  | {
      kind: "update_claim_status";
      status: "Completed" | "Abandoned";
      setCompletedAt: boolean;
    }
  | { kind: "delete_pending_intake" };

export type IncompleteIntakeListDecision =
  | { kind: "list"; sideEffects: [] }
  | { kind: "hide"; sideEffects: [] }
  | { kind: "reconcile_completed"; sideEffects: IntakeSideEffect[] };

export function requiredCompletedArchivePaths(
  pending: PendingLargeFileIntake,
): RequiredCompletedArchivePaths {
  const planned = planFilenamesForArtwork({
    year: pending.artwork.year,
    inventoryId: pending.inventoryId,
    title: pending.artwork.title,
    masterFilename: pending.originalFilename,
  });
  return {
    folderPath: pending.folderPath,
    masterPath: pending.masterPath,
    hrPath: `${pending.folderPath}/${planned.hr}`,
    webPath: `${pending.folderPath}/${planned.web}`,
    thumbPath: `${pending.folderPath}/${planned.thumb}`,
    metadataPath: `${pending.folderPath}/${planned.metadata}`,
  };
}

export function missingRequiredArchiveFiles(
  files: RequiredArchiveFilesPresence,
): boolean {
  return (
    !files.master || !files.hr || !files.web || !files.thumb || !files.metadata
  );
}

/**
 * Completed is reserved for a verified final archive record: Inventory Sheet
 * row, artwork folder, and the required master / HR / web / thumb / metadata
 * files. Missing any of those is not Completed.
 */
export function isGenuinelyCompletedArchive(
  evidence: ArchiveCompletenessEvidence,
): boolean {
  return (
    evidence.hasInventorySheetRow &&
    evidence.folderExists &&
    !missingRequiredArchiveFiles(evidence.files)
  );
}

export function emptyArchiveFilePresence(): RequiredArchiveFilesPresence {
  return {
    master: false,
    hr: false,
    web: false,
    thumb: false,
    metadata: false,
  };
}

export function decideIncompleteIntakeListing(params: {
  claimStatus: string;
  hasPendingIntake: boolean;
  completeness: ArchiveCompletenessEvidence;
}): IncompleteIntakeListDecision {
  if (!canCheckOrProcessClaimStatus(params.claimStatus) || !params.hasPendingIntake) {
    return { kind: "hide", sideEffects: [] };
  }
  if (isGenuinelyCompletedArchive(params.completeness)) {
    return {
      kind: "reconcile_completed",
      sideEffects: [
        {
          kind: "update_claim_status",
          status: "Completed",
          setCompletedAt: true,
        },
        { kind: "delete_pending_intake" },
      ],
    };
  }
  if (params.completeness.hasInventorySheetRow) {
    return { kind: "hide", sideEffects: [] };
  }
  return { kind: "list", sideEffects: [] };
}

export const REMOVE_INCOMPLETE_INTAKE_ACTION_LABEL =
  "Already completed this upload or want to start it over later? Dismiss upload.";
export const REMOVE_INCOMPLETE_INTAKE_KEEP_LABEL = "Keep intake";
export const REMOVE_INCOMPLETE_INTAKE_CONFIRM_LABEL = "Remove from list";
export const REMOVE_INCOMPLETE_INTAKE_CONFIRM_TITLE =
  "Remove this incomplete intake?";

export function removeIncompleteIntakeConfirmationBody(
  inventoryId: number,
): string {
  return `It will no longer appear here. Inventory ${inventoryId} will remain retired, and no Dropbox files or completed artwork records will be deleted.`;
}

export type DismissIncompleteIntakeDecision =
  | {
      ok: true;
      claimStatus: ClaimStatus;
      alreadyTerminal: boolean;
      sideEffects: IntakeSideEffect[];
    }
  | {
      ok: false;
      code: "UNAUTHENTICATED" | "INVALID_REQUEST" | "CLAIM_NOT_REUSABLE";
      message: string;
    };

/**
 * Abandon a stale incomplete intake. Preserves the claim and inventory ID,
 * never marks an incomplete record Completed, and never deletes Dropbox files
 * or Artwork Inventory rows.
 */
export function decideDismissIncompleteIntake(params: {
  authenticated: boolean;
  claim: {
    claimId: string;
    inventoryId: number;
    claimStatus: ClaimStatus;
  } | null;
  pending: PendingLargeFileIntake | null;
  requestedClaimId: string;
  requestedInventoryId: number;
}): DismissIncompleteIntakeDecision {
  if (!params.authenticated) {
    return {
      ok: false,
      code: "UNAUTHENTICATED",
      message: "Authentication required.",
    };
  }
  if (!isSafeClaimId(params.requestedClaimId) || params.requestedInventoryId <= 0) {
    return {
      ok: false,
      code: "INVALID_REQUEST",
      message: "A valid claim ID and inventory ID are required.",
    };
  }
  if (!params.claim) {
    return {
      ok: false,
      code: "CLAIM_NOT_REUSABLE",
      message: "Inventory claim was not found.",
    };
  }
  if (
    params.claim.claimId !== params.requestedClaimId ||
    params.claim.inventoryId !== params.requestedInventoryId
  ) {
    return {
      ok: false,
      code: "CLAIM_NOT_REUSABLE",
      message: "Inventory claim does not match this artwork.",
    };
  }
  if (params.pending) {
    if (
      params.pending.claimId !== params.requestedClaimId ||
      params.pending.inventoryId !== params.requestedInventoryId
    ) {
      return {
        ok: false,
        code: "INVALID_REQUEST",
        message: "The reserved intake does not match this claim.",
      };
    }
  }
  if (params.claim.claimStatus === "Abandoned") {
    return {
      ok: true,
      claimStatus: "Abandoned",
      alreadyTerminal: true,
      sideEffects: [],
    };
  }
  if (params.claim.claimStatus === "Completed") {
    return {
      ok: true,
      claimStatus: "Completed",
      alreadyTerminal: true,
      sideEffects: [],
    };
  }
  if (params.claim.claimStatus === "Failed") {
    return {
      ok: true,
      claimStatus: "Failed",
      alreadyTerminal: true,
      sideEffects: [],
    };
  }
  if (!canCheckOrProcessClaimStatus(params.claim.claimStatus)) {
    return {
      ok: false,
      code: "CLAIM_NOT_REUSABLE",
      message: "This inventory claim cannot be reused.",
    };
  }
  return {
    ok: true,
    claimStatus: "Abandoned",
    alreadyTerminal: false,
    sideEffects: [
      {
        kind: "update_claim_status",
        status: "Abandoned",
        setCompletedAt: false,
      },
    ],
  };
}

export function dismissPreservesArchiveArtifacts(
  sideEffects: readonly IntakeSideEffect[],
): boolean {
  return sideEffects.every(
    (effect) =>
      effect.kind === "update_claim_status" && effect.status === "Abandoned",
  );
}

export function masterExtensionAllowed(filename: string): boolean {
  const match = /\.([^.]+)$/.exec(filename.trim().toLowerCase());
  if (!match) return false;
  return ALLOWED_MASTER_EXTENSIONS.has(`.${match[1]}`);
}

export function derivedReservedMaster(params: {
  year: string;
  inventoryId: number;
  title: string;
  originalFilename: string;
}): {
  folderName: string;
  folderPath: string;
  masterFilename: string;
  masterPath: string;
} | null {
  if (!Number.isInteger(params.inventoryId) || params.inventoryId <= 0) {
    return null;
  }
  const planned = planFilenamesForArtwork({
    year: params.year,
    inventoryId: params.inventoryId,
    title: params.title,
    masterFilename: params.originalFilename,
  });
  if (!isSafePlannedFilename(planned.master)) return null;
  const folderName = buildArtworkFolderName({
    year: params.year,
    inventoryId: params.inventoryId,
    title: params.title,
  });
  const masterPath = expectedMasterDropboxPath({
    year: params.year,
    inventoryId: params.inventoryId,
    title: params.title,
    masterFilename: planned.master,
  });
  return {
    folderName,
    folderPath: `/${folderName}`,
    masterFilename: planned.master,
    masterPath,
  };
}

export function parsePendingLargeFileIntake(
  raw: unknown,
): PendingLargeFileIntake | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (value.kind !== PENDING_INTAKE_KIND) return null;
  if (value.schemaVersion !== PENDING_INTAKE_SCHEMA_VERSION) return null;
  const claimId = String(value.claimId ?? "").trim();
  const inventoryId = Number(value.inventoryId);
  if (!isSafeClaimId(claimId)) return null;
  if (!Number.isInteger(inventoryId) || inventoryId <= 0) return null;
  const artwork = parsePendingArtwork(value.artwork);
  if (!artwork) return null;
  const sharedRaw =
    value.shared && typeof value.shared === "object"
      ? (value.shared as Record<string, unknown>)
      : {};
  const originalFilename = String(value.originalFilename ?? "").trim();
  const derived = derivedReservedMaster({
    year: artwork.year,
    inventoryId,
    title: artwork.title,
    originalFilename,
  });
  if (!derived) return null;
  const masterPath = String(value.masterPath ?? "");
  const folderPath = String(value.folderPath ?? "");
  const masterFilename = String(value.masterFilename ?? "");
  if (masterPath !== derived.masterPath) return null;
  if (folderPath !== derived.folderPath) return null;
  if (masterFilename !== derived.masterFilename) return null;
  const declaredByteLength = Number(value.declaredByteLength);
  if (!Number.isInteger(declaredByteLength) || declaredByteLength <= 0) {
    return null;
  }
  return {
    schemaVersion: PENDING_INTAKE_SCHEMA_VERSION,
    kind: PENDING_INTAKE_KIND,
    claimId,
    inventoryId,
    clientArtworkId: String(value.clientArtworkId ?? "").trim(),
    submissionAttemptId: String(value.submissionAttemptId ?? "").trim(),
    folderName: derived.folderName,
    folderPath: derived.folderPath,
    masterFilename: derived.masterFilename,
    masterPath: derived.masterPath,
    originalFilename,
    declaredByteLength,
    artwork,
    shared: {
      exhibition: String(sharedRaw.exhibition ?? ""),
      gallery: String(sharedRaw.gallery ?? ""),
      exhibitionYear: String(sharedRaw.exhibitionYear ?? ""),
      photographer: String(sharedRaw.photographer ?? ""),
    },
    createdAt: String(value.createdAt ?? ""),
  };
}

function parsePendingArtwork(raw: unknown): ArtworkSubmissionInput | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const overridesRaw =
    value.overrides && typeof value.overrides === "object"
      ? (value.overrides as Record<string, unknown>)
      : {};
  const clientArtworkId = String(value.clientArtworkId ?? "").trim();
  const order = Number(value.order);
  if (!clientArtworkId || !Number.isInteger(order) || order < 0) return null;
  return {
    clientArtworkId,
    order,
    title: String(value.title ?? ""),
    ...(value.isUntitled === true ? { isUntitled: true as const } : {}),
    year: String(value.year ?? "").trim(),
    medium: String(value.medium ?? "").trim(),
    height: String(value.height ?? ""),
    width: String(value.width ?? ""),
    depth: String(value.depth ?? ""),
    dimensionUnit: String(value.dimensionUnit ?? ""),
    notes: String(value.notes ?? ""),
    overrides: {
      exhibition: String(overridesRaw.exhibition ?? ""),
      gallery: String(overridesRaw.gallery ?? ""),
      photographer: String(overridesRaw.photographer ?? ""),
    },
    originalFilename: String(value.originalFilename ?? ""),
  };
}

export function buildPendingLargeFileIntake(params: {
  claimId: string;
  inventoryId: number;
  clientArtworkId: string;
  submissionAttemptId: string;
  artwork: ArtworkSubmissionInput;
  shared: PendingLargeFileIntake["shared"];
  originalFilename: string;
  declaredByteLength: number;
  createdAt: string;
}): PendingLargeFileIntake | null {
  const derived = derivedReservedMaster({
    year: params.artwork.year,
    inventoryId: params.inventoryId,
    title: params.artwork.title,
    originalFilename: params.originalFilename,
  });
  if (!derived || !isSafeClaimId(params.claimId)) return null;
  return {
    schemaVersion: PENDING_INTAKE_SCHEMA_VERSION,
    kind: PENDING_INTAKE_KIND,
    claimId: params.claimId,
    inventoryId: params.inventoryId,
    clientArtworkId: params.clientArtworkId,
    submissionAttemptId: params.submissionAttemptId,
    folderName: derived.folderName,
    folderPath: derived.folderPath,
    masterFilename: derived.masterFilename,
    masterPath: derived.masterPath,
    originalFilename: params.originalFilename,
    declaredByteLength: params.declaredByteLength,
    artwork: {
      ...params.artwork,
      originalFilename: params.originalFilename,
    },
    shared: params.shared,
    createdAt: params.createdAt,
  };
}

export type CheckMasterLogicInput = {
  authenticated: boolean;
  claim: { claimId: string; inventoryId: number; claimStatus: ClaimStatus } | null;
  pending: PendingLargeFileIntake | null;
  requestedClaimId: string;
  requestedInventoryId: number;
};

export type CheckMasterGateResult =
  | { ok: false; code: "UNAUTHENTICATED" | "INVALID_REQUEST" | "CLAIM_NOT_REUSABLE"; message: string }
  | { ok: true; pending: PendingLargeFileIntake; claimStatus: ClaimStatus };

export function gateLargeFileClaimAccess(
  params: CheckMasterLogicInput,
): CheckMasterGateResult {
  if (!params.authenticated) {
    return {
      ok: false,
      code: "UNAUTHENTICATED",
      message: "Authentication required.",
    };
  }
  if (!isSafeClaimId(params.requestedClaimId) || params.requestedInventoryId <= 0) {
    return {
      ok: false,
      code: "INVALID_REQUEST",
      message: "A valid claim ID and inventory ID are required.",
    };
  }
  if (!params.pending) {
    return {
      ok: false,
      code: "INVALID_REQUEST",
      message: "No reserved large-file intake was found for this claim.",
    };
  }
  if (
    params.pending.claimId !== params.requestedClaimId ||
    params.pending.inventoryId !== params.requestedInventoryId
  ) {
    return {
      ok: false,
      code: "INVALID_REQUEST",
      message: "The reserved intake does not match this claim.",
    };
  }
  if (!params.claim) {
    return {
      ok: false,
      code: "CLAIM_NOT_REUSABLE",
      message: "Inventory claim was not found.",
    };
  }
  if (
    params.claim.claimId !== params.pending.claimId ||
    params.claim.inventoryId !== params.pending.inventoryId
  ) {
    return {
      ok: false,
      code: "CLAIM_NOT_REUSABLE",
      message: "Inventory claim does not match this artwork.",
    };
  }
  if (params.claim.claimStatus === "Completed") {
    return {
      ok: true,
      pending: params.pending,
      claimStatus: "Completed",
    };
  }
  if (!canCheckOrProcessClaimStatus(params.claim.claimStatus)) {
    return {
      ok: false,
      code: "CLAIM_NOT_REUSABLE",
      message: "This inventory claim cannot be reused.",
    };
  }
  return {
    ok: true,
    pending: params.pending,
    claimStatus: params.claim.claimStatus,
  };
}

export function rejectClientProvidedDropboxPath(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const path = (body as { dropboxPath?: unknown }).dropboxPath;
  return typeof path === "string" && path.trim().length > 0;
}

export type LargeFileCheckResult = {
  ok: true;
  status: LargeFileIntakeStatus;
  claimId: string;
  inventoryId: number;
  folderName: string;
  folderPath: string;
  masterFilename: string;
  folderWebUrl: string | null;
  byteLength: number | null;
  width: number | null;
  height: number | null;
  bitDepth: number | null;
  message: string;
  canContinueProcessing: boolean;
};

export type IncompleteLargeFileIntake = {
  claimId: string;
  inventoryId: number;
  claimStatus: ClaimStatus;
  folderName: string;
  masterFilename: string;
  folderWebUrl: string | null;
  title: string;
  year: string;
  status: LargeFileIntakeStatus;
  declaredByteLength: number;
};

export function inspectDropboxMasterMetadata(params: {
  expectedPath: string;
  expectedFilename: string;
  path: string;
  name: string;
  isFolder: boolean;
  size: number;
}): { ok: true } | { ok: false; status: LargeFileIntakeStatus; message: string } {
  if (params.path !== params.expectedPath) {
    return {
      ok: false,
      status: "failed",
      message: "Dropbox path does not match the reserved master for this claim.",
    };
  }
  if (params.isFolder) {
    return {
      ok: false,
      status: "file_not_found",
      message: LARGE_FILE_FILE_NOT_FOUND_MESSAGE,
    };
  }
  if (params.name !== params.expectedFilename) {
    return {
      ok: false,
      status: "incorrect_filename",
      message: LARGE_FILE_INCORRECT_FILENAME_MESSAGE,
    };
  }
  if (!masterExtensionAllowed(params.name)) {
    return {
      ok: false,
      status: "unsupported_file",
      message: "Master must be TIFF, JPEG, or PNG.",
    };
  }
  if (params.size <= 0) {
    return {
      ok: false,
      status: "file_not_found",
      message: LARGE_FILE_FILE_NOT_FOUND_MESSAGE,
    };
  }
  return { ok: true };
}
