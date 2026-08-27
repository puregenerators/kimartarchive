/**
 * Clear Batch / Start New Batch session reset and confirmation UI.
 * Run: npx tsx lib/artwork/batch-reset.test.tsx
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import { ApplySharedDetailsConfirmationView } from "@/components/artwork/ApplySharedDetailsConfirmationView";
import { BatchSubmissionReport } from "@/components/artwork/BatchSubmissionReport";
import { BatchSummaryBar } from "@/components/artwork/BatchSummaryBar";
import { ClearBatchConfirmationView } from "@/components/artwork/ClearBatchConfirmationView";
import { LargeMasterIntakePanel } from "@/components/artwork/LargeMasterIntakePanel";
import { NewArtworkBatchForm } from "@/components/artwork/NewArtworkBatchForm";
import { SharedDetailsSection } from "@/components/artwork/SharedDetailsSection";
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
  focusWithoutScrolling,
  isModalDismissKey,
  lockBackgroundScroll,
  MODAL_FOCUS_OPTIONS,
  trapTabKey,
} from "@/lib/artwork/modal-focus";
import {
  APPLY_SHARED_DETAILS_TITLE,
  APPLY_SHARED_OVERWRITE_WARNING,
  applySharedDetailsAppliedMessage,
  applySharedDetailsBody,
  EMPTY_SHARED_DETAILS,
  MAX_ARTWORKS_PER_BATCH,
  createEmptyBatch,
  populatedSharedApplyFields,
} from "@/lib/artwork/types";
import { emptyCleanupResult } from "@/lib/submission/types";

const formPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../components/artwork/NewArtworkBatchForm.tsx",
);
const applyConfirmPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../components/artwork/ApplySharedDetailsConfirmationView.tsx",
);

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
    applyNotice: null,
    clearPhase: "idle",
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
          canAddMore
          onFilesSelected={() => undefined}
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
      assert(
        markup.includes("Use the best-quality file you have first"),
        "quality-first upload guidance",
      );
      assert(
        markup.includes("the largest TIFF is preferred"),
        "largest TIFF preferred",
      );
      assert(
        !markup.includes("You can upload one image or a batch."),
        "no empty-state upload instruction",
      );
      assert(
        !markup.includes("Shared details for this batch"),
        "shared details hidden before selection",
      );
      assert(
        !markup.includes("details that will apply to all artworks"),
        "no pre-selection shared instruction",
      );
      assert(!markup.includes("id=\"exhibition\""), "no exhibition field");
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
    name: "Confirm clears validation and review state",
    run: () => {
      const session = populatedSession();
      const cleared = applyClearBatchEvent(
        applyClearBatchEvent(session, "request-clear"),
        "confirm",
      );
      assertEqual(cleared.mode, "edit", "back to edit");
      assertEqual(cleared.errors.form, undefined, "no form error");
      assertDeepEqual(cleared.errors.artworks, {}, "no artwork errors");
      assertEqual(cleared.applyOpen, false, "apply closed");
      assertEqual(cleared.applyNotice, null, "apply notice cleared");
      assertEqual("untitledOpen" in cleared, false, "no bulk untitled dialog");
      assertEqual(
        "untitledSelection" in cleared,
        false,
        "no bulk untitled selection",
      );
      assertEqual(
        "untitledOverwriteConfirm" in cleared,
        false,
        "no bulk untitled overwrite",
      );
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
      assert(
        !markup.includes("Shared details for this batch"),
        "shared details hidden",
      );
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
  {
    name: "Edit screen order is Upload artwork images, Shared details, then Artworks",
    run: () => {
      const appended = appendFilesToBatch(
        createEmptyBatch(),
        [makeFile("Tulip-Tree.jpg")],
        { allowDuplicates: true, createPreviewUrls: false },
      );
      const markup = renderToStaticMarkup(
        <NewArtworkBatchForm initialBatch={appended.batch} />,
      );
      const headingIndex = markup.indexOf("Add New Artwork");
      const countIndex = markup.indexOf(
        `1 of ${MAX_ARTWORKS_PER_BATCH} artworks in this batch`,
      );
      const uploadIndex = markup.indexOf("Upload artwork images");
      const sharedIndex = markup.indexOf("Shared details for this batch");
      const artworksIndex = markup.indexOf('id="artworks-heading"');
      assert(headingIndex > -1, "page heading");
      assert(countIndex > headingIndex, "artwork-count line after heading");
      assert(uploadIndex > countIndex, "upload panel after count");
      assert(sharedIndex > uploadIndex, "Shared details after upload panel");
      assert(artworksIndex > sharedIndex, "Artworks after Shared details");
      assertEqual(
        markup.split("Upload artwork images").length - 1,
        1,
        "one upload panel",
      );
      assertEqual(
        markup.split("Shared details for this batch").length - 1,
        1,
        "Shared details is not duplicated",
      );
      assert(
        markup.includes(
          "Add any information that applies to every artwork below. You can still change these details for individual artworks.",
        ),
        "shared details description",
      );
      assert(markup.includes("Select images"), "uploader stays after selection");
      assert(markup.includes("Clear Batch…"), "clear stays on the form");
      const between = markup.slice(uploadIndex, sharedIndex);
      assert(!between.includes("Batch summary"), "no summary bar between sections");
      assert(!between.includes("images selected"), "no selection banner");
      assert(
        !between.includes("artwork entries created"),
        "no artwork-created banner",
      );
      assert(!markup.includes("Choose files"), "no secondary choose-files control");
      assert(
        !markup.includes("details that will apply to all artworks"),
        "no pre-selection instruction",
      );
      assert(
        !markup.includes("images selected"),
        "no persistent file-selection banner",
      );
      assert(
        !markup.includes("artwork entries created"),
        "no persistent artwork-created banner",
      );
      assert(
        markup.includes('aria-live="polite"') && markup.includes("sr-only"),
        "file-selection success remains an aria-live announcement",
      );
      assert(markup.includes("Missing / no known title"), "per-artwork untitled");
      assert(
        !markup.includes("Apply Untitled to selected artworks"),
        "no bulk untitled button",
      );
    },
  },
  {
    name: "After selection, more images are added from the same upload panel",
    run: () => {
      const appended = appendFilesToBatch(
        createEmptyBatch(),
        [makeFile("Tulip-Tree.jpg")],
        { allowDuplicates: true, createPreviewUrls: false },
      );
      const markup = renderToStaticMarkup(
        <NewArtworkBatchForm initialBatch={appended.batch} />,
      );
      assert(markup.includes("Upload artwork images"), "upload panel remains");
      assert(markup.includes("Select images"), "select control remains");
      assert(markup.includes('type="file"'), "native file input");
      assert(markup.includes("multiple"), "multiple file selection");
      assert(
        markup.includes(
          ".tif,.tiff,.jpg,.jpeg,.png,image/tiff,image/jpeg,image/png",
        ),
        "TIFF, JPEG, and PNG remain accepted",
      );
      assert(!markup.includes("Choose files"), "no secondary Choose files button");
      assert(!markup.includes("Add More Images"), "summary add-more control is gone");
      assert(
        !markup.includes("Add more images"),
        "compact Add more images heading is not rendered",
      );
      assert(
        markup.includes(
          `${MAX_ARTWORKS_PER_BATCH - 1} more artworks can be added`,
        ),
        "remaining batch slots stay in the upload panel",
      );

      const uploadIndex = markup.indexOf("Upload artwork images");
      const sharedIndex = markup.indexOf("Shared details for this batch");
      assert(uploadIndex > -1, "upload panel exists");
      assert(sharedIndex > uploadIndex, "Shared details follows the upload panel");
      assertEqual(
        markup.slice(uploadIndex, sharedIndex).includes("Batch summary"),
        false,
        "no summary bar between upload and Shared details",
      );

      const uploaderSource = readFileSync(
        join(
          dirname(fileURLToPath(import.meta.url)),
          "../../components/artwork/BatchImageUploader.tsx",
        ),
        "utf8",
      );
      assert(
        uploaderSource.includes("onClick={() => inputRef.current?.click()}"),
        "one click on Select images opens the file picker",
      );
      assert(
        uploaderSource.includes('type="button"'),
        "Select images is a button (Enter and Space activate it)",
      );
      assert(
        uploaderSource.includes('event.target.value = ""'),
        "hidden input resets after selection",
      );
      assert(
        uploaderSource.includes("if (files.length === 0) return"),
        "canceling the picker makes no changes",
      );

      const formSource = readFileSync(formPath, "utf8");
      assert(!formSource.includes("showAddMore"), "no add-more panel state");
      assert(
        !formSource.includes("Choose files"),
        "form does not mount a compact add-more uploader",
      );
      assert(
        !formSource.includes("BatchSummaryBar"),
        "form does not mount the summary bar",
      );
      assertEqual(
        (formSource.match(/<BatchImageUploader/g) ?? []).length,
        1,
        "one upload panel remains after selection",
      );
      assert(
        formSource.includes("onFilesSelected={(files) => ingestFiles(files)}"),
        "selected files append through the existing ingest path",
      );
    },
  },
  {
    name: "Add more images is disabled and explained when the batch is full",
    run: () => {
      const files = Array.from({ length: MAX_ARTWORKS_PER_BATCH }, (_, index) =>
        makeFile(`Artwork-${index + 1}.jpg`),
      );
      const appended = appendFilesToBatch(createEmptyBatch(), files, {
        allowDuplicates: true,
        createPreviewUrls: false,
      });
      const markup = renderToStaticMarkup(
        <NewArtworkBatchForm initialBatch={appended.batch} />,
      );
      assert(!markup.includes("Add More Images"), "summary add-more control is gone");
      assert(!markup.includes("Batch Full"), "summary full-batch label is gone");
      assert(
        markup.includes(
          `This batch already has the maximum of ${MAX_ARTWORKS_PER_BATCH} artworks`,
        ),
        "explains that the batch is full",
      );
      assert(markup.includes("Select images"), "uploader remains at capacity");
      assert(markup.includes("disabled"), "control is disabled");
      assert(!markup.includes("Choose files"), "no add-more panel when full");

      const barMarkup = renderToStaticMarkup(
        <BatchSummaryBar
          artworkCount={MAX_ARTWORKS_PER_BATCH}
          maxArtworks={MAX_ARTWORKS_PER_BATCH}
          totalBytes={64}
          needingMetadata={0}
          validationErrors={0}
          canAddMore={false}
          onFilesSelected={() => undefined}
          onRequestClear={() => undefined}
        />,
      );
      assert(barMarkup.includes("disabled"), "summary button is disabled");
      assert(barMarkup.includes("Batch Full"), "summary shows batch full");
    },
  },
  {
    name: "Artworks heading uses full width and has no bulk Untitled action",
    run: () => {
      const appended = appendFilesToBatch(
        createEmptyBatch(),
        [makeFile("Tulip-Tree.jpg"), makeFile("Blue-Garden.jpg")],
        { allowDuplicates: true, createPreviewUrls: false },
      );
      const markup = renderToStaticMarkup(
        <NewArtworkBatchForm initialBatch={appended.batch} />,
      );
      assert(markup.includes('id="artworks-heading"'), "artworks heading");
      assert(markup.includes("One image per artwork."), "instructional text");
      assert(markup.includes("Tulip Tree"), "card starts with artwork title");
      assert(
        !markup.includes("Artwork 01 · Preview"),
        "cards omit artwork/preview id line",
      );
      assert(!markup.includes("Preview inventory"), "no preview inventory copy");
      assertEqual(
        markup.split("Missing / no known title").length - 1,
        2,
        "one untitled checkbox per artwork",
      );
      assert(!markup.includes("Apply Untitled"), "no bulk untitled control");
      assert(!markup.includes("apply-untitled-title"), "no bulk untitled dialog");
      assert(
        !markup.includes("Replace existing titles with Untitled"),
        "no overwrite confirmation",
      );

      const formSource = readFileSync(formPath, "utf8");
      const sectionStart = formSource.indexOf(
        'aria-labelledby="artworks-heading"',
      );
      const cardsStart = formSource.indexOf(
        '<div className="space-y-3">',
        sectionStart,
      );
      assert(sectionStart > -1, "artworks section");
      assert(cardsStart > sectionStart, "artwork cards follow heading");
      const headingBlock = formSource.slice(sectionStart, cardsStart);
      assert(
        !headingBlock.includes("sm:justify-between"),
        "no empty right-side action area",
      );
      assert(
        !headingBlock.includes("sm:flex-row"),
        "heading is not split into columns",
      );
      assert(!headingBlock.includes("shrink-0"), "no reserved action column");
      assert(
        headingBlock.includes("One image per artwork."),
        "instruction stays with heading",
      );

      const cardSource = readFileSync(
        join(
          dirname(fileURLToPath(import.meta.url)),
          "../../components/artwork/ArtworkCard.tsx",
        ),
        "utf8",
      );
      assert(cardSource.includes("Missing / no known title"), "checkbox label");
      assert(
        !cardSource.includes("Artwork {numberLabel} · Preview {previewId}"),
        "card source has no artwork/preview id line",
      );
      assert(
        cardSource.includes("setArtworkUntitled(artwork, event.target.checked)"),
        "checkbox toggles only that artwork",
      );
      assert(
        !cardSource.includes("applyUntitledToSelectedArtworks"),
        "card has no bulk untitled helper",
      );
      assert(
        !cardSource.includes("sm:col-span-5"),
        "medium does not span nearly the full content row",
      );
      assert(
        cardSource.includes("sm:grid-cols-[minmax(0,45%)_minmax(0,16.67%)]"),
        "medium is about 45% of the content width with compact height",
      );
    },
  },
  {
    name: "Batch detail labels omit repeated default wording",
    run: () => {
      const markup = renderToStaticMarkup(
        <SharedDetailsSection
          shared={EMPTY_SHARED_DETAILS}
          onChange={() => undefined}
          onRequestApply={() => undefined}
        />,
      );
      assert(markup.includes(">Exhibition<"), "exhibition");
      assert(markup.includes(">Gallery / Venue<"), "gallery");
      assert(markup.includes(">Exhibition Year<"), "exhibition year");
      assert(markup.includes(">Artwork Year<"), "artwork year");
      assert(markup.includes(">Photographer<"), "photographer");
      assert(markup.includes(">Medium<"), "medium");
      assert(markup.includes(">Dimension Unit<"), "dimension unit");
      assert(!markup.includes("Default Artwork Year"), "no default year label");
      assert(!markup.includes("Default Medium"), "no default medium label");
      assert(
        !markup.includes("Default Dimension Unit"),
        "no default unit label",
      );
      assert(
        markup.includes("Shared details for this batch"),
        "section heading",
      );
    },
  },
  {
    name: "Resumable large-file intake cards do not include batch details",
    run: () => {
      const markup = renderToStaticMarkup(
        <LargeMasterIntakePanel
          inventoryId={1405}
          title="Vaux’s Swift Watch"
          folderName="2017_KO_1405_VauxsSwiftWatch"
          masterFilename="2017_KO_1405_VauxsSwiftWatch_master_01.tif"
          folderWebUrl="https://www.dropbox.com/home/Apps/Kim%20Art%20Archive/2017_KO_1405_VauxsSwiftWatch"
          status="waiting_for_dropbox"
          message=""
          byteLengthLabel="150.3 MB"
          canContinueProcessing={false}
          onCheck={() => undefined}
          onContinue={() => undefined}
        />,
      );
      assert(markup.includes("Vaux’s Swift Watch"), "title");
      assert(
        !markup.includes("Shared details for this batch"),
        "no shared heading",
      );
      assert(!markup.includes("id=\"exhibition\""), "no exhibition field");
      assert(!markup.includes("id=\"photographer\""), "no photographer field");
    },
  },
  {
    name: "Apply confirmation shows only populated fields and has no checkboxes",
    run: () => {
      const fields = populatedSharedApplyFields({
        exhibition: "Spring Exhibition",
        gallery: "Augen Gallery",
        exhibitionYear: "2026",
        defaultArtworkYear: "2026",
        photographer: "Mario Gallucci",
        defaultMedium: "Monotype",
        defaultDimensionUnit: "in",
      });
      const markup = renderToStaticMarkup(
        <ApplySharedDetailsConfirmationView
          artworkCount={6}
          fields={fields}
          wouldOverwrite
        />,
      );
      assert(markup.includes(APPLY_SHARED_DETAILS_TITLE), "title");
      assert(markup.includes(applySharedDetailsBody(6)), "body");
      assert(markup.includes("Artwork Year: 2026"), "year row");
      assert(markup.includes("Medium: Monotype"), "medium row");
      assert(markup.includes("Dimension Unit: inches"), "unit row");
      assert(markup.includes("Exhibition: Spring Exhibition"), "exhibition row");
      assert(markup.includes("Gallery / Venue: Augen Gallery"), "gallery row");
      assert(markup.includes("Photographer: Mario Gallucci"), "photographer row");
      assert(!markup.includes("Exhibition Year"), "exhibition year omitted");
      assert(!markup.includes("Exhibition override"), "no override label");
      assert(
        !markup.includes("Choose which fields to update"),
        "no field-selection copy",
      );
      assert(!markup.includes('type="checkbox"'), "no checkboxes");
      assert(!markup.includes("Apply selected"), "old confirm label gone");
      assert(markup.includes(">Apply to all artworks<"), "confirm button");
      assert(markup.includes(">Cancel<"), "cancel button");
      assert(markup.includes(APPLY_SHARED_OVERWRITE_WARNING), "overwrite warning");
    },
  },
  {
    name: "Apply confirmation is a centered modal overlay rather than inline content",
    run: () => {
      const fields = populatedSharedApplyFields({
        exhibition: "Spring Exhibition",
        gallery: "",
        exhibitionYear: "",
        defaultArtworkYear: "2026",
        photographer: "",
        defaultMedium: "",
        defaultDimensionUnit: "in",
      });
      const markup = renderToStaticMarkup(
        <ApplySharedDetailsConfirmationView
          artworkCount={5}
          fields={fields}
          wouldOverwrite={false}
        />,
      );
      assert(markup.includes('role="dialog"'), "dialog role");
      assert(markup.includes('aria-modal="true"'), "aria-modal");
      assert(markup.includes("aria-labelledby="), "labelled by heading");
      assert(markup.includes('tabindex="-1"'), "heading can receive initial focus");
      assert(markup.includes("fixed inset-0"), "viewport overlay");
      assert(markup.includes("items-center"), "centered vertically");
      assert(markup.includes("justify-center"), "centered horizontally");
      assert(markup.includes("bg-[var(--ink)]/40"), "darkened backdrop");
      assert(markup.includes("max-w-lg"), "constrained width");
      assert(markup.includes("bg-[var(--surface-elevated)]"), "light surface");
      assert(markup.includes("shadow-sm"), "subtle shadow");
      assert(markup.includes("p-4"), "responsive outer margin");
      assert(markup.includes("focus-visible:outline"), "visible focus styles");
      assert(
        markup.includes(applySharedDetailsBody(5)),
        "copy uses the actual artwork count",
      );
      assert(
        !markup.includes("mt-6 border"),
        "not the in-flow submit-confirm card",
      );

      const formSource = readFileSync(formPath, "utf8");
      const applyViewIndex = formSource.indexOf(
        "<ApplySharedDetailsConfirmationView",
      );
      const formCloseIndex = formSource.indexOf("</form>");
      const uploadIndex = formSource.indexOf("<BatchImageUploader");
      const sharedIndex = formSource.indexOf("<SharedDetailsSection");
      const artworksIndex = formSource.indexOf('aria-labelledby="artworks-heading"');
      assert(applyViewIndex > -1, "apply confirmation is rendered");
      assert(formCloseIndex > -1, "form closes");
      assert(
        applyViewIndex > formCloseIndex,
        "modal is outside the form document flow",
      );
      assert(
        applyViewIndex > artworksIndex,
        "modal is not inserted between Shared details and Artworks",
      );
      assert(uploadIndex > -1, "upload panel is rendered");
      assert(
        !formSource.slice(uploadIndex, sharedIndex).includes(
          "ApplySharedDetailsConfirmationView",
        ),
        "modal is not inserted between the upload panel and Shared details",
      );
      assert(
        !formSource.slice(uploadIndex, sharedIndex).includes("BatchSummaryBar"),
        "summary bar is not inserted between the upload panel and Shared details",
      );

      const viewSource = readFileSync(applyConfirmPath, "utf8");
      assert(
        viewSource.includes("isModalDismissKey(event.key)"),
        "Escape closes the modal",
      );
      assert(viewSource.includes("trapTabKey("), "Tab is trapped in the modal");
      assert(
        viewSource.includes("lockBackgroundScroll(document.body.style)"),
        "background scroll is locked while open",
      );
      assert(
        viewSource.includes("focusWithoutScrolling(headingRef.current)"),
        "heading is focused on open without scrolling",
      );
      assert(
        viewSource.includes("focusWithoutScrolling(trigger)"),
        "focus returns to Apply to all artworks without scrolling",
      );
    },
  },
  {
    name: "Apply confirmation traps Tab, dismisses on Escape, and restores focus without scrolling",
    run: () => {
      assertEqual(isModalDismissKey("Escape"), true, "Escape dismisses");
      assertEqual(isModalDismissKey("Enter"), false, "Enter does not dismiss");
      assertEqual(MODAL_FOCUS_OPTIONS.preventScroll, true, "never scroll on focus");

      const style = { overflow: "" };
      const unlock = lockBackgroundScroll(style);
      assertEqual(style.overflow, "hidden", "scroll locked");
      unlock();
      assertEqual(style.overflow, "", "scroll restored");

      const focused: string[] = [];
      const first = { focus: () => focused.push("first") };
      const last = { focus: () => focused.push("last") };
      const heading = { focus: () => focused.push("heading") };

      let prevented = 0;
      trapTabKey(
        {
          key: "Tab",
          shiftKey: false,
          preventDefault: () => {
            prevented += 1;
          },
        },
        [first, last],
        last,
      );
      assertEqual(prevented, 1, "Tab from last is trapped");
      assertEqual(focused.join(","), "first", "wraps to first");

      trapTabKey(
        {
          key: "Tab",
          shiftKey: true,
          preventDefault: () => {
            prevented += 1;
          },
        },
        [first, last],
        first,
      );
      assertEqual(prevented, 2, "Shift+Tab from first is trapped");
      assertEqual(focused.join(","), "first,last", "wraps to last");

      trapTabKey(
        {
          key: "Tab",
          shiftKey: false,
          preventDefault: () => {
            prevented += 1;
          },
        },
        [first, last],
        heading,
      );
      assertEqual(prevented, 3, "Tab from heading is trapped");
      assertEqual(focused.join(","), "first,last,first", "heading Tab goes to first");

      let middlePrevented = false;
      const handledInMiddle = trapTabKey(
        {
          key: "Tab",
          shiftKey: false,
          preventDefault: () => {
            middlePrevented = true;
          },
        },
        [first, last],
        first,
      );
      assertEqual(handledInMiddle, false, "Tab from first is not wrapped");
      assertEqual(middlePrevented, false, "browser moves to the next control");

      let focusOptions: FocusOptions | undefined;
      focusWithoutScrolling({
        focus(options) {
          focused.push("heading");
          focusOptions = options;
        },
      });
      assertEqual(focused.at(-1), "heading", "initial heading focus helper");
      assertEqual(focusOptions?.preventScroll, true, "restore/open focus does not scroll");
    },
  },
  {
    name: "Apply confirmation omits blank fields and hides overwrite warning when nothing differs",
    run: () => {
      const fields = populatedSharedApplyFields({
        exhibition: "",
        gallery: "",
        exhibitionYear: "2026",
        defaultArtworkYear: "2026",
        photographer: "",
        defaultMedium: "",
        defaultDimensionUnit: "in",
      });
      const markup = renderToStaticMarkup(
        <ApplySharedDetailsConfirmationView
          artworkCount={2}
          fields={fields}
          wouldOverwrite={false}
        />,
      );
      assert(markup.includes("Artwork Year: 2026"), "populated year");
      assert(markup.includes("Dimension Unit: inches"), "stored unit");
      assert(!markup.includes("Medium:"), "blank medium omitted");
      assert(!markup.includes("Exhibition:"), "blank exhibition omitted");
      assert(!markup.includes("Gallery / Venue:"), "blank gallery omitted");
      assert(!markup.includes("Photographer:"), "blank photographer omitted");
      assert(
        !markup.includes(APPLY_SHARED_OVERWRITE_WARNING),
        "no overwrite warning",
      );
      assert(!markup.includes('type="checkbox"'), "no checkboxes");
    },
  },
  {
    name: "Batch form apply control does not include field-selection checkboxes",
    run: () => {
      const appended = appendFilesToBatch(
        createEmptyBatch(),
        [makeFile("Tulip-Tree.jpg")],
        { allowDuplicates: true, createPreviewUrls: false },
      );
      const markup = renderToStaticMarkup(
        <NewArtworkBatchForm initialBatch={appended.batch} />,
      );
      assert(markup.includes("Apply to all artworks"), "apply control");
      assert(!markup.includes(APPLY_SHARED_DETAILS_TITLE), "modal closed");
      assert(!markup.includes("fixed inset-0"), "overlay is not in the page flow");
      assert(
        !markup.includes("Choose which fields to update"),
        "no selection copy",
      );
      assert(!markup.includes("Apply selected"), "old confirm gone");
      assertEqual(
        applySharedDetailsAppliedMessage(6),
        "Details applied to 6 artworks.",
        "applied notice copy",
      );
      assertEqual(
        applySharedDetailsAppliedMessage(5),
        "Details applied to 5 artworks.",
        "applied notice uses the artwork count",
      );

      const formSource = readFileSync(formPath, "utf8");
      const confirmStart = formSource.indexOf("function confirmApplyShared()");
      const confirmNext = formSource.indexOf("\n  function ", confirmStart + 1);
      assert(confirmStart > -1, "confirm handler exists");
      const confirmBody = formSource.slice(
        confirmStart,
        confirmNext === -1 ? undefined : confirmNext,
      );
      assert(
        !confirmBody.includes("scrollIntoView"),
        "applying does not change scroll position",
      );
      assert(
        !confirmBody.includes("enterBatchStep"),
        "applying does not jump to another step",
      );
      assert(confirmBody.includes("setApplyOpen(false)"), "modal closes on apply");
      assert(
        confirmBody.includes("applySharedDetailsAppliedMessage"),
        "shows the applied confirmation",
      );
      assert(
        /applyNotice \? \([\s\S]{0,250}aria-live="polite"/.test(formSource),
        "applied notice is a non-blocking live region",
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

console.log(`\nAll ${tests.length} batch-reset tests passed.`);
