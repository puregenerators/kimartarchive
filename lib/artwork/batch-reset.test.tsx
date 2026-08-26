/**
 * Clear Batch / Start New Batch session reset and confirmation UI.
 * Run: npx tsx lib/artwork/batch-reset.test.tsx
 */

import { renderToStaticMarkup } from "react-dom/server";

import { BatchSubmissionReport } from "@/components/artwork/BatchSubmissionReport";
import { BatchSummaryBar } from "@/components/artwork/BatchSummaryBar";
import { ClearBatchConfirmationView } from "@/components/artwork/ClearBatchConfirmationView";
import { NewArtworkBatchForm } from "@/components/artwork/NewArtworkBatchForm";
import { appendFilesToBatch } from "@/lib/artwork/batch-files";
import {
  BATCH_SESSION_STORAGE_KEY,
  CLEAR_BATCH_CONFIRMATION_BODY,
  CLEAR_BATCH_CONFIRMATION_TITLE,
  CLEAR_BATCH_TOUCHES_ARCHIVE,
  applyClearBatchEvent,
  createFreshIntakeBatch,
  createInitialBatchSessionState,
  reduceClearBatchUi,
  type BatchIntakeSessionState,
} from "@/lib/artwork/batch-reset";
import {
  DEFAULT_APPLY_SELECTION,
  EMPTY_SHARED_DETAILS,
  MAX_ARTWORKS_PER_BATCH,
  createEmptyBatch,
} from "@/lib/artwork/types";
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

function makeFile(name: string): File {
  return new File([new Uint8Array(32)], name, {
    type: "image/jpeg",
    lastModified: 1_700_000_000_000,
  });
}

function populatedSession(): BatchIntakeSessionState {
  const shared = {
    ...EMPTY_SHARED_DETAILS,
    exhibition: "Spring Show",
    gallery: "Main Gallery",
    exhibitionYear: "2026",
    defaultArtworkYear: "2026",
    photographer: "Kim",
    defaultMedium: "Monotype",
    defaultDimensionUnit: "in" as const,
  };
  const appended = appendFilesToBatch(
    { ...createEmptyBatch(), shared },
    [makeFile("Tulip-Tree.jpg"), makeFile("Blue-Garden.jpg")],
    { allowDuplicates: true, createPreviewUrls: false },
  );
  return {
    batch: appended.batch,
    mode: "review",
    errors: {
      form: "Fix the highlighted fields.",
      artworks: {
        [appended.added[0]!.id]: { title: "Enter a title." },
      },
    },
    applyOpen: true,
    applySelection: ["year"],
    untitledOpen: true,
    untitledSelection: [appended.added[0]!.id],
    untitledOverwriteConfirm: true,
    clearPhase: "idle",
    showAddMore: true,
    uploadNotice: "2 images selected",
    uploadRejects: [
      { code: "batch_count", message: "Too many files for this batch." },
    ],
    duplicatePrompt: {
      duplicates: [
        {
          file: makeFile("Tulip-Tree.jpg"),
          existingArtworkId: appended.added[0]!.id,
          existingFilename: "Tulip-Tree.jpg",
        },
      ],
      pending: [makeFile("Tulip-Tree.jpg")],
    },
    processingByArtworkId: {
      [appended.added[0]!.id]: { status: "idle" },
    },
  };
}

const tests: TestCase[] = [
  {
    name: "Clear Batch is available on the summary bar when the batch has artworks",
    run: () => {
      const markup = renderToStaticMarkup(
        <BatchSummaryBar
          artworkCount={2}
          maxArtworks={MAX_ARTWORKS_PER_BATCH}
          totalBytes={64}
          needingMetadata={1}
          validationErrors={0}
          testedSuccessfully={0}
          notYetTested={2}
          canAddMore
          onAddMore={() => undefined}
          onRequestClear={() => undefined}
        />,
      );
      assert(markup.includes("Clear Batch…"), "summary bar offers Clear Batch");
    },
  },
  {
    name: "Clear Batch is not shown on the empty /new-artwork form",
    run: () => {
      const markup = renderToStaticMarkup(<NewArtworkBatchForm />);
      assert(markup.includes("Add New Artwork"), "empty heading");
      assert(markup.includes("Select images"), "uploader shown");
      assert(markup.includes("Shared details"), "shared fields shown");
      assert(!markup.includes("Clear Batch"), "no clear control yet");
      assert(!markup.includes("Batch summary"), "no summary yet");
      assert(!markup.includes("id=\"artworks-heading\""), "no artwork list");
    },
  },
  {
    name: "selecting Clear Batch opens confirmation and does not clear",
    run: () => {
      const session = populatedSession();
      assertEqual(
        reduceClearBatchUi("idle", "request-clear"),
        "confirm",
        "phase",
      );
      const opened = applyClearBatchEvent(session, "request-clear");
      assertEqual(opened.clearPhase, "confirm", "confirm open");
      assertEqual(opened.batch, session.batch, "same batch object");
      assertEqual(opened.batch.artworks.length, 2, "drafts remain");
      const markup = renderToStaticMarkup(<ClearBatchConfirmationView />);
      assert(markup.includes(CLEAR_BATCH_CONFIRMATION_TITLE), "title");
      assert(markup.includes(CLEAR_BATCH_CONFIRMATION_BODY), "body");
      assert(markup.includes("role=\"dialog\""), "dialog");
      assert(markup.includes(">Cancel<"), "cancel");
      assert(markup.includes(">Clear batch<"), "confirm");
      assert(!markup.includes("Yes, clear batch"), "old confirm label gone");
    },
  },
  {
    name: "Cancel preserves all current batch state",
    run: () => {
      const session = populatedSession();
      const cancelled = applyClearBatchEvent(
        applyClearBatchEvent(session, "request-clear"),
        "cancel",
      );
      assertEqual(cancelled.clearPhase, "idle", "dialog closed");
      assertEqual(cancelled.batch, session.batch, "same batch");
      assertEqual(cancelled.errors, session.errors, "same errors");
      assertEqual(cancelled.mode, "review", "still in review");
      assertEqual(cancelled.uploadNotice, session.uploadNotice, "notice kept");
      assertEqual(
        cancelled.processingByArtworkId,
        session.processingByArtworkId,
        "processing kept",
      );
      assertEqual(cancelled.duplicatePrompt, session.duplicatePrompt, "dupes kept");
      assertEqual(session.batch.artworks.length, 2, "original still populated");
    },
  },
  {
    name: "Confirm removes all artwork drafts and attached files",
    run: () => {
      const session = populatedSession();
      assert(session.batch.artworks.every((artwork) => artwork.image), "files on");
      const cleared = applyClearBatchEvent(
        applyClearBatchEvent(session, "request-clear"),
        "confirm",
      );
      assertEqual(cleared.batch.artworks.length, 0, "no drafts");
      assertEqual(session.batch.artworks.length, 2, "source session untouched");
      assert(
        session.batch.artworks.every((artwork) => artwork.image?.file),
        "original files still referenced on the pre-clear snapshot",
      );
    },
  },
  {
    name: "Confirm resets shared fields to canonical createEmptyBatch defaults",
    run: () => {
      const session = populatedSession();
      const cleared = applyClearBatchEvent(
        applyClearBatchEvent(session, "request-clear"),
        "confirm",
      );
      assertDeepEqual(
        cleared.batch.shared,
        EMPTY_SHARED_DETAILS,
        "shared defaults",
      );
      assertDeepEqual(
        cleared.batch.shared,
        createEmptyBatch().shared,
        "same as createEmptyBatch",
      );
      assertEqual(
        cleared.batch.shared.defaultDimensionUnit,
        "in",
        "canonical unit",
      );
      assertEqual(session.batch.shared.exhibition, "Spring Show", "old kept");
    },
  },
  {
    name: "Confirm clears validation, review, and processing state",
    run: () => {
      const session = populatedSession();
      const cleared = applyClearBatchEvent(
        applyClearBatchEvent(session, "request-clear"),
        "confirm",
      );
      assertEqual(cleared.mode, "edit", "back to edit");
      assertEqual(cleared.errors.form, undefined, "no form error");
      assertDeepEqual(cleared.errors.artworks, {}, "no artwork errors");
      assertDeepEqual(cleared.processingByArtworkId, {}, "no processing");
      assertEqual(cleared.applyOpen, false, "apply closed");
      assertDeepEqual(
        cleared.applySelection,
        [...DEFAULT_APPLY_SELECTION],
        "apply selection restored",
      );
      assertEqual(cleared.untitledOpen, false, "untitled closed");
      assertEqual(cleared.untitledSelection.length, 0, "untitled selection");
      assertEqual(cleared.showAddMore, false, "add-more closed");
      assertEqual(cleared.uploadNotice, null, "notice cleared");
      assertEqual(cleared.uploadRejects.length, 0, "rejects cleared");
      assertEqual(cleared.duplicatePrompt, null, "dupes cleared");
      assertEqual(cleared.clearPhase, "idle", "dialog closed");
    },
  },
  {
    name: "Persisted draft state does not restore the cleared batch",
    run: () => {
      assertEqual(BATCH_SESSION_STORAGE_KEY, null, "no storage key");
      const session = populatedSession();
      applyClearBatchEvent(
        applyClearBatchEvent(session, "request-clear"),
        "confirm",
      );
      const again = createInitialBatchSessionState();
      assertEqual(again.batch.artworks.length, 0, "still empty");
      assertDeepEqual(again.batch.shared, EMPTY_SHARED_DETAILS, "still defaults");
    },
  },
  {
    name: "Empty /new-artwork UI is the state after a confirmed clear",
    run: () => {
      const cleared = createInitialBatchSessionState();
      assertEqual(cleared.batch.artworks.length, 0, "no drafts");
      assertEqual(cleared.mode, "edit", "edit mode");
      const markup = renderToStaticMarkup(<NewArtworkBatchForm />);
      assert(markup.includes("Add New Artwork"), "empty heading");
      assert(markup.includes("Select images"), "fresh uploader");
      assert(!markup.includes("Clear Batch"), "clear hidden when empty");
      assert(!markup.includes(CLEAR_BATCH_CONFIRMATION_TITLE), "no leftover dialog");
    },
  },
  {
    name: "Clear Batch does not touch submitted archive data",
    run: () => {
      assertEqual(CLEAR_BATCH_TOUCHES_ARCHIVE, false, "archive flag");
      const cleared = createInitialBatchSessionState();
      assert(!("inventoryId" in cleared), "no inventory fields");
      assert(!("sheetRowNumber" in cleared), "no sheet fields");
      assert(!("dropbox" in cleared), "no dropbox fields");
    },
  },
  {
    name: "Start New Batch still uses the same fresh-batch helper",
    run: () => {
      assertEqual(
        createFreshIntakeBatch,
        createInitialBatchSessionState,
        "same function",
      );
      const afterClear = createFreshIntakeBatch();
      const afterStartNew = createInitialBatchSessionState();
      assertDeepEqual(afterClear.batch, afterStartNew.batch, "same batch shape");
      assertEqual(afterClear.mode, afterStartNew.mode, "same mode");
      const markup = renderToStaticMarkup(
        <BatchSubmissionReport
          result={{
            ok: true,
            kind: "completed",
            submissionAttemptId: "attempt-1",
            archiveTarget: "test",
            completedAt: "2026-08-25T00:00:00.000Z",
            total: 1,
            completed: 1,
            failed: 0,
            reconciliationRequired: 0,
            artworks: [
              {
                ok: true,
                clientArtworkId: "art-1",
                order: 0,
                title: "Tulip Tree",
                inventoryId: 1100,
                claimId: "claim-1",
                stage: "completed",
                driveFolder: {
                  id: "folder",
                  name: "folder",
                  webViewLink: "https://example.test/folder",
                },
                master: {
                  id: "master",
                  name: "master",
                  webViewLink: "https://example.test/master",
                },
                hr: {
                  id: "hr",
                  name: "hr",
                  webViewLink: "https://example.test/hr",
                },
                web: {
                  id: "web",
                  name: "web",
                  webViewLink: "https://example.test/web",
                },
                thumb: {
                  id: "thumb",
                  name: "thumb",
                  webViewLink: "https://example.test/thumb",
                },
                metadata: {
                  id: "meta",
                  name: "meta",
                  webViewLink: "https://example.test/meta",
                },
                sheetRowWritten: true,
                claimStatus: "Completed",
                cleanup: emptyCleanupResult(),
                startedAt: "2026-08-25T00:00:00.000Z",
                finishedAt: "2026-08-25T00:00:00.000Z",
                reconciliationWarnings: [],
              },
            ],
            sheetUrl: null,
            driveRootUrl: null,
          }}
          onStartNewBatch={() => undefined}
        />,
      );
      assert(markup.includes("Start New Batch"), "report still offers it");
      assert(markup.includes("Tulip Tree"), "submitted artwork still listed");
    },
  },
  {
    name: "Confirm without an open dialog does not clear",
    run: () => {
      const session = populatedSession();
      const skipped = applyClearBatchEvent(session, "confirm");
      assertEqual(skipped, session, "same session");
      assertEqual(skipped.batch.artworks.length, 2, "drafts remain");
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

console.log(`\nAll ${tests.length} batch-reset tests passed.`);
