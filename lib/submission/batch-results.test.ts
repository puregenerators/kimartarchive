/**
 * Batch submission result tracking: every artwork keeps a final state,
 * and summary counts are derived from that array.
 * Run: npx tsx lib/submission/batch-results.test.ts
 */

import {
  buildCompletedBatchResult,
  createArtworkSubmissionFailure,
  failedArtworkProgressLines,
  failedDuringLabel,
  normalizeArtworkSubmissionResult,
  partitionBatchArtworkResults,
  submissionReportHeading,
  submissionReportLead,
  summarizeBatchArtworkResults,
  userFacingSubmissionMessage,
} from "@/lib/submission/batch-results";
import type {
  ArtworkSubmissionResult,
  ArtworkSubmissionSuccess,
  DriveResourceRef,
} from "@/lib/submission/types";
import { emptyCleanupResult } from "@/lib/submission/types";

type TestCase = { name: string; run: () => void };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(
      `${message}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`,
    );
  }
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${message}\n  expected: ${e}\n  actual: ${a}`);
  }
}

function ref(name: string): DriveResourceRef {
  return {
    id: name,
    name,
    webViewLink: `https://example.test/${name}`,
  };
}

function successArtwork(
  overrides: Partial<ArtworkSubmissionSuccess> & {
    clientArtworkId: string;
    title: string;
    order: number;
    inventoryId: number;
  },
): ArtworkSubmissionSuccess {
  return {
    ok: true,
    stage: "completed",
    claimId: `claim-${overrides.inventoryId}`,
    driveFolder: ref("folder"),
    master: ref("master"),
    hr: ref("hr"),
    web: ref("web"),
    thumb: ref("thumb"),
    metadata: ref("meta"),
    sheetRowWritten: true,
    claimStatus: "Completed",
    cleanup: emptyCleanupResult(),
    startedAt: "2026-08-26T00:00:00.000Z",
    finishedAt: "2026-08-26T00:00:01.000Z",
    reconciliationWarnings: [],
    ...overrides,
  };
}

function assertInvariant(artworks: ArtworkSubmissionResult[], message: string) {
  const summary = summarizeBatchArtworkResults(artworks);
  assertEqual(
    summary.completed + summary.failed + summary.reconciliationRequired,
    summary.total,
    `${message}: invariant`,
  );
  const partitioned = partitionBatchArtworkResults(artworks);
  assertEqual(
    partitioned.successes.length +
      partitioned.failures.length +
      partitioned.reconciliations.length,
    artworks.length,
    `${message}: every artwork partitioned once`,
  );
  const ids = [
    ...partitioned.successes,
    ...partitioned.failures,
    ...partitioned.reconciliations,
  ].map((artwork) => artwork.clientArtworkId);
  assertEqual(new Set(ids).size, ids.length, `${message}: unique ids`);
  assertEqual(ids.length, summary.total, `${message}: ids match total`);
  assertEqual(partitioned.successes.length, summary.completed, `${message}: success count`);
  assertEqual(partitioned.failures.length, summary.failed, `${message}: failed count`);
  assertEqual(
    partitioned.reconciliations.length,
    summary.reconciliationRequired,
    `${message}: recon count`,
  );
}

const tests: TestCase[] = [
  {
    name: "all artworks succeed: summary matches the result array",
    run: () => {
      const artworks = [
        successArtwork({
          clientArtworkId: "art-1",
          order: 0,
          title: "Tulip Tree",
          inventoryId: 1100,
        }),
        successArtwork({
          clientArtworkId: "art-2",
          order: 1,
          title: "Blue Garden",
          inventoryId: 1101,
        }),
      ];
      assertDeepEqual(
        summarizeBatchArtworkResults(artworks),
        { total: 2, completed: 2, failed: 0, reconciliationRequired: 0 },
        "summary",
      );
      assertInvariant(artworks, "all succeed");
      assertEqual(
        submissionReportHeading(summarizeBatchArtworkResults(artworks)),
        "Submission complete",
        "heading",
      );
    },
  },
  {
    name: "one artwork fails before an inventory ID is assigned",
    run: () => {
      const success = successArtwork({
        clientArtworkId: "art-1",
        order: 0,
        title: "Tulip Tree",
        inventoryId: 1100,
      });
      const failed = createArtworkSubmissionFailure({
        clientArtworkId: "art-2",
        order: 1,
        title: "Lost File",
        inventoryId: null,
        claimId: null,
        lastCompletedStage: "pending",
        failedOperation: null,
        errorCode: "MISSING_FILE",
        message: "Source file is missing from this browser session.",
      });
      const artworks = [success, failed];
      const summary = summarizeBatchArtworkResults(artworks);
      assertDeepEqual(
        summary,
        { total: 2, completed: 1, failed: 1, reconciliationRequired: 0 },
        "summary",
      );
      assertEqual(failed.inventoryId, null, "no inventory ID");
      assertInvariant(artworks, "fail before ID");
      const { failures } = partitionBatchArtworkResults(artworks);
      assertEqual(failures[0]?.title, "Lost File", "failed title retained");
    },
  },
  {
    name: "one artwork fails after an inventory ID is assigned",
    run: () => {
      const success = successArtwork({
        clientArtworkId: "art-1",
        order: 0,
        title: "Tulip Tree",
        inventoryId: 1100,
      });
      const failed = createArtworkSubmissionFailure({
        clientArtworkId: "art-2",
        order: 1,
        title: "Red Field",
        inventoryId: 1405,
        claimId: "claim-1405",
        lastCompletedStage: "master_uploaded",
        failedOperation: "upload_hr",
        errorCode: "DRIVE_UPLOAD_FAILED",
        message: "High-resolution upload was rejected.",
        driveFolder: ref("folder"),
        master: ref("master"),
      });
      const artworks = [success, failed];
      assertDeepEqual(
        summarizeBatchArtworkResults(artworks),
        { total: 2, completed: 1, failed: 1, reconciliationRequired: 0 },
        "summary",
      );
      assertEqual(failed.inventoryId, 1405, "inventory ID retained");
      assertInvariant(artworks, "fail after ID");
    },
  },
  {
    name: "one artwork partially succeeds and requires reconciliation",
    run: () => {
      const success = successArtwork({
        clientArtworkId: "art-1",
        order: 0,
        title: "Tulip Tree",
        inventoryId: 1100,
      });
      const recon = successArtwork({
        clientArtworkId: "art-2",
        order: 1,
        title: "Cedar Waxwing",
        inventoryId: 1102,
        stage: "reconciliation_required",
        claimStatus: "Processing",
        reconciliationWarnings: [
          {
            code: "INVENTORY_ROW_WITHOUT_COMPLETED_CLAIM",
            message:
              "Dropbox files and the Artwork Inventory row exist, but the claim status could not be marked Completed.",
          },
        ],
      });
      const artworks = [success, recon];
      const summary = summarizeBatchArtworkResults(artworks);
      assertDeepEqual(
        summary,
        { total: 2, completed: 1, failed: 0, reconciliationRequired: 1 },
        "summary",
      );
      assertInvariant(artworks, "reconciliation");
      const partitioned = partitionBatchArtworkResults(artworks);
      assertEqual(partitioned.successes[0]?.title, "Tulip Tree", "success stays success");
      assertEqual(
        partitioned.reconciliations[0]?.title,
        "Cedar Waxwing",
        "recon is not listed as success",
      );
      assertEqual(partitioned.failures.length, 0, "not failed");
    },
  },
  {
    name: "multiple artworks fail at different processing stages",
    run: () => {
      const folderFail = createArtworkSubmissionFailure({
        clientArtworkId: "art-1",
        order: 0,
        title: "Folder Miss",
        inventoryId: 1501,
        lastCompletedStage: "processing",
        failedOperation: "create_folder",
        message: "Dropbox folder could not be created.",
      });
      const masterFail = createArtworkSubmissionFailure({
        clientArtworkId: "art-2",
        order: 1,
        title: "Master Miss",
        inventoryId: 1502,
        lastCompletedStage: "folder_created",
        failedOperation: "upload_master",
        message: "The original file could not be uploaded to archive storage.",
        driveFolder: ref("folder"),
      });
      const hrFail = createArtworkSubmissionFailure({
        clientArtworkId: "art-3",
        order: 2,
        title: "HR Miss",
        inventoryId: 1503,
        lastCompletedStage: "master_uploaded",
        failedOperation: "upload_hr",
        message: "High-resolution upload was rejected.",
        driveFolder: ref("folder"),
        master: ref("master"),
      });
      const sheetFail = createArtworkSubmissionFailure({
        clientArtworkId: "art-4",
        order: 3,
        title: "Sheet Miss",
        inventoryId: 1504,
        lastCompletedStage: "metadata_uploaded",
        failedOperation: "append_inventory_row",
        errorCode: "SHEET_APPEND_FAILED",
        message: "The inventory row could not be written.",
        driveFolder: ref("folder"),
        master: ref("master"),
        hr: ref("hr"),
        web: ref("web"),
        thumb: ref("thumb"),
        metadata: ref("meta"),
      });
      const artworks = [folderFail, masterFail, hrFail, sheetFail];
      const summary = summarizeBatchArtworkResults(artworks);
      assertDeepEqual(
        summary,
        { total: 4, completed: 0, failed: 4, reconciliationRequired: 0 },
        "summary",
      );
      assertInvariant(artworks, "multi fail");
      assertEqual(
        failedDuringLabel(hrFail.failedOperation),
        "High-resolution upload",
        "HR label",
      );
      assertDeepEqual(
        failedArtworkProgressLines(hrFail),
        [
          "Master file saved",
          "High resolution failed",
          "Web version not attempted",
          "Inventory row not recorded",
        ],
        "HR failure progress",
      );
      assert(
        failedArtworkProgressLines(folderFail).includes("Dropbox folder failed"),
        "folder failure named",
      );
      assert(
        failedArtworkProgressLines(sheetFail).includes("Inventory row not recorded"),
        "sheet failure named",
      );
    },
  },
  {
    name: "dropping a failed artwork from the array hides it from the summary (old bug)",
    run: () => {
      const submitted = [
        successArtwork({
          clientArtworkId: "art-1",
          order: 0,
          title: "Tulip Tree",
          inventoryId: 1100,
        }),
        createArtworkSubmissionFailure({
          clientArtworkId: "art-2",
          order: 1,
          title: "Red Field",
          inventoryId: 1405,
          lastCompletedStage: "folder_created",
          failedOperation: "upload_master",
          message: "Dropbox rejected the master upload.",
        }),
      ];
      const skippedFailure = submitted.filter((artwork) => artwork.ok);
      const broken = summarizeBatchArtworkResults(skippedFailure);
      assertEqual(broken.failed, 0, "old bug: failed count is 0");
      assertEqual(broken.total, 1, "old bug: artwork disappeared");
      assert(
        broken.completed + broken.failed + broken.reconciliationRequired !==
          submitted.length,
        "old bug: invariant vs submitted count fails",
      );

      const fixed = summarizeBatchArtworkResults(submitted);
      assertEqual(fixed.failed, 1, "retained failure is counted");
      assertEqual(fixed.total, submitted.length, "no artwork missing");
      assertEqual(
        fixed.completed + fixed.failed + fixed.reconciliationRequired,
        submitted.length,
        "fixed invariant",
      );
    },
  },
  {
    name: "incomplete process payloads become identifiable failed results",
    run: () => {
      const normalized = normalizeArtworkSubmissionResult(
        {
          ok: false,
          errorCode: "UNKNOWN",
          message: "Processing failed unexpectedly. The master in Dropbox was not deleted.",
        },
        {
          clientArtworkId: "art-9",
          order: 2,
          title: "Night Heron",
          inventoryId: 1410,
          claimId: "claim-1410",
          lastCompletedStage: "master_uploaded",
          failedOperation: "generate_derivatives",
        },
      );
      assertEqual(normalized.ok, false, "failed");
      if (normalized.ok) return;
      assertEqual(normalized.clientArtworkId, "art-9", "id");
      assertEqual(normalized.title, "Night Heron", "title");
      assertEqual(normalized.inventoryId, 1410, "inventory ID");
      assertEqual(normalized.lastCompletedStage, "master_uploaded", "stage");
      assert(
        !normalized.message.includes("at processArtwork"),
        "no stack in message",
      );
    },
  },
  {
    name: "unexpected ok status cannot silently under-count the summary",
    run: () => {
      const weird = {
        ok: true,
        clientArtworkId: "art-x",
        order: 0,
        title: "Unknown State",
        inventoryId: 1,
        claimId: "claim-1",
        stage: "processing",
      };
      const normalized = normalizeArtworkSubmissionResult(weird, {
        clientArtworkId: "art-x",
        order: 0,
        title: "Unknown State",
      });
      assertEqual(normalized.ok, false, "treated as failed");
      const summary = summarizeBatchArtworkResults([
        normalized,
        successArtwork({
          clientArtworkId: "art-ok",
          order: 1,
          title: "Ok",
          inventoryId: 2,
        }),
      ]);
      assertEqual(summary.total, 2, "total");
      assertEqual(summary.failed, 1, "failed");
      assertEqual(summary.completed, 1, "completed");
      assertEqual(
        summary.completed + summary.failed + summary.reconciliationRequired,
        summary.total,
        "invariant",
      );
    },
  },
  {
    name: "buildCompletedBatchResult derives counts from artworks, not caller counters",
    run: () => {
      const result = buildCompletedBatchResult({
        submissionAttemptId: "attempt-1",
        archiveTarget: "test",
        artworks: [
          successArtwork({
            clientArtworkId: "art-1",
            order: 0,
            title: "Tulip Tree",
            inventoryId: 1100,
          }),
          createArtworkSubmissionFailure({
            clientArtworkId: "art-2",
            order: 1,
            title: "Red Field",
            inventoryId: 1101,
            lastCompletedStage: "folder_created",
            failedOperation: "upload_master",
            message: "Dropbox rejected the master upload.",
          }),
        ],
        sheetUrl: null,
        driveRootUrl: null,
      });
      assertEqual(result.total, 2, "total");
      assertEqual(result.completed, 1, "completed");
      assertEqual(result.failed, 1, "failed");
      assertEqual(result.reconciliationRequired, 0, "recon");
      assertEqual(result.artworks.length, 2, "array length");
    },
  },
  {
    name: "heading and lead do not claim full success when issues exist",
    run: () => {
      const mixed = summarizeBatchArtworkResults([
        successArtwork({
          clientArtworkId: "art-1",
          order: 0,
          title: "A",
          inventoryId: 1,
        }),
        successArtwork({
          clientArtworkId: "art-2",
          order: 1,
          title: "B",
          inventoryId: 2,
        }),
        successArtwork({
          clientArtworkId: "art-3",
          order: 2,
          title: "C",
          inventoryId: 3,
        }),
        createArtworkSubmissionFailure({
          clientArtworkId: "art-4",
          order: 3,
          title: "D",
          inventoryId: 4,
          lastCompletedStage: "master_uploaded",
          failedOperation: "upload_hr",
          message: "High-resolution upload was rejected.",
        }),
      ]);
      assertEqual(
        submissionReportHeading(mixed),
        "Submission finished with issues",
        "heading",
      );
      assertEqual(
        submissionReportLead(mixed),
        "4 artworks were submitted. 3 completed successfully and 1 needs attention.",
        "lead",
      );
      const allOk = summarizeBatchArtworkResults([
        successArtwork({
          clientArtworkId: "art-1",
          order: 0,
          title: "A",
          inventoryId: 1,
        }),
      ]);
      assertEqual(submissionReportHeading(allOk), "Submission complete", "success heading");
      assert(
        submissionReportLead(allOk).includes("saved to Dropbox"),
        "success lead",
      );
    },
  },
  {
    name: "user-facing messages strip stacks and credential-looking text",
    run: () => {
      assertEqual(
        userFacingSubmissionMessage(
          "Dropbox rejected the upload.\n    at uploadFile (process-one.ts:12:3)",
        ),
        "Dropbox rejected the upload.",
        "first line only",
      );
      assertEqual(
        userFacingSubmissionMessage("Authorization: Bearer secret-token-value"),
        "This artwork could not be completed.",
        "token blocked",
      );
      assertEqual(
        userFacingSubmissionMessage("Error at Foo.bar (file.js:10:2)"),
        "This artwork could not be completed.",
        "stack frame blocked",
      );
    },
  },
];

let failed = 0;

for (const test of tests) {
  try {
    test.run();
    console.log(`ok  — ${test.name}`);
  } catch (error) {
    failed += 1;
    console.error(`fail — ${test.name}`);
    console.error(error instanceof Error ? error.message : error);
  }
}

if (failed > 0) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
}

console.log(`\nAll ${tests.length} batch-result tracking tests passed.`);
