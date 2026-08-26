import "server-only";

import { join } from "node:path";

import { planFilenamesForArtwork } from "@/lib/artwork/filenames";
import { getDropboxDirectImageUrl } from "@/lib/dropbox/direct-image-url";
import { DropboxIntegrationError } from "@/lib/dropbox/errors";
import { GoogleIntegrationError } from "@/lib/google/errors";
import { buildSheetsImageFormula } from "@/lib/google/inventory-thumbnail";
import {
  appendArtworkInventoryRow,
  updateInventoryClaimStatus,
} from "@/lib/google/sheets";
import { processArtworkImage } from "@/lib/images/process-artwork-image";
import { logSubmissionEvent } from "@/lib/submission/audit-log";
import {
  ARTWORK_METADATA_MIME_TYPE,
  buildPortableArtworkMetadata,
  portableArtworkMetadataBuffer,
} from "@/lib/submission/artwork-metadata";
import {
  buildArtworkFolderName,
  isoNow,
  resolveArtworkMetadata,
} from "@/lib/submission/claim-logic";
import {
  assertTempFileReadable,
  classifyMasterUploadError,
  failureProgress,
  messageForMasterUploadFailure,
} from "@/lib/submission/failure-reporting";
import {
  emptyIntakeTimings,
  formatIntakeTimings,
} from "@/lib/submission/intake-diagnostics";
import { buildArtworkInventoryRow } from "@/lib/submission/inventory-row";
import {
  firstFailedDerivativeUpload,
  lastCompletedDerivativeUploadStage,
} from "@/lib/submission/parallel-stages";
import {
  removeTempDir,
  writeTempFile,
} from "@/lib/submission/temp-files";
import {
  TestFaultInjectionError,
  maybeThrowTestFault,
} from "@/lib/submission/test-fault-injection";
import type {
  ArtworkSubmissionFailure,
  ArtworkSubmissionInput,
  ArtworkSubmissionResult,
  ArtworkSubmissionStage,
  ArtworkSubmissionSuccess,
  ClaimedArtwork,
  CleanupResult,
  DriveResourceRef,
  ReconciliationWarning,
  SubmissionErrorCode,
  SubmissionFailedOperation,
} from "@/lib/submission/types";
import { emptyCleanupResult } from "@/lib/submission/types";
import type { StorageProvider } from "@/lib/storage/types";

function mimeForFilename(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".tif") || lower.endsWith(".tiff")) return "image/tiff";
  return "application/octet-stream";
}

function mapProcessingError(error: unknown): {
  code: SubmissionErrorCode;
  message: string;
  httpStatus?: number;
  googleReason?: string;
  causeDetail?: string;
} {
  if (error instanceof DropboxIntegrationError) {
    return {
      code:
        error.httpStatus === 429 ||
        error.httpStatus === 500 ||
        error.httpStatus === 503
          ? "GOOGLE_TRANSIENT"
          : "DRIVE_UPLOAD_FAILED",
      message: error.safeMessage,
      httpStatus: error.httpStatus,
      causeDetail: error.code,
    };
  }
  if (error instanceof GoogleIntegrationError) {
    const uploadRelated =
      error.code === "DRIVE_STORAGE_QUOTA" ||
      error.code === "DRIVE_UPLOAD_REJECTED" ||
      error.code === "DRIVE_ACCESS_DENIED" ||
      error.code === "UNKNOWN";
    return {
      code:
        error.code === "QUOTA_OR_TRANSIENT"
          ? "GOOGLE_TRANSIENT"
          : uploadRelated
            ? "DRIVE_UPLOAD_FAILED"
            : "DRIVE_UPLOAD_FAILED",
      message: error.safeMessage,
      httpStatus: error.httpStatus,
      googleReason: error.googleReason,
      causeDetail: error.causeDetail,
    };
  }
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code: string }).code);
    const message =
      error instanceof Error
        ? error.message
        : "Image processing failed.";
    if (
      code === "FILE_TOO_LARGE" ||
      code === "UNSUPPORTED_FORMAT" ||
      code === "CORRUPTED_IMAGE" ||
      code === "DIMENSIONS_TOO_LARGE" ||
      code === "PIXEL_LIMIT_EXCEEDED" ||
      code === "TIMEOUT" ||
      code === "SHARP_DECODE_FAILURE" ||
      code === "THUMBNAIL_GENERATION_FAILED"
    ) {
      return { code: "IMAGE_PROCESSING_FAILED", message };
    }
  }
  if (error instanceof Error) {
    return { code: "UNKNOWN", message: error.message };
  }
  return { code: "UNKNOWN", message: "Artwork submission failed." };
}

async function markClaim(
  spreadsheetId: string,
  claimId: string,
  status: "Processing" | "Completed" | "Failed",
  completedAt?: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const result = await updateInventoryClaimStatus({
      claimId,
      status,
      completedAt: completedAt ?? (status === "Failed" ? "" : undefined),
      spreadsheetId,
    });
    if (!result.updated) {
      return { ok: false, reason: result.reason };
    }
    return { ok: true };
  } catch (error) {
    const message =
      error instanceof GoogleIntegrationError
        ? error.safeMessage
        : error instanceof DropboxIntegrationError
          ? error.safeMessage
          : "Claim status update failed.";
    return { ok: false, reason: message };
  }
}

async function compensateFailedFolder(params: {
  folderId: string | null;
  storage: StorageProvider;
  cleanup: CleanupResult;
}): Promise<void> {
  if (!params.folderId) {
    params.cleanup.folderMovedToFailedIntake = null;
    return;
  }
  try {
    await params.storage.moveFolderToFailedIntake({
      folderId: params.folderId,
    });
    params.cleanup.folderMovedToFailedIntake = true;
  } catch (error) {
    params.cleanup.folderMovedToFailedIntake = false;
    const message =
      error instanceof GoogleIntegrationError
        ? error.safeMessage
        : error instanceof DropboxIntegrationError
          ? error.safeMessage
          : "Could not move folder to Failed Intake.";
    params.cleanup.cleanupWarnings.push(message);
  }
}

export type ProcessOneArtworkParams = {
  submissionAttemptId: string;
  artwork: ArtworkSubmissionInput;
  claim: ClaimedArtwork;
  shared: {
    exhibition: string;
    gallery: string;
    photographer: string;
  };
  sourceFile: File;
  sourceBytes: Buffer;
  artworkTempDir: string;
  spreadsheetId: string;
  storage: StorageProvider;
};

export async function processOneArtwork(
  params: ProcessOneArtworkParams,
): Promise<ArtworkSubmissionResult> {
  const startedAt = isoNow();
  const intakeStartedMs = Date.now();
  const timings = emptyIntakeTimings();
  const metadata = resolveArtworkMetadata(params.artwork, params.shared);
  const cleanup = emptyCleanupResult();
  const warnings: ReconciliationWarning[] = [];
  const storageLabel =
    params.storage.kind === "dropbox" ? "Dropbox" : "Google Drive";

  let driveFolder: DriveResourceRef | null = null;
  let master: DriveResourceRef | null = null;
  let hr: DriveResourceRef | null = null;
  let web: DriveResourceRef | null = null;
  let thumb: DriveResourceRef | null = null;
  let metadataFile: DriveResourceRef | null = null;
  let sheetRowWritten = false;
  let lastCompletedStage: ArtworkSubmissionStage = "claimed";

  const base = () => ({
    clientArtworkId: params.artwork.clientArtworkId,
    order: params.artwork.order,
    title: metadata.title,
    inventoryId: params.claim.inventoryId,
    claimId: params.claim.claimId,
    driveFolder,
    master,
    hr,
    web,
    thumb,
    metadata: metadataFile,
    sheetRowWritten,
    cleanup,
    startedAt,
    finishedAt: isoNow(),
    reconciliationWarnings: warnings,
  });

  const logIntakeTimings = () => {
    timings.totalIntakeMs = Date.now() - intakeStartedMs;
    logSubmissionEvent({
      event: "intake_timings",
      submissionAttemptId: params.submissionAttemptId,
      clientArtworkId: params.artwork.clientArtworkId,
      inventoryId: params.claim.inventoryId,
      claimId: params.claim.claimId,
      lastCompletedStage,
      detail: `${formatIntakeTimings(timings)}; source_decode=once_to_raw`,
      durationMs: timings.totalIntakeMs,
      timings,
    });
  };

  const fail = async (
    errorCode: SubmissionErrorCode,
    message: string,
    failedOperation: SubmissionFailedOperation,
    options?: {
      moveFolder?: boolean;
      httpStatus?: number;
      googleReason?: string;
      causeDetail?: string;
      normalizedErrorCode?: string;
    },
  ): Promise<ArtworkSubmissionFailure> => {
    if (options?.moveFolder !== false && driveFolder) {
      await compensateFailedFolder({
        folderId: driveFolder.id,
        storage: params.storage,
        cleanup,
      });
    } else if (!driveFolder) {
      cleanup.folderMovedToFailedIntake = null;
    }

    const mark = await markClaim(
      params.spreadsheetId,
      params.claim.claimId,
      "Failed",
      "",
    );
    if (!mark.ok) {
      warnings.push({
        code: "CLAIM_MARK_FAILED_FAILED",
        message: `Primary failure preserved; could not mark claim Failed (${mark.reason}).`,
      });
    }

    cleanup.tempFilesRemoved = await removeTempDir(params.artworkTempDir);

    const progress = failureProgress({
      lastCompletedStage,
      failedOperation,
    });

    logIntakeTimings();
    logSubmissionEvent({
      event: "artwork_failed",
      submissionAttemptId: params.submissionAttemptId,
      clientArtworkId: params.artwork.clientArtworkId,
      inventoryId: params.claim.inventoryId,
      claimId: params.claim.claimId,
      stage: progress.stage,
      lastCompletedStage: progress.lastCompletedStage,
      failedOperation: progress.failedOperation,
      nextOperation: null,
      errorCode,
      normalizedErrorCode: options?.normalizedErrorCode ?? errorCode,
      googleHttpStatus: options?.httpStatus,
      googleReason: options?.googleReason,
      outcome: "failed",
      resourceIds: {
        folderId: driveFolder?.id,
        masterId: master?.id,
        hrId: hr?.id,
        webId: web?.id,
        thumbId: thumb?.id,
        metadataId: metadataFile?.id,
      },
      detail: [message, options?.causeDetail].filter(Boolean).join(" | "),
    });

    return {
      ok: false,
      ...base(),
      stage: progress.stage,
      lastCompletedStage: progress.lastCompletedStage,
      failedOperation: progress.failedOperation,
      claimStatus: mark.ok ? "Failed" : params.claim.claimStatus,
      errorCode,
      message,
    };
  };

  // 1. Mark claim Processing
  logSubmissionEvent({
    event: "operation",
    submissionAttemptId: params.submissionAttemptId,
    clientArtworkId: params.artwork.clientArtworkId,
    inventoryId: params.claim.inventoryId,
    claimId: params.claim.claimId,
    lastCompletedStage,
    failedOperation: null,
    nextOperation: "mark_claim_processing",
  });

  const processingMark = await markClaim(
    params.spreadsheetId,
    params.claim.claimId,
    "Processing",
  );
  if (!processingMark.ok) {
    return fail(
      "CLAIM_UPDATE_FAILED",
      `Could not mark claim Processing (${processingMark.reason}).`,
      "mark_claim_processing",
      { moveFolder: false },
    );
  }

  lastCompletedStage = "processing";
  logSubmissionEvent({
    event: "stage",
    submissionAttemptId: params.submissionAttemptId,
    clientArtworkId: params.artwork.clientArtworkId,
    inventoryId: params.claim.inventoryId,
    claimId: params.claim.claimId,
    stage: "processing",
    lastCompletedStage,
    nextOperation: "create_folder",
  });

  const folderName = buildArtworkFolderName({
    year: metadata.year,
    inventoryId: params.claim.inventoryId,
    title: metadata.title,
  });

  const planned = planFilenamesForArtwork({
    year: metadata.year,
    inventoryId: params.claim.inventoryId,
    title: metadata.title,
    masterFilename: params.artwork.originalFilename || params.sourceFile.name,
  });

  // 2. Folder conflict check + create
  try {
    const existing = await params.storage.findChildFolderByName(folderName);
    if (existing) {
      return fail(
        "FOLDER_CONFLICT",
        `${storageLabel} folder “${folderName}” already exists under the archive root. Inventory ID ${params.claim.inventoryId} is retained and marked Failed.`,
        "create_folder",
        { moveFolder: false },
      );
    }

    driveFolder = await params.storage.createArtworkFolder(folderName);
    lastCompletedStage = "folder_created";
    logSubmissionEvent({
      event: "stage",
      submissionAttemptId: params.submissionAttemptId,
      clientArtworkId: params.artwork.clientArtworkId,
      inventoryId: params.claim.inventoryId,
      claimId: params.claim.claimId,
      stage: "folder_created",
      lastCompletedStage,
      nextOperation: "upload_master",
      resourceIds: { folderId: driveFolder.id },
    });
  } catch (error) {
    const mapped = mapProcessingError(error);
    return fail(
      mapped.code === "GOOGLE_TRANSIENT" ? mapped.code : "DRIVE_FOLDER_FAILED",
      mapped.message,
      "create_folder",
      {
        moveFolder: false,
        httpStatus: mapped.httpStatus,
        googleReason: mapped.googleReason,
        causeDetail: mapped.causeDetail,
      },
    );
  }

  // 3–4. Upload master and generate HR/web/thumb concurrently.
  // Generation uses in-memory sourceBytes and does not depend on the uploaded master.
  if (!params.sourceBytes.length) {
    return fail(
      "MISSING_FILE",
      messageForMasterUploadFailure("temp_missing"),
      "upload_master",
      { normalizedErrorCode: "EMPTY_SOURCE_BYTES" },
    );
  }

  const masterPromise = (async () => {
    const uploadStarted = Date.now();
    try {
      const masterPath = await writeTempFile(
        params.artworkTempDir,
        planned.master,
        params.sourceBytes,
      );
      await assertTempFileReadable(masterPath);

      logSubmissionEvent({
        event: "operation",
        submissionAttemptId: params.submissionAttemptId,
        clientArtworkId: params.artwork.clientArtworkId,
        inventoryId: params.claim.inventoryId,
        claimId: params.claim.claimId,
        lastCompletedStage,
        nextOperation: "upload_master",
        detail: `masterFilename=${planned.master}; bytes=${params.sourceBytes.length}`,
      });

      const uploaded = await params.storage.uploadFile({
        parentId: driveFolder!.id,
        name: planned.master,
        mimeType: mimeForFilename(planned.master),
        contents: params.sourceBytes,
      });
      return { uploaded, ms: Date.now() - uploadStarted };
    } catch (error) {
      timings.dropboxMasterUploadMs = Date.now() - uploadStarted;
      throw error;
    }
  })();

  const generatePromise = (async () => {
    const processed = await processArtworkImage({
      sourceBytes: params.sourceBytes,
      originalFilename:
        params.artwork.originalFilename || params.sourceFile.name,
      plannedFilenames: {
        master: planned.master,
        hr: planned.hr,
        web: planned.web,
        thumb: planned.thumb,
      },
    });
    timings.masterReadDecodeMs = processed.timings.masterReadDecodeMs;
    timings.hrGenerationMs = processed.timings.hrGenerationMs;
    timings.webGenerationMs = processed.timings.webGenerationMs;
    timings.thumbnailGenerationMs = processed.timings.thumbnailGenerationMs;
    return processed;
  })();

  const [masterSettled, generateSettled] = await Promise.allSettled([
    masterPromise,
    generatePromise,
  ]);

  if (masterSettled.status === "fulfilled") {
    timings.dropboxMasterUploadMs = masterSettled.value.ms;
    master = masterSettled.value.uploaded;
    lastCompletedStage = "master_uploaded";
    logSubmissionEvent({
      event: "stage",
      submissionAttemptId: params.submissionAttemptId,
      clientArtworkId: params.artwork.clientArtworkId,
      inventoryId: params.claim.inventoryId,
      claimId: params.claim.claimId,
      stage: "master_uploaded",
      lastCompletedStage,
      nextOperation: "generate_derivatives",
      resourceIds: { masterId: master.id },
      durationMs: timings.dropboxMasterUploadMs,
    });
  }

  if (generateSettled.status === "fulfilled" && master) {
    lastCompletedStage = "derivatives_generated";
    logSubmissionEvent({
      event: "stage",
      submissionAttemptId: params.submissionAttemptId,
      clientArtworkId: params.artwork.clientArtworkId,
      inventoryId: params.claim.inventoryId,
      claimId: params.claim.claimId,
      stage: "derivatives_generated",
      lastCompletedStage,
      nextOperation: "upload_hr",
    });
  }

  if (masterSettled.status === "rejected") {
    const classified = classifyMasterUploadError(masterSettled.reason);
    return fail(classified.code, classified.message, "upload_master", {
      httpStatus: classified.httpStatus,
      googleReason: classified.googleReason,
      causeDetail: classified.causeDetail,
      normalizedErrorCode: classified.kind,
    });
  }

  if (generateSettled.status === "rejected") {
    const error = generateSettled.reason;
    const mapped = mapProcessingError(error);
    const thumbnailFailed =
      error &&
      typeof error === "object" &&
      "code" in error &&
      String((error as { code: string }).code) === "THUMBNAIL_GENERATION_FAILED";
    return fail(
      mapped.code,
      mapped.message,
      thumbnailFailed ? "generate_thumbnail" : "generate_derivatives",
    );
  }

  let hrBuffer = generateSettled.value.hr.buffer;
  let webBuffer = generateSettled.value.web.buffer;
  let thumbBuffer = generateSettled.value.thumb.buffer;

  // 5. Upload HR, web, and thumbnail concurrently once files are ready.
  const derivativeUploadsStarted = Date.now();
  const [hrSettled, webSettled, thumbSettled] = await Promise.allSettled([
    (async () => {
      maybeThrowTestFault({
        operation: "upload_high_resolution",
        artworkIndex: params.artwork.order,
      });
      await writeTempFile(params.artworkTempDir, planned.hr, hrBuffer);
      return params.storage.uploadFile({
        parentId: driveFolder!.id,
        name: planned.hr,
        mimeType: "image/jpeg",
        contents: hrBuffer,
      });
    })(),
    (async () => {
      await writeTempFile(params.artworkTempDir, planned.web, webBuffer);
      return params.storage.uploadFile({
        parentId: driveFolder!.id,
        name: planned.web,
        mimeType: "image/jpeg",
        contents: webBuffer,
      });
    })(),
    (async () => {
      maybeThrowTestFault({
        operation: "upload_thumb",
        artworkIndex: params.artwork.order,
      });
      await writeTempFile(params.artworkTempDir, planned.thumb, thumbBuffer);
      const uploaded = await params.storage.uploadFile({
        parentId: driveFolder!.id,
        name: planned.thumb,
        mimeType: "image/jpeg",
        contents: thumbBuffer,
      });
      const directUrl = getDropboxDirectImageUrl(uploaded.webViewLink);
      if (!directUrl) {
        throw new Error(
          "The thumbnail uploaded, but Dropbox did not return a shared link that Google Sheets can load as an image.",
        );
      }
      return {
        uploaded,
        thumbnailFormula: buildSheetsImageFormula(directUrl),
      };
    })(),
  ]);
  timings.dropboxDerivativeUploadsMs = Date.now() - derivativeUploadsStarted;

  if (hrSettled.status === "fulfilled") hr = hrSettled.value;
  if (webSettled.status === "fulfilled") web = webSettled.value;
  if (thumbSettled.status === "fulfilled") thumb = thumbSettled.value.uploaded;

  lastCompletedStage = lastCompletedDerivativeUploadStage({
    hr: Boolean(hr),
    web: Boolean(web),
    thumb: Boolean(thumb),
    previous: lastCompletedStage,
  });

  const failedUpload = firstFailedDerivativeUpload({
    hr: hrSettled.status === "rejected" ? hrSettled.reason : undefined,
    web: webSettled.status === "rejected" ? webSettled.reason : undefined,
    thumb: thumbSettled.status === "rejected" ? thumbSettled.reason : undefined,
  });

  if (failedUpload) {
    if (failedUpload.error instanceof TestFaultInjectionError) {
      return fail(
        "DRIVE_UPLOAD_FAILED",
        failedUpload.error.message,
        failedUpload.operation,
        {
          causeDetail: failedUpload.error.code,
          normalizedErrorCode: failedUpload.error.code,
        },
      );
    }
    const mapped = mapProcessingError(failedUpload.error);
    const message =
      failedUpload.operation === "upload_thumb" &&
      failedUpload.error instanceof Error
        ? failedUpload.error.message
        : mapped.message;
    return fail("DRIVE_UPLOAD_FAILED", message, failedUpload.operation, {
      httpStatus: mapped.httpStatus,
      googleReason: mapped.googleReason,
      causeDetail: mapped.causeDetail,
    });
  }

  if (
    hrSettled.status !== "fulfilled" ||
    webSettled.status !== "fulfilled" ||
    thumbSettled.status !== "fulfilled"
  ) {
    return fail(
      "DRIVE_UPLOAD_FAILED",
      "A derivative image could not be uploaded.",
      "upload_hr",
    );
  }

  hrBuffer = Buffer.alloc(0);
  webBuffer = Buffer.alloc(0);
  thumbBuffer = Buffer.alloc(0);

  const thumbnailFormula = thumbSettled.value.thumbnailFormula;
  lastCompletedStage = "thumb_uploaded";
  logSubmissionEvent({
    event: "stage",
    submissionAttemptId: params.submissionAttemptId,
    clientArtworkId: params.artwork.clientArtworkId,
    inventoryId: params.claim.inventoryId,
    claimId: params.claim.claimId,
    stage: "thumb_uploaded",
    lastCompletedStage,
    nextOperation: "upload_metadata",
    resourceIds: {
      hrId: hr?.id,
      webId: web?.id,
      thumbId: thumb?.id,
    },
    durationMs: timings.dropboxDerivativeUploadsMs,
  });

  // 7. Generate + upload portable metadata file (before Sheet append)
  const createdAt = isoNow();
  try {
    const portable = buildPortableArtworkMetadata({
      inventoryId: params.claim.inventoryId,
      metadata,
      master: master!,
      hr: hr!,
      web: web!,
      thumb: thumb!,
      folder: driveFolder!,
      metadataFilename: planned.metadata,
      createdAt,
    });
    const metadataBytes = portableArtworkMetadataBuffer(portable);

    logSubmissionEvent({
      event: "operation",
      submissionAttemptId: params.submissionAttemptId,
      clientArtworkId: params.artwork.clientArtworkId,
      inventoryId: params.claim.inventoryId,
      claimId: params.claim.claimId,
      lastCompletedStage,
      nextOperation: "upload_metadata",
      detail: `filename=${planned.metadata}; bytes=${metadataBytes.byteLength}`,
    });

    await writeTempFile(
      params.artworkTempDir,
      planned.metadata,
      metadataBytes,
    );

    metadataFile = await params.storage.uploadFile({
      parentId: driveFolder!.id,
      name: planned.metadata,
      mimeType: ARTWORK_METADATA_MIME_TYPE,
      contents: metadataBytes,
    });
    lastCompletedStage = "metadata_uploaded";
    logSubmissionEvent({
      event: "stage",
      submissionAttemptId: params.submissionAttemptId,
      clientArtworkId: params.artwork.clientArtworkId,
      inventoryId: params.claim.inventoryId,
      claimId: params.claim.claimId,
      stage: "metadata_uploaded",
      lastCompletedStage,
      nextOperation: "append_inventory_row",
      resourceIds: { metadataId: metadataFile.id },
    });
  } catch (error) {
    const mapped = mapProcessingError(error);
    warnings.push({
      code: "DRIVE_FILES_WITHOUT_METADATA",
      message: `Master, high-resolution, web, and thumbnail images uploaded successfully, but ${planned.metadata} could not be created or uploaded.`,
    });
    return fail(
      "DRIVE_UPLOAD_FAILED",
      `The master, high-resolution, web, and thumbnail images uploaded successfully, but ${planned.metadata} could not be created or uploaded. The claimed Inventory ID, artwork folder, and image files are preserved for safe retry. ${mapped.message}`,
      "upload_metadata",
      {
        httpStatus: mapped.httpStatus,
        googleReason: mapped.googleReason,
        causeDetail: mapped.causeDetail,
      },
    );
  }

  // 8. Append inventory row (only after images + metadata exist)
  const sheetsStarted = Date.now();
  try {
    const row = buildArtworkInventoryRow({
      inventoryId: params.claim.inventoryId,
      metadata,
      links: {
        masterFilename: master!.name,
        masterFileUrl: master!.webViewLink,
        hrFilename: hr!.name,
        hrFileUrl: hr!.webViewLink,
        webFilename: web!.name,
        webFileUrl: web!.webViewLink,
        artworkFolderUrl: driveFolder!.webViewLink,
      },
      thumbnailFormula,
      createdAt,
    });
    // Do not blindly retry appends
    await appendArtworkInventoryRow(row, params.spreadsheetId);
    timings.sheetsAppendMs = Date.now() - sheetsStarted;
    sheetRowWritten = true;
    lastCompletedStage = "sheet_row_appended";
  } catch (error) {
    timings.sheetsAppendMs = Date.now() - sheetsStarted;
    const mapped = mapProcessingError(error);
    warnings.push({
      code: "DRIVE_FILES_WITHOUT_INVENTORY_ROW",
      message: `Archive image files and ${planned.metadata} were uploaded, but the Artwork Inventory row was not written.`,
    });
    return fail(
      "SHEET_APPEND_FAILED",
      mapped.message,
      "append_inventory_row",
      {
        httpStatus: mapped.httpStatus,
        googleReason: mapped.googleReason,
        causeDetail: mapped.causeDetail,
      },
    );
  }

  // 9. Mark claim Completed
  const completedAt = isoNow();
  const completedMark = await markClaim(
    params.spreadsheetId,
    params.claim.claimId,
    "Completed",
    completedAt,
  );

  cleanup.tempFilesRemoved = await removeTempDir(params.artworkTempDir);

  if (!completedMark.ok) {
    warnings.push({
      code: "INVENTORY_ROW_WITHOUT_COMPLETED_CLAIM",
      message: `${storageLabel} files and the Artwork Inventory row exist, but the claim status could not be marked Completed. Manual correction is required. Do not resubmit automatically.`,
    });
    logSubmissionEvent({
      event: "artwork_reconciliation_required",
      submissionAttemptId: params.submissionAttemptId,
      clientArtworkId: params.artwork.clientArtworkId,
      inventoryId: params.claim.inventoryId,
      claimId: params.claim.claimId,
      stage: "reconciliation_required",
      lastCompletedStage,
      failedOperation: "mark_claim_completed",
      outcome: "reconciliation_required",
      resourceIds: {
        folderId: driveFolder!.id,
        masterId: master!.id,
        hrId: hr!.id,
        webId: web!.id,
        thumbId: thumb!.id,
        metadataId: metadataFile!.id,
      },
      detail: completedMark.reason,
    });

    logIntakeTimings();
    const result: ArtworkSubmissionSuccess = {
      ok: true,
      ...base(),
      stage: "reconciliation_required",
      inventoryId: params.claim.inventoryId,
      claimId: params.claim.claimId,
      driveFolder: driveFolder!,
      master: master!,
      hr: hr!,
      web: web!,
      thumb: thumb!,
      metadata: metadataFile!,
      sheetRowWritten: true,
      claimStatus: "Processing",
      reconciliationWarnings: warnings,
    };
    return result;
  }

  lastCompletedStage = "completed";
  logSubmissionEvent({
    event: "artwork_completed",
    submissionAttemptId: params.submissionAttemptId,
    clientArtworkId: params.artwork.clientArtworkId,
    inventoryId: params.claim.inventoryId,
    claimId: params.claim.claimId,
    stage: "completed",
    lastCompletedStage,
    outcome: "completed",
    resourceIds: {
      folderId: driveFolder!.id,
      masterId: master!.id,
      hrId: hr!.id,
      webId: web!.id,
      thumbId: thumb!.id,
      metadataId: metadataFile!.id,
    },
  });

  logIntakeTimings();
  return {
    ok: true,
    ...base(),
    stage: "completed",
    inventoryId: params.claim.inventoryId,
    claimId: params.claim.claimId,
    driveFolder: driveFolder!,
    master: master!,
    hr: hr!,
    web: web!,
    thumb: thumb!,
    metadata: metadataFile!,
    sheetRowWritten: true,
    claimStatus: "Completed",
    reconciliationWarnings: warnings,
  };
}

export function artworkTempDir(
  batchTempDir: string,
  clientArtworkId: string,
): string {
  return join(batchTempDir, clientArtworkId);
}
