import "server-only";

import { planFilenamesForArtwork } from "@/lib/artwork/filenames";
import { getDropboxFilesOps } from "@/lib/dropbox/files";
import {
  appendInventoryClaimRows,
  readInventoryClaimRows,
  spreadsheetBrowserUrl,
  updateInventoryClaimInventoryId,
  updateInventoryClaimStatus,
} from "@/lib/google/sheets";
import { logSubmissionEvent } from "@/lib/submission/audit-log";
import { registerSubmissionAttempt } from "@/lib/submission/attempt-guard";
import { withDropboxAllocationLock } from "@/lib/submission/allocation-lock";
import {
  applyRepairedInventoryIds,
  findClaimRowByClaimId,
  inventoryIdsAreUnique,
  parseClaimSheetDataRows,
  repairDuplicateClaimInventoryIds,
} from "@/lib/submission/append-claims";
import {
  allocateInventoryIds,
  bindClaimsToArtworks,
  buildArtworkFolderName,
  buildClaimRows,
  parseInventoryIdsFromClaimRows,
  resolveArtworkMetadata,
} from "@/lib/submission/claim-logic";
import {
  canReuseClaimStatus,
  expectedMasterDropboxPath,
} from "@/lib/submission/upload-link-logic";
import { inventoryAllocationMutex } from "@/lib/submission/mutex";
import { runSubmissionPreflight } from "@/lib/submission/preflight";
import type {
  ArtworkBatchSubmissionInput,
  ArtworkSubmissionInput,
  ClaimedArtwork,
} from "@/lib/submission/types";
import type {
  PreparedArtwork,
  RetryClaimRef,
} from "@/lib/submission/direct-intake-types";
import {
  validateSubmissionBatchDeclared,
  type DeclaredArtworkFileInput,
} from "@/lib/submission/validate-input";

export type { PreparedArtwork, RetryClaimRef } from "@/lib/submission/direct-intake-types";

export type PrepareDirectIntakeResult =
  | {
      ok: true;
      kind: "prepared";
      submissionAttemptId: string;
      archiveTarget: "test" | "production";
      sheetUrl: string | null;
      driveRootUrl: string | null;
      artworks: PreparedArtwork[];
    }
  | {
      ok: false;
      kind: "preflight_failed" | "duplicate_attempt" | "invalid_request";
      submissionAttemptId: string | null;
      archiveTarget: "test" | "production" | null;
      code: string;
      message: string;
    };

async function verifyAndRepairClaimAppend(params: {
  spreadsheetId: string;
  claims: ClaimedArtwork[];
}): Promise<ClaimedArtwork[]> {
  const afterRows = await readInventoryClaimRows(params.spreadsheetId);
  const afterIds = parseInventoryIdsFromClaimRows(afterRows);
  if (inventoryIdsAreUnique(afterIds)) {
    return params.claims;
  }

  const ourClaimIds = new Set(params.claims.map((claim) => claim.claimId));
  const cloned = afterRows.map((row) => [...row]);
  const repaired = repairDuplicateClaimInventoryIds({
    dataRows: cloned,
    ourClaimIds,
  });

  for (const update of repaired.updates) {
    await updateInventoryClaimInventoryId({
      claimId: update.claimId,
      inventoryId: update.to,
      spreadsheetId: params.spreadsheetId,
    });
  }

  const verifiedRows = await readInventoryClaimRows(params.spreadsheetId);
  const verifiedIds = parseInventoryIdsFromClaimRows(verifiedRows);
  if (!inventoryIdsAreUnique(verifiedIds)) {
    throw new Error(
      "Inventory ID allocation collided and could not be repaired. Check Inventory Claims before retrying.",
    );
  }

  return applyRepairedInventoryIds(params.claims, repaired.nextByClaimId);
}

export async function prepareDirectIntake(params: {
  submissionAttemptId: string;
  shared: ArtworkBatchSubmissionInput["shared"];
  artworks: ArtworkSubmissionInput[];
  files: DeclaredArtworkFileInput[];
  retryClaims?: RetryClaimRef[];
}): Promise<PrepareDirectIntakeResult> {
  const attempt = registerSubmissionAttempt(params.submissionAttemptId);
  const retryByArtwork = new Map(
    (params.retryClaims ?? []).map((entry) => [entry.clientArtworkId, entry]),
  );
  const reusingAttempt = !attempt.ok && attempt.reason === "duplicate";
  if (!attempt.ok && attempt.reason === "invalid_id") {
    return {
      ok: false,
      kind: "invalid_request",
      submissionAttemptId: params.submissionAttemptId || null,
      archiveTarget: null,
      code: "INVALID_BATCH",
      message: "A valid submission-attempt ID is required.",
    };
  }
  if (reusingAttempt && retryByArtwork.size === 0) {
    return {
      ok: false,
      kind: "duplicate_attempt",
      submissionAttemptId: params.submissionAttemptId,
      archiveTarget: null,
      code: "DUPLICATE_ATTEMPT",
      message:
        "This submission-attempt ID was already used. Retry the existing Processing claims instead of allocating new inventory IDs.",
    };
  }

  const preflight = await runSubmissionPreflight();
  if (!preflight.ok) {
    return {
      ok: false,
      kind: "preflight_failed",
      submissionAttemptId: params.submissionAttemptId,
      archiveTarget: null,
      code: "PREFLIGHT_FAILED",
      message: preflight.message,
    };
  }
  if (preflight.storage.kind !== "dropbox") {
    return {
      ok: false,
      kind: "preflight_failed",
      submissionAttemptId: params.submissionAttemptId,
      archiveTarget: preflight.archive.target,
      code: "PREFLIGHT_FAILED",
      message: "Direct master upload requires Dropbox storage.",
    };
  }

  const validated = validateSubmissionBatchDeclared({
    submissionAttemptId: params.submissionAttemptId,
    shared: params.shared,
    artworks: params.artworks,
    files: params.files,
  });
  if (!validated.ok) {
    return {
      ok: false,
      kind: "invalid_request",
      submissionAttemptId: params.submissionAttemptId,
      archiveTarget: preflight.archive.target,
      code: "INVALID_BATCH",
      message: validated.message,
    };
  }

  const { archive, storage, archiveRootUrl } = preflight;
  const { input, filesByArtworkId } = validated;
  const existingRows = await readInventoryClaimRows(archive.sheetId);
  const reusable: ClaimedArtwork[] = [];
  const toAllocate: ArtworkSubmissionInput[] = [];

  for (const artwork of input.artworks) {
    const retry = retryByArtwork.get(artwork.clientArtworkId);
    if (!retry) {
      toAllocate.push(artwork);
      continue;
    }
    const row = findClaimRowByClaimId(existingRows, retry.claimId);
    if (
      !row ||
      row.inventoryId !== retry.inventoryId ||
      !canReuseClaimStatus(row.status)
    ) {
      return {
        ok: false,
        kind: "invalid_request",
        submissionAttemptId: params.submissionAttemptId,
        archiveTarget: archive.target,
        code: "INVALID_BATCH",
        message: `Cannot reuse inventory claim ${retry.inventoryId}. Retry only Claimed or Processing claims.`,
      };
    }
    reusable.push({
      clientArtworkId: artwork.clientArtworkId,
      order: artwork.order,
      claimId: row.claimId,
      inventoryId: row.inventoryId,
      claimStatus: row.status === "Processing" ? "Processing" : "Claimed",
    });
  }

  let allocated: ClaimedArtwork[] = [];
  if (toAllocate.length > 0) {
    const ops = await getDropboxFilesOps();
    allocated = await inventoryAllocationMutex.runExclusive(async () =>
      withDropboxAllocationLock({
        ops,
        run: async () => {
          const latestRows = await readInventoryClaimRows(archive.sheetId);
          const existingIds = parseInventoryIdsFromClaimRows(latestRows);
          const inventoryIds = allocateInventoryIds(
            existingIds,
            toAllocate.length,
          );
          const built = buildClaimRows(inventoryIds);
          const bound = bindClaimsToArtworks(built.claims, toAllocate);
          await appendInventoryClaimRows(built.rows, archive.sheetId);
          return verifyAndRepairClaimAppend({
            spreadsheetId: archive.sheetId,
            claims: bound,
          });
        },
      }),
    );
  }

  const claims = [...reusable, ...allocated].sort((a, b) => a.order - b.order);
  const prepared: PreparedArtwork[] = [];

  for (const artwork of input.artworks) {
    const claim = claims.find(
      (entry) => entry.clientArtworkId === artwork.clientArtworkId,
    );
    if (!claim) {
      return {
        ok: false,
        kind: "invalid_request",
        submissionAttemptId: params.submissionAttemptId,
        archiveTarget: archive.target,
        code: "INVALID_BATCH",
        message: "Internal error: claim missing for artwork.",
      };
    }
    const file = filesByArtworkId.get(artwork.clientArtworkId)!;
    const metadata = resolveArtworkMetadata(artwork, input.shared);
    const folderName = buildArtworkFolderName({
      year: metadata.year,
      inventoryId: claim.inventoryId,
      title: metadata.title,
    });
    const planned = planFilenamesForArtwork({
      year: metadata.year,
      inventoryId: claim.inventoryId,
      title: metadata.title,
      masterFilename: file.filename,
    });
    const folderPath = `/${folderName}`;
    const masterPath = expectedMasterDropboxPath({
      year: metadata.year,
      inventoryId: claim.inventoryId,
      title: metadata.title,
      masterFilename: planned.master,
    });

    const existingFolder = await storage.findChildFolderByName(folderName);
    if (existingFolder && !retryByArtwork.has(artwork.clientArtworkId)) {
      await updateInventoryClaimStatus({
        claimId: claim.claimId,
        status: "Failed",
        completedAt: "",
        spreadsheetId: archive.sheetId,
      });
      continue;
    }
    if (!existingFolder) {
      await storage.createArtworkFolder(folderName);
    }

    const ops = await getDropboxFilesOps();
    const masterAlreadyUploaded = await ops.pathExists(masterPath);

    prepared.push({
      clientArtworkId: artwork.clientArtworkId,
      order: artwork.order,
      claimId: claim.claimId,
      inventoryId: claim.inventoryId,
      claimStatus: claim.claimStatus === "Processing" ? "Processing" : "Claimed",
      folderName,
      folderPath,
      masterFilename: planned.master,
      masterPath,
      masterAlreadyUploaded,
      reusedClaim: retryByArtwork.has(artwork.clientArtworkId),
    });
  }

  logSubmissionEvent({
    event: "batch_started",
    submissionAttemptId: input.submissionAttemptId,
    archiveTarget: archive.target,
    detail: `direct_intake_prepare artworks=${prepared.length}; reused=${reusable.length}`,
  });

  return {
    ok: true,
    kind: "prepared",
    submissionAttemptId: input.submissionAttemptId,
    archiveTarget: archive.target,
    sheetUrl: spreadsheetBrowserUrl(archive.sheetId),
    driveRootUrl: archiveRootUrl ?? storage.getArchiveRootUrl(),
    artworks: prepared,
  };
}

export function findClaimFromRows(
  dataRows: readonly (readonly string[])[],
  claimId: string,
) {
  const row = findClaimRowByClaimId(dataRows, claimId);
  if (!row) return null;
  const parsed = parseClaimSheetDataRows(dataRows).find(
    (entry) => entry.claimId === claimId,
  );
  return parsed ?? row;
}
