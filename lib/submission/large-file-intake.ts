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
import { mapImageProcessingError } from "@/lib/images/errors";
import { validateArtworkSourceImage } from "@/lib/images/process-artwork-image";
import { findClaimRowByClaimId } from "@/lib/submission/append-claims";
import { logSubmissionEvent } from "@/lib/submission/audit-log";
import { isoNow } from "@/lib/submission/claim-logic";
import { artworkInventoryHasRow } from "@/lib/submission/inventory-lookup";
import {
  buildPendingLargeFileIntake,
  bytesPerSampleFromSharpDepth,
  canCheckOrProcessClaimStatus,
  decideDismissIncompleteIntake,
  decideIncompleteIntakeListing,
  emptyArchiveFilePresence,
  estimateProcessingMemory,
  gateLargeFileClaimAccess,
  inspectDropboxMasterMetadata,
  LARGE_FILE_FILE_NOT_FOUND_MESSAGE,
  localProcessingRequiredReason,
  parsePendingLargeFileIntake,
  pendingIntakeDropboxPath,
  preferSafeFolderUrl,
  requiredCompletedArchivePaths,
  type ArchiveCompletenessEvidence,
  type IncompleteLargeFileIntake,
  type IntakeSideEffect,
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
      status: "file_not_found",
      ...base,
      byteLength: null,
      width: null,
      height: null,
      bitDepth: null,
      message: LARGE_FILE_FILE_NOT_FOUND_MESSAGE,
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
    const mapped = mapImageProcessingError(error);
    const local =
      mapped.code === "MEMORY_OR_RESOURCE" || mapped.code === "FILE_TOO_LARGE";
    return {
      ok: true,
      status: local ? "local_processing_required" : "unsupported_file",
      ...base,
      byteLength: meta.size,
      width: null,
      height: null,
      bitDepth: null,
      message: mapped.message,
      canContinueProcessing: false,
    };
  } finally {
    await unlink(localPath).catch(() => undefined);
    await removeTempDir(tempDir);
  }
}

async function inspectArchiveCompleteness(
  pending: PendingLargeFileIntake,
  hasInventorySheetRow: boolean,
): Promise<ArchiveCompletenessEvidence> {
  if (!hasInventorySheetRow) {
    return {
      hasInventorySheetRow: false,
      folderExists: false,
      files: emptyArchiveFilePresence(),
    };
  }
  const paths = requiredCompletedArchivePaths(pending);
  const ops = await getDropboxFilesOps();
  const folderExists = await ops.pathExists(paths.folderPath);
  if (!folderExists) {
    return {
      hasInventorySheetRow: true,
      folderExists: false,
      files: emptyArchiveFilePresence(),
    };
  }
  const [master, hr, web, thumb, metadata] = await Promise.all([
    ops.pathExists(paths.masterPath),
    ops.pathExists(paths.hrPath),
    ops.pathExists(paths.webPath),
    ops.pathExists(paths.thumbPath),
    ops.pathExists(paths.metadataPath),
  ]);
  return {
    hasInventorySheetRow: true,
    folderExists: true,
    files: { master, hr, web, thumb, metadata },
  };
}

async function applyIntakeSideEffects(params: {
  claimId: string;
  inventoryId: number;
  clientArtworkId?: string;
  submissionAttemptId?: string;
  spreadsheetId: string;
  sideEffects: readonly IntakeSideEffect[];
  event: string;
  detail: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  for (const effect of params.sideEffects) {
    if (effect.kind === "update_claim_status") {
      const result = await updateInventoryClaimStatus({
        claimId: params.claimId,
        status: effect.status,
        completedAt: effect.setCompletedAt ? isoNow() : "",
        spreadsheetId: params.spreadsheetId,
      });
      if (!result.updated) {
        logSubmissionEvent({
          event: `${params.event}_claim_update_failed`,
          submissionAttemptId: params.submissionAttemptId ?? "",
          clientArtworkId: params.clientArtworkId,
          inventoryId: params.inventoryId,
          claimId: params.claimId,
          outcome: "failed",
          detail: result.reason,
        });
        return { ok: false, reason: result.reason };
      }
      continue;
    }
    if (effect.kind === "delete_pending_intake") {
      await deletePendingLargeFileIntake(params.claimId);
    }
  }
  logSubmissionEvent({
    event: params.event,
    submissionAttemptId: params.submissionAttemptId ?? "",
    clientArtworkId: params.clientArtworkId,
    inventoryId: params.inventoryId,
    claimId: params.claimId,
    outcome: "ok",
    detail: params.detail,
  });
  return { ok: true };
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
    if (!canCheckOrProcessClaimStatus(status)) continue;
    const pending = await readPendingLargeFileIntake(claimId);
    if (!pending) continue;
    const hasInventorySheetRow = artworkInventoryHasRow(
      table.rows,
      pending.inventoryId,
    );
    let completeness: ArchiveCompletenessEvidence = {
      hasInventorySheetRow,
      folderExists: false,
      files: emptyArchiveFilePresence(),
    };
    try {
      completeness = await inspectArchiveCompleteness(
        pending,
        hasInventorySheetRow,
      );
    } catch (error) {
      logSubmissionEvent({
        event: "large_file_intake_completeness_check_failed",
        submissionAttemptId: pending.submissionAttemptId,
        clientArtworkId: pending.clientArtworkId,
        inventoryId: pending.inventoryId,
        claimId: pending.claimId,
        outcome: "failed",
        detail: error instanceof Error ? error.message : "Unknown error",
      });
    }
    const decision = decideIncompleteIntakeListing({
      claimStatus: status,
      hasPendingIntake: true,
      completeness,
    });
    if (decision.kind === "reconcile_completed") {
      await applyIntakeSideEffects({
        claimId: pending.claimId,
        inventoryId: pending.inventoryId,
        clientArtworkId: pending.clientArtworkId,
        submissionAttemptId: pending.submissionAttemptId,
        spreadsheetId: preflight.archive.sheetId,
        sideEffects: decision.sideEffects,
        event: "large_file_intake_reconciled_completed",
        detail:
          "Verified Artwork Inventory row, archive folder, and required files. Claim marked Completed; artwork was not recreated.",
      });
      continue;
    }
    if (decision.kind === "hide") continue;
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
      declaredByteLength: pending.declaredByteLength,
    });
  }

  return { ok: true, intakes };
}

export async function dismissIncompleteLargeFileIntake(params: {
  authenticated: boolean;
  claimId: string;
  inventoryId: number;
}): Promise<
  | { ok: true; claimStatus: ClaimStatus; alreadyTerminal: boolean }
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
  const decision = decideDismissIncompleteIntake({
    authenticated: true,
    claim: row ? claimFromRow(row) : null,
    pending,
    requestedClaimId: params.claimId,
    requestedInventoryId: params.inventoryId,
  });
  if (!decision.ok) {
    return {
      ok: false,
      status: decision.code === "UNAUTHENTICATED" ? 401 : 400,
      code: decision.code,
      message: decision.message,
    };
  }

  if (!decision.alreadyTerminal && pending && row) {
    const table = await readArtworkInventoryTable(preflight.archive.sheetId);
    const hasInventorySheetRow = artworkInventoryHasRow(
      table.rows,
      pending.inventoryId,
    );
    let completeness: ArchiveCompletenessEvidence = {
      hasInventorySheetRow,
      folderExists: false,
      files: emptyArchiveFilePresence(),
    };
    try {
      completeness = await inspectArchiveCompleteness(
        pending,
        hasInventorySheetRow,
      );
    } catch (error) {
      logSubmissionEvent({
        event: "large_file_intake_completeness_check_failed",
        submissionAttemptId: pending.submissionAttemptId,
        clientArtworkId: pending.clientArtworkId,
        inventoryId: pending.inventoryId,
        claimId: pending.claimId,
        outcome: "failed",
        detail: error instanceof Error ? error.message : "Unknown error",
      });
    }
    const listing = decideIncompleteIntakeListing({
      claimStatus: row.status,
      hasPendingIntake: true,
      completeness,
    });
    if (listing.kind === "reconcile_completed") {
      const applied = await applyIntakeSideEffects({
        claimId: pending.claimId,
        inventoryId: pending.inventoryId,
        clientArtworkId: pending.clientArtworkId,
        submissionAttemptId: pending.submissionAttemptId,
        spreadsheetId: preflight.archive.sheetId,
        sideEffects: listing.sideEffects,
        event: "large_file_intake_reconciled_completed",
        detail:
          "Dismiss requested, but the archive record was complete. Claim marked Completed; artwork was not recreated.",
      });
      if (!applied.ok) {
        return {
          ok: false,
          status: 500,
          code: "CLAIM_UPDATE_FAILED",
          message: "Could not update this inventory claim. Try again.",
        };
      }
      return {
        ok: true,
        claimStatus: "Completed",
        alreadyTerminal: false,
      };
    }
  }

  if (decision.sideEffects.length > 0) {
    const applied = await applyIntakeSideEffects({
      claimId: params.claimId,
      inventoryId: params.inventoryId,
      clientArtworkId: pending?.clientArtworkId,
      submissionAttemptId: pending?.submissionAttemptId,
      spreadsheetId: preflight.archive.sheetId,
      sideEffects: decision.sideEffects,
      event: "large_file_intake_abandoned",
      detail:
        "Incomplete intake dismissed. Inventory ID remains retired. Dropbox files and Artwork Inventory rows were not changed.",
    });
    if (!applied.ok) {
      return {
        ok: false,
        status: 500,
        code: "CLAIM_UPDATE_FAILED",
        message: "Could not update this inventory claim. Try again.",
      };
    }
  } else {
    logSubmissionEvent({
      event: "large_file_intake_abandoned",
      submissionAttemptId: pending?.submissionAttemptId ?? "",
      clientArtworkId: pending?.clientArtworkId,
      inventoryId: params.inventoryId,
      claimId: params.claimId,
      outcome: "ok",
      detail: `Idempotent dismiss; claim already ${decision.claimStatus}.`,
    });
  }

  return {
    ok: true,
    claimStatus: decision.claimStatus,
    alreadyTerminal: decision.alreadyTerminal,
  };
}

export async function processLargeFileIntake(params: {
  authenticated: boolean;
  claimId: string;
  inventoryId: number;
}): Promise<ArtworkSubmissionResult | { ok: false; errorCode: string; message: string; status?: LargeFileIntakeStatus }> {
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
      status: checked.status,
      message: checked.message,
    };
  }
  if (checked.status !== "master_found" || !checked.canContinueProcessing) {
    const missing =
      checked.status === "waiting_for_dropbox" ||
      checked.status === "file_not_found";
    return {
      ok: false,
      errorCode: missing ? "MISSING_FILE" : "INVALID_BATCH",
      status: checked.status,
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
