import "server-only";

import { mkdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDropboxFilesOps } from "@/lib/dropbox/files";
import {
  readArtworkInventoryTable,
  readInventoryClaimRows,
  updateInventoryClaimStatus,
} from "@/lib/google/sheets";
import { validateArtworkSourceImage } from "@/lib/images/process-artwork-image";
import { findClaimRowByClaimId } from "@/lib/submission/append-claims";
import { isoNow } from "@/lib/submission/claim-logic";
import { artworkInventoryHasRow } from "@/lib/submission/inventory-lookup";
import {
  buildPendingLargeFileIntake,
  bytesPerSampleFromSharpDepth,
  estimateProcessingMemory,
  gateLargeFileClaimAccess,
  inspectDropboxMasterMetadata,
  localProcessingRequiredReason,
  parsePendingLargeFileIntake,
  pendingIntakeDropboxPath,
  preferSafeFolderUrl,
  type IncompleteLargeFileIntake,
  type LargeFileCheckResult,
  type LargeFileIntakeStatus,
  type PendingLargeFileIntake,
  PENDING_INTAKES_FOLDER,
  VERCEL_SAFE_DOWNLOAD_BYTES,
} from "@/lib/submission/large-file-intake-logic";
import { processArtworkFromDropbox } from "@/lib/submission/process-from-dropbox";
import { runSubmissionPreflight } from "@/lib/submission/preflight";
import { removeTempDir } from "@/lib/submission/temp-files";
import type {
  ArtworkSubmissionInput,
  ArtworkSubmissionResult,
  ClaimStatus,
} from "@/lib/submission/types";

export type { LargeFileCheckResult, IncompleteLargeFileIntake };

function claimFromRow(row: {
  claimId: string;
  inventoryId: number;
  status: string;
}): { claimId: string; inventoryId: number; claimStatus: ClaimStatus } {
  const status = row.status as ClaimStatus;
  return {
    claimId: row.claimId,
    inventoryId: row.inventoryId,
    claimStatus: status,
  };
}

async function ensurePendingFolder(): Promise<void> {
  const ops = await getDropboxFilesOps();
  if (await ops.pathExists(PENDING_INTAKES_FOLDER)) return;
  try {
    await ops.createFolder(PENDING_INTAKES_FOLDER);
  } catch {
    if (await ops.pathExists(PENDING_INTAKES_FOLDER)) return;
    throw new Error("Could not create the pending large-file intake folder.");
  }
}

export async function writePendingLargeFileIntake(
  pending: PendingLargeFileIntake,
): Promise<void> {
  const path = pendingIntakeDropboxPath(pending.claimId);
  if (!path) {
    throw new Error("Cannot store pending intake for an invalid claim ID.");
  }
  await ensurePendingFolder();
  const ops = await getDropboxFilesOps();
  await ops.uploadBuffer(path, JSON.stringify(pending), { mode: "overwrite" });
}

export async function readPendingLargeFileIntake(
  claimId: string,
): Promise<PendingLargeFileIntake | null> {
  const path = pendingIntakeDropboxPath(claimId);
  if (!path) return null;
  const ops = await getDropboxFilesOps();
  try {
    const buf = await ops.downloadFile(path);
    return parsePendingLargeFileIntake(JSON.parse(buf.toString("utf8")));
  } catch {
    return null;
  }
}

export async function deletePendingLargeFileIntake(claimId: string): Promise<void> {
  const path = pendingIntakeDropboxPath(claimId);
  if (!path) return;
  const ops = await getDropboxFilesOps();
  try {
    await ops.deleteFile(path);
  } catch {
    // Best-effort; processing already succeeded or the file was never written.
  }
}

export async function storePreparedLargeFileIntake(params: {
  claimId: string;
  inventoryId: number;
  clientArtworkId: string;
  submissionAttemptId: string;
  artwork: ArtworkSubmissionInput;
  shared: PendingLargeFileIntake["shared"];
  originalFilename: string;
  declaredByteLength: number;
}): Promise<PendingLargeFileIntake> {
  const pending = buildPendingLargeFileIntake({
    ...params,
    createdAt: isoNow(),
  });
  if (!pending) {
    throw new Error("Could not derive the reserved master path for this claim.");
  }
  await writePendingLargeFileIntake(pending);
  return pending;
}

async function folderWebUrlFor(folderName: string, folderPath: string): Promise<string | null> {
  const ops = await getDropboxFilesOps();
  const shared = await ops.createSharedLink(folderPath).catch(() => null);
  return preferSafeFolderUrl({
    sharedUrl: shared?.url ?? null,
    folderName,
  });
}

export async function checkLargeFileMaster(params: {
  authenticated: boolean;
  claimId: string;
  inventoryId: number;
}): Promise<
  | LargeFileCheckResult
  | { ok: false; status: number; code: string; message: string }
> {
  if (!params.authenticated) {
    return {
      ok: false,
      status: 401,
      code: "UNAUTHENTICATED",
      message: "Authentication required.",
    };
  }

  const preflight = await runSubmissionPreflight();
  if (!preflight.ok) {
    return {
      ok: false,
      status: 503,
      code: "PREFLIGHT_FAILED",
      message: preflight.message,
    };
  }

  const rows = await readInventoryClaimRows(preflight.archive.sheetId);
  const row = findClaimRowByClaimId(rows, params.claimId);
  const pending = await readPendingLargeFileIntake(params.claimId);
  const gated = gateLargeFileClaimAccess({
    authenticated: true,
    claim: row ? claimFromRow(row) : null,
    pending,
    requestedClaimId: params.claimId,
    requestedInventoryId: params.inventoryId,
  });
  if (!gated.ok) {
    return {
      ok: false,
      status: gated.code === "UNAUTHENTICATED" ? 401 : 400,
      code: gated.code,
      message: gated.message,
    };
  }

  const folderWebUrl = await folderWebUrlFor(
    gated.pending.folderName,
    gated.pending.folderPath,
  );
  const base = {
    claimId: gated.pending.claimId,
    inventoryId: gated.pending.inventoryId,
    folderName: gated.pending.folderName,
    folderPath: gated.pending.folderPath,
    masterFilename: gated.pending.masterFilename,
    folderWebUrl,
  };

  if (gated.claimStatus === "Completed") {
    return {
      ok: true,
      status: "completed",
      ...base,
      byteLength: null,
      width: null,
      height: null,
      bitDepth: null,
      message: "This artwork is already completed.",
      canContinueProcessing: false,
    };
  }

  const table = await readArtworkInventoryTable(preflight.archive.sheetId);
  if (artworkInventoryHasRow(table.rows, gated.pending.inventoryId)) {
    return {
      ok: true,
      status: "completed",
      ...base,
      byteLength: null,
      width: null,
      height: null,
      bitDepth: null,
      message: "An Artwork Inventory row already exists for this ID.",
      canContinueProcessing: false,
    };
  }

  if (row && row.status === "Claimed") {
    await updateInventoryClaimStatus({
      claimId: gated.pending.claimId,
      status: "Processing",
      completedAt: "",
      spreadsheetId: preflight.archive.sheetId,
    });
  }

  const ops = await getDropboxFilesOps();
  const meta = await ops.getMetadata(gated.pending.masterPath).catch(() => null);
  if (!meta) {
    return {
      ok: true,
      status: "waiting_for_dropbox",
      ...base,
      byteLength: null,
      width: null,
      height: null,
      bitDepth: null,
      message:
        "The expected master is not in Dropbox yet. Upload it with the exact filename, then check again.",
      canContinueProcessing: false,
    };
  }

  const inspected = inspectDropboxMasterMetadata({
    expectedPath: gated.pending.masterPath,
    expectedFilename: gated.pending.masterFilename,
    path: gated.pending.masterPath,
    name: meta.name,
    isFolder: meta.isFolder,
    size: meta.size,
  });
  if (!inspected.ok) {
    return {
      ok: true,
      status: inspected.status,
      ...base,
      byteLength: meta.size,
      width: null,
      height: null,
      bitDepth: null,
      message: inspected.message,
      canContinueProcessing: false,
    };
  }

  if (meta.size > VERCEL_SAFE_DOWNLOAD_BYTES) {
    return {
      ok: true,
      status: "local_processing_required",
      ...base,
      byteLength: meta.size,
      width: null,
      height: null,
      bitDepth: null,
      message: localProcessingRequiredReason({
        width: 0,
        height: 0,
        channels: 3,
        bytesPerSample: 1,
        sourceByteLength: meta.size,
        decodedBytes: 0,
        estimatedPeakBytes: meta.size,
        safeToProcessOnVercel: false,
      }),
      canContinueProcessing: false,
    };
  }

  const tempDir = join(tmpdir(), `kimartarchive-check-${crypto.randomUUID()}`);
  await mkdir(tempDir, { recursive: true, mode: 0o700 });
  const localPath = join(tempDir, gated.pending.masterFilename);
  try {
    const downloaded = await ops.downloadFileToPath(
      gated.pending.masterPath,
      localPath,
    );
    const { metadata, detectedFormat } = await validateArtworkSourceImage(localPath, {
      originalFilename: gated.pending.originalFilename,
      byteLength: downloaded.size,
      maxSourceBytes: VERCEL_SAFE_DOWNLOAD_BYTES,
    });
    void detectedFormat;
    const bitDepth = bytesPerSampleFromSharpDepth(metadata.depth) * 8;
    const estimate = estimateProcessingMemory({
      width: metadata.width ?? 0,
      height: metadata.height ?? 0,
      channels: metadata.channels ?? 3,
      bytesPerSample: bytesPerSampleFromSharpDepth(metadata.depth),
      sourceByteLength: downloaded.size,
    });
    if (!estimate.safeToProcessOnVercel) {
      return {
        ok: true,
        status: "local_processing_required",
        ...base,
        byteLength: downloaded.size,
        width: estimate.width,
        height: estimate.height,
        bitDepth,
        message: localProcessingRequiredReason(estimate),
        canContinueProcessing: false,
      };
    }
    return {
      ok: true,
      status: "master_found",
      ...base,
      byteLength: downloaded.size,
      width: estimate.width,
      height: estimate.height,
      bitDepth,
      message: "The expected master is in Dropbox and is a readable supported image.",
      canContinueProcessing: true,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "The Dropbox file exists but could not be read as a supported image.";
    return {
      ok: true,
      status: "failed",
      ...base,
      byteLength: meta.size,
      width: null,
      height: null,
      bitDepth: null,
      message,
      canContinueProcessing: false,
    };
  } finally {
    await unlink(localPath).catch(() => undefined);
    await removeTempDir(tempDir);
  }
}

export async function listIncompleteLargeFileIntakes(params: {
  authenticated: boolean;
}): Promise<
  | { ok: true; intakes: IncompleteLargeFileIntake[] }
  | { ok: false; status: number; code: string; message: string }
> {
  if (!params.authenticated) {
    return {
      ok: false,
      status: 401,
      code: "UNAUTHENTICATED",
      message: "Authentication required.",
    };
  }
  const preflight = await runSubmissionPreflight();
  if (!preflight.ok) {
    return {
      ok: false,
      status: 503,
      code: "PREFLIGHT_FAILED",
      message: preflight.message,
    };
  }

  const rows = await readInventoryClaimRows(preflight.archive.sheetId);
  const table = await readArtworkInventoryTable(preflight.archive.sheetId);
  const intakes: IncompleteLargeFileIntake[] = [];

  for (const row of rows) {
    const status = String(row[2] ?? "").trim();
    const claimId = String(row[0] ?? "").trim();
    if (status !== "Claimed" && status !== "Processing") continue;
    const pending = await readPendingLargeFileIntake(claimId);
    if (!pending) continue;
    if (artworkInventoryHasRow(table.rows, pending.inventoryId)) continue;
    const folderWebUrl = preferSafeFolderUrl({
      folderName: pending.folderName,
    });
    intakes.push({
      claimId: pending.claimId,
      inventoryId: pending.inventoryId,
      claimStatus: status as ClaimStatus,
      folderName: pending.folderName,
      masterFilename: pending.masterFilename,
      folderWebUrl,
      title: pending.artwork.title,
      year: pending.artwork.year,
      status: "waiting_for_dropbox",
    });
  }

  return { ok: true, intakes };
}

export async function processLargeFileIntake(params: {
  authenticated: boolean;
  claimId: string;
  inventoryId: number;
}): Promise<ArtworkSubmissionResult | { ok: false; errorCode: string; message: string }> {
  if (!params.authenticated) {
    return {
      ok: false,
      errorCode: "UNAUTHENTICATED",
      message: "Authentication required.",
    };
  }

  const checked = await checkLargeFileMaster({
    authenticated: true,
    claimId: params.claimId,
    inventoryId: params.inventoryId,
  });
  if (!checked.ok) {
    return {
      ok: false,
      errorCode: checked.code,
      message: checked.message,
    };
  }
  if (checked.status === "completed") {
    const preflight = await runSubmissionPreflight();
    if (!preflight.ok) {
      return { ok: false, errorCode: "PREFLIGHT_FAILED", message: preflight.message };
    }
    const pending = await readPendingLargeFileIntake(params.claimId);
    if (!pending) {
      return {
        ok: false,
        errorCode: "INVALID_BATCH",
        message: "This artwork is already completed.",
      };
    }
    return processArtworkFromDropbox({
      submissionAttemptId: pending.submissionAttemptId,
      artwork: pending.artwork,
      shared: pending.shared,
      claimId: pending.claimId,
      inventoryId: pending.inventoryId,
      dropboxPath: pending.masterPath,
      spreadsheetId: preflight.archive.sheetId,
      storage: preflight.storage,
      allowOversizedMaster: true,
    });
  }
  if (checked.status === "local_processing_required") {
    return {
      ok: false,
      errorCode: "LOCAL_PROCESSING_REQUIRED",
      message: checked.message,
    };
  }
  if (checked.status !== "master_found" || !checked.canContinueProcessing) {
    return {
      ok: false,
      errorCode: checked.status === "waiting_for_dropbox" ? "MISSING_FILE" : "INVALID_BATCH",
      message: checked.message,
    };
  }

  const pending = await readPendingLargeFileIntake(params.claimId);
  const preflight = await runSubmissionPreflight();
  if (!pending || !preflight.ok) {
    return {
      ok: false,
      errorCode: preflight.ok ? "INVALID_BATCH" : "PREFLIGHT_FAILED",
      message: preflight.ok
        ? "No reserved large-file intake was found for this claim."
        : preflight.message,
    };
  }

  const result = await processArtworkFromDropbox({
    submissionAttemptId: pending.submissionAttemptId,
    artwork: pending.artwork,
    shared: pending.shared,
    claimId: pending.claimId,
    inventoryId: pending.inventoryId,
    dropboxPath: pending.masterPath,
    spreadsheetId: preflight.archive.sheetId,
    storage: preflight.storage,
    allowOversizedMaster: true,
  });

  if (result.ok && result.stage === "completed") {
    await deletePendingLargeFileIntake(pending.claimId);
  }
  return result;
}
