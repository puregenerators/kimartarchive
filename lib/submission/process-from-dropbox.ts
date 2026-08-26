import "server-only";

import { mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { planFilenamesForArtwork } from "@/lib/artwork/filenames";
import { getDropboxDirectImageUrl } from "@/lib/dropbox/direct-image-url";
import { DropboxIntegrationError } from "@/lib/dropbox/errors";
import { getDropboxFilesOps } from "@/lib/dropbox/files";
import { GoogleIntegrationError } from "@/lib/google/errors";
import { buildSheetsImageFormula } from "@/lib/google/inventory-thumbnail";
import {
  appendArtworkInventoryRow,
  readArtworkInventoryTable,
  readInventoryClaimRows,
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
import { findClaimRowByClaimId } from "@/lib/submission/append-claims";
import { artworkInventoryHasRow } from "@/lib/submission/inventory-lookup";
import { buildArtworkInventoryRow } from "@/lib/submission/inventory-row";
import { emptyIntakeTimings, formatIntakeTimings } from "@/lib/submission/intake-diagnostics";
import {
  firstFailedDerivativeUpload,
  lastCompletedDerivativeUploadStage,
} from "@/lib/submission/parallel-stages";
import { removeTempDir, writeTempFile } from "@/lib/submission/temp-files";
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
  DriveResourceRef,
  ReconciliationWarning,
  SubmissionErrorCode,
  SubmissionFailedOperation,
} from "@/lib/submission/types";
import { emptyCleanupResult } from "@/lib/submission/types";
import { canReuseClaimStatus } from "@/lib/submission/upload-link-logic";
import type { StorageProvider } from "@/lib/storage/types";

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
    return {
      code:
        error.code === "QUOTA_OR_TRANSIENT"
          ? "GOOGLE_TRANSIENT"
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
      error instanceof Error ? error.message : "Image processing failed.";
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

export type ProcessFromDropboxParams = {
  submissionAttemptId: string;
  artwork: ArtworkSubmissionInput;
  shared: {
    exhibition: string;
    gallery: string;
    photographer: string;
  };
  claimId: string;
  inventoryId: number;
  dropboxPath: string;
  spreadsheetId: string;
  storage: StorageProvider;
};

export async function processArtworkFromDropbox(
  params: ProcessFromDropboxParams,
): Promise<ArtworkSubmissionResult> {
  const startedAt = isoNow();
  const intakeStartedMs = Date.now();
  const timings = emptyIntakeTimings();
  const metadata = resolveArtworkMetadata(params.artwork, params.shared);
  const cleanup = emptyCleanupResult();
  const warnings: ReconciliationWarning[] = [];
  const tempDir = join(tmpdir(), `kimartarchive-process-${crypto.randomUUID()}`);
  await mkdir(tempDir, { recursive: true, mode: 0o700 });

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
    inventoryId: params.inventoryId,
    claimId: params.claimId,
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
      inventoryId: params.inventoryId,
      claimId: params.claimId,
      lastCompletedStage,
      detail: `${formatIntakeTimings(timings)}; source=dropbox_file_backed_sequential`,
      durationMs: timings.totalIntakeMs,
      timings,
    });
  };

  const failKeepProcessing = async (
    errorCode: SubmissionErrorCode,
    message: string,
    failedOperation: SubmissionFailedOperation,
    options?: {
      httpStatus?: number;
      googleReason?: string;
      causeDetail?: string;
      normalizedErrorCode?: string;
    },
  ): Promise<ArtworkSubmissionFailure> => {
    cleanup.folderMovedToFailedIntake = null;
    cleanup.tempFilesRemoved = await removeTempDir(tempDir);

    logIntakeTimings();
    logSubmissionEvent({
      event: "artwork_failed",
      submissionAttemptId: params.submissionAttemptId,
      clientArtworkId: params.artwork.clientArtworkId,
      inventoryId: params.inventoryId,
      claimId: params.claimId,
      lastCompletedStage,
      failedOperation,
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
      stage: "failed",
      lastCompletedStage,
      failedOperation,
      claimStatus: "Processing",
      errorCode,
      message,
    };
  };

  const claimRows = await readInventoryClaimRows(params.spreadsheetId);
  const claimRow = findClaimRowByClaimId(claimRows, params.claimId);
  if (!claimRow || claimRow.inventoryId !== params.inventoryId) {
    cleanup.tempFilesRemoved = await removeTempDir(tempDir);
    return failKeepProcessing(
      "CLAIM_UPDATE_FAILED",
      "Inventory claim was not found for this artwork.",
      "mark_claim_processing",
    );
  }

  if (claimRow.status === "Completed") {
    const table = await readArtworkInventoryTable(params.spreadsheetId);
    sheetRowWritten = artworkInventoryHasRow(table.rows, params.inventoryId);
    cleanup.tempFilesRemoved = await removeTempDir(tempDir);
    lastCompletedStage = "completed";
    const folderName = buildArtworkFolderName({
      year: metadata.year,
      inventoryId: params.inventoryId,
      title: metadata.title,
    });
    driveFolder = {
      id: `/${folderName}`,
      name: folderName,
      webViewLink: "",
    };
    const success = {
      ok: true as const,
      ...base(),
      stage: "completed" as const,
      inventoryId: params.inventoryId,
      claimId: params.claimId,
      driveFolder: driveFolder!,
      master: master ?? { id: params.dropboxPath, name: "", webViewLink: "" },
      hr: hr ?? { id: "", name: "", webViewLink: "" },
      web: web ?? { id: "", name: "", webViewLink: "" },
      thumb: thumb ?? { id: "", name: "", webViewLink: "" },
      metadata: metadataFile ?? { id: "", name: "", webViewLink: "" },
      sheetRowWritten: true as const,
      claimStatus: "Completed" as const,
      reconciliationWarnings: warnings,
    };
    return success;
  }

  if (!canReuseClaimStatus(claimRow.status)) {
    cleanup.tempFilesRemoved = await removeTempDir(tempDir);
    return failKeepProcessing(
      "CLAIM_UPDATE_FAILED",
      "This inventory claim cannot be retried.",
      "mark_claim_processing",
    );
  }

  const processingMark = await markClaim(
    params.spreadsheetId,
    params.claimId,
    "Processing",
  );
  if (!processingMark.ok) {
    return failKeepProcessing(
      "CLAIM_UPDATE_FAILED",
      `Could not mark claim Processing (${processingMark.reason}).`,
      "mark_claim_processing",
    );
  }
  lastCompletedStage = "processing";

  const folderName = buildArtworkFolderName({
    year: metadata.year,
    inventoryId: params.inventoryId,
    title: metadata.title,
  });
  const planned = planFilenamesForArtwork({
    year: metadata.year,
    inventoryId: params.inventoryId,
    title: metadata.title,
    masterFilename: params.artwork.originalFilename,
  });
  const folderPath = `/${folderName}`;
  const ops = await getDropboxFilesOps();
  const folderLink = await ops.createSharedLink(folderPath).catch(() => null);
  driveFolder = {
    id: folderPath,
    name: folderName,
    webViewLink: folderLink?.url ?? params.storage.getArchiveRootUrl() ?? "",
  };

  if (params.dropboxPath !== `${folderPath}/${planned.master}`) {
    return failKeepProcessing(
      "INVALID_BATCH",
      "Dropbox master path does not match the reserved artwork folder.",
      "upload_master",
    );
  }

  const masterMeta = await ops.getMetadata(params.dropboxPath).catch(() => null);
  if (!masterMeta || masterMeta.isFolder || masterMeta.size <= 0) {
    return failKeepProcessing(
      "MISSING_FILE",
      "The master file is not in Dropbox yet. Upload it, then retry processing.",
      "upload_master",
    );
  }
  lastCompletedStage = "folder_created";

  const masterLink = await ops.createSharedLink(params.dropboxPath);
  master = {
    id: params.dropboxPath,
    name: planned.master,
    webViewLink: masterLink.url,
  };
  lastCompletedStage = "master_uploaded";

  const localMasterPath = join(tempDir, planned.master);
  try {
    const downloaded = await ops.downloadFileToPath(
      params.dropboxPath,
      localMasterPath,
    );
    const info = await stat(localMasterPath);
    if (info.size <= 0 || downloaded.size <= 0) {
      return failKeepProcessing(
        "MISSING_FILE",
        "Downloaded master file is empty.",
        "upload_master",
      );
    }

    const processed = await processArtworkImage({
      sourcePath: localMasterPath,
      sourceByteLength: info.size,
      originalFilename: params.artwork.originalFilename,
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
    lastCompletedStage = "derivatives_generated";

    let hrBuffer = processed.hr.buffer;
    let webBuffer = processed.web.buffer;
    let thumbBuffer = processed.thumb.buffer;

    const derivativeUploadsStarted = Date.now();
    const [hrSettled, webSettled, thumbSettled] = await Promise.allSettled([
      (async () => {
        maybeThrowTestFault({
          operation: "upload_high_resolution",
          artworkIndex: params.artwork.order,
        });
        await writeTempFile(tempDir, planned.hr, hrBuffer);
        return params.storage.uploadFile({
          parentId: folderPath,
          name: planned.hr,
          mimeType: "image/jpeg",
          contents: hrBuffer,
        });
      })(),
      (async () => {
        await writeTempFile(tempDir, planned.web, webBuffer);
        return params.storage.uploadFile({
          parentId: folderPath,
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
        await writeTempFile(tempDir, planned.thumb, thumbBuffer);
        const uploaded = await params.storage.uploadFile({
          parentId: folderPath,
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
        return { uploaded, thumbnailFormula: buildSheetsImageFormula(directUrl) };
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
        return failKeepProcessing(
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
      return failKeepProcessing(
        "DRIVE_UPLOAD_FAILED",
        mapped.message,
        failedUpload.operation,
        {
          httpStatus: mapped.httpStatus,
          googleReason: mapped.googleReason,
          causeDetail: mapped.causeDetail,
        },
      );
    }

    hrBuffer = Buffer.alloc(0);
    webBuffer = Buffer.alloc(0);
    thumbBuffer = Buffer.alloc(0);
    const thumbnailFormula =
      thumbSettled.status === "fulfilled"
        ? thumbSettled.value.thumbnailFormula
        : "";
    lastCompletedStage = "thumb_uploaded";

    const createdAt = isoNow();
    const portable = buildPortableArtworkMetadata({
      inventoryId: params.inventoryId,
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
    await writeTempFile(tempDir, planned.metadata, metadataBytes);
    metadataFile = await params.storage.uploadFile({
      parentId: folderPath,
      name: planned.metadata,
      mimeType: ARTWORK_METADATA_MIME_TYPE,
      contents: metadataBytes,
    });
    lastCompletedStage = "metadata_uploaded";

    const table = await readArtworkInventoryTable(params.spreadsheetId);
    if (artworkInventoryHasRow(table.rows, params.inventoryId)) {
      sheetRowWritten = true;
    } else {
      const row = buildArtworkInventoryRow({
        inventoryId: params.inventoryId,
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
      await appendArtworkInventoryRow(row, params.spreadsheetId);
      sheetRowWritten = true;
    }
    lastCompletedStage = "sheet_row_appended";

    const completedAt = isoNow();
    const completedMark = await markClaim(
      params.spreadsheetId,
      params.claimId,
      "Completed",
      completedAt,
    );
    cleanup.tempFilesRemoved = await removeTempDir(tempDir);

    if (!completedMark.ok) {
      warnings.push({
        code: "INVENTORY_ROW_WITHOUT_COMPLETED_CLAIM",
        message:
          "Dropbox files and the Artwork Inventory row exist, but the claim status could not be marked Completed. Manual correction is required. Do not resubmit automatically.",
      });
      const result: ArtworkSubmissionSuccess = {
        ok: true,
        ...base(),
        stage: "reconciliation_required",
        inventoryId: params.inventoryId,
        claimId: params.claimId,
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
      logIntakeTimings();
      return result;
    }

    lastCompletedStage = "completed";
    logIntakeTimings();
    return {
      ok: true,
      ...base(),
      stage: "completed",
      inventoryId: params.inventoryId,
      claimId: params.claimId,
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
  } catch (error) {
    const mapped = mapProcessingError(error);
    const thumbnailFailed =
      error &&
      typeof error === "object" &&
      "code" in error &&
      String((error as { code: string }).code) === "THUMBNAIL_GENERATION_FAILED";
    return failKeepProcessing(
      mapped.code,
      mapped.message,
      thumbnailFailed ? "generate_thumbnail" : "generate_derivatives",
      {
        httpStatus: mapped.httpStatus,
        googleReason: mapped.googleReason,
        causeDetail: mapped.causeDetail,
      },
    );
  }
}
