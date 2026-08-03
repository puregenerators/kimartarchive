import "server-only";

import { mkdir } from "node:fs/promises";

import {
  appendInventoryClaimRows,
  readInventoryClaimRows,
  spreadsheetBrowserUrl,
} from "@/lib/google/sheets";
import { logSubmissionEvent } from "@/lib/submission/audit-log";
import { registerSubmissionAttempt } from "@/lib/submission/attempt-guard";
import {
  allocateInventoryIds,
  bindClaimsToArtworks,
  buildClaimRows,
  parseInventoryIdsFromClaimRows,
} from "@/lib/submission/claim-logic";
import { inventoryAllocationMutex } from "@/lib/submission/mutex";
import { runSubmissionPreflight } from "@/lib/submission/preflight";
import {
  artworkTempDir,
  processOneArtwork,
} from "@/lib/submission/process-one";
import {
  createSubmissionTempDir,
  fileToBufferAndTemp,
  removeTempDir,
} from "@/lib/submission/temp-files";
import type {
  ArtworkBatchSubmissionInput,
  ArtworkSubmissionResult,
  BatchSubmissionResult,
} from "@/lib/submission/types";
import { validateSubmissionBatch } from "@/lib/submission/validate-input";

export type SubmitBatchParams = {
  submissionAttemptId: string;
  shared: ArtworkBatchSubmissionInput["shared"];
  artworks: ArtworkBatchSubmissionInput["artworks"];
  files: { clientArtworkId: string; file: File }[];
};

/**
 * Permanent batch submission orchestrator.
 *
 * 1. Duplicate-attempt guard
 * 2. Global preflight (no claims / no writes on failure)
 * 3. Server-side batch validation
 * 4. Claim all inventory IDs under the local mutex
 * 5. Process artworks sequentially
 * 6. Return one structured report
 */
export async function submitArtworkBatch(
  params: SubmitBatchParams,
): Promise<BatchSubmissionResult> {
  const completedAt = () => new Date().toISOString();

  const attempt = registerSubmissionAttempt(params.submissionAttemptId);
  if (!attempt.ok) {
    return {
      ok: false,
      kind:
        attempt.reason === "duplicate" ? "duplicate_attempt" : "invalid_request",
      submissionAttemptId: params.submissionAttemptId || null,
      archiveTarget: null,
      code:
        attempt.reason === "duplicate" ? "DUPLICATE_ATTEMPT" : "INVALID_BATCH",
      message:
        attempt.reason === "duplicate"
          ? "This submission-attempt ID was already used. Do not automatically retry the whole batch. Check Inventory Claims and Failed Intake before starting a new attempt."
          : "A valid submission-attempt ID is required.",
      completedAt: completedAt(),
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
      completedAt: completedAt(),
    };
  }

  const validated = validateSubmissionBatch({
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
      completedAt: completedAt(),
    };
  }

  const { archive, storage, archiveRootUrl } = preflight;
  const { input, filesByArtworkId } = validated;

  logSubmissionEvent({
    event: "batch_started",
    submissionAttemptId: input.submissionAttemptId,
    archiveTarget: archive.target,
    detail: `artworks=${input.artworks.length}; storage=${storage.kind}`,
  });

  // Claim the full batch's inventory IDs before processing the first artwork.
  const claims = await inventoryAllocationMutex.runExclusive(async () => {
    const existingRows = await readInventoryClaimRows(archive.sheetId);
    const existingIds = parseInventoryIdsFromClaimRows(existingRows);
    const inventoryIds = allocateInventoryIds(
      existingIds,
      input.artworks.length,
    );
    const built = buildClaimRows(inventoryIds);
    const bound = bindClaimsToArtworks(built.claims, input.artworks);
    // Rebuild rows with bound claim IDs already in built.rows
    await appendInventoryClaimRows(built.rows, archive.sheetId);
    return bound;
  });

  const batchTempDir = await createSubmissionTempDir(input.submissionAttemptId);
  const results: ArtworkSubmissionResult[] = [];

  try {
    for (const artwork of input.artworks) {
      const claim = claims.find(
        (c) => c.clientArtworkId === artwork.clientArtworkId,
      );
      if (!claim) {
        results.push({
          ok: false,
          clientArtworkId: artwork.clientArtworkId,
          order: artwork.order,
          title: artwork.title,
          inventoryId: null,
          claimId: null,
          stage: "failed",
          lastCompletedStage: "pending",
          failedOperation: null,
          driveFolder: null,
          master: null,
          hr: null,
          web: null,
          metadata: null,
          sheetRowWritten: false,
          claimStatus: null,
          cleanup: {
            tempFilesRemoved: true,
            folderMovedToFailedIntake: null,
            cleanupWarnings: [],
          },
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          reconciliationWarnings: [],
          errorCode: "UNKNOWN",
          message: "Internal error: claim missing for artwork.",
        });
        continue;
      }

      const file = filesByArtworkId.get(artwork.clientArtworkId)!;
      const tempDir = artworkTempDir(batchTempDir, artwork.clientArtworkId);
      await mkdir(tempDir, { recursive: true, mode: 0o700 });

      const { buffer } = await fileToBufferAndTemp(
        tempDir,
        `source-${artwork.originalFilename || file.name}`,
        file,
      );

      const result = await processOneArtwork({
        submissionAttemptId: input.submissionAttemptId,
        artwork,
        claim,
        shared: input.shared,
        sourceFile: file,
        sourceBytes: buffer,
        artworkTempDir: tempDir,
        spreadsheetId: archive.sheetId,
        storage,
      });

      results.push(result);
      // Process sequentially — do not start the next artwork until this one finishes.
    }
  } finally {
    await removeTempDir(batchTempDir);
  }

  const completed = results.filter(
    (r) => r.ok && r.stage === "completed",
  ).length;
  const reconciliationRequired = results.filter(
    (r) => r.ok && r.stage === "reconciliation_required",
  ).length;
  const failed = results.filter((r) => !r.ok).length;

  logSubmissionEvent({
    event: "batch_finished",
    submissionAttemptId: input.submissionAttemptId,
    archiveTarget: archive.target,
    outcome: "finished",
    detail: `completed=${completed} failed=${failed} reconciliation=${reconciliationRequired}`,
  });

  return {
    ok: true,
    kind: "completed",
    submissionAttemptId: input.submissionAttemptId,
    archiveTarget: archive.target,
    completedAt: completedAt(),
    total: results.length,
    completed,
    failed,
    reconciliationRequired,
    artworks: results,
    sheetUrl: spreadsheetBrowserUrl(archive.sheetId),
    driveRootUrl: archiveRootUrl ?? storage.getArchiveRootUrl(),
  };
}
