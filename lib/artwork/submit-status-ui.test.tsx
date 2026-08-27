/**
 * Presentation tests for the Review Batch submitting-status UI
 * and in-page step scroll/focus.
 * Static markup only — no browser, no new test framework.
 * Run: npx tsx lib/artwork/submit-status-ui.test.tsx
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import { BatchImageUploader } from "@/components/artwork/BatchImageUploader";
import {
  ArtworkImageThumb,
  ArtworkImageThumbFooterNote,
} from "@/components/artwork/ArtworkImageThumb";
import { BatchReview } from "@/components/artwork/BatchReview";
import {
  BatchSubmitConfirmationView,
  BatchSubmitFailureView,
} from "@/components/artwork/BatchSubmitConfirmationView";
import { BatchSubmissionReport } from "@/components/artwork/BatchSubmissionReport";
import { LargeMasterIntakePanel, RemoveIncompleteIntakeConfirmView } from "@/components/artwork/LargeMasterIntakePanel";
import { NewArtworkBatchForm } from "@/components/artwork/NewArtworkBatchForm";
import { appendFilesToBatch } from "@/lib/artwork/batch-files";
import {
  BATCH_STEP_HEADING_ID,
  BATCH_STEP_SCROLL,
  enterBatchStep,
  scrollBatchPageToTop,
} from "@/lib/artwork/step-focus";
import {
  focusWithoutScrolling,
  isModalDismissKey,
  lockBackgroundScroll,
  MODAL_FOCUS_OPTIONS,
  trapTabKey,
} from "@/lib/artwork/modal-focus";
import {
  SUBMIT_CONFIRM_DELIVERY,
  SUBMIT_CONFIRM_KEEP_OPEN,
  SUBMIT_CONFIRM_LARGE_FILES,
  SUBMIT_CONFIRM_MIXED_NEXT_STEP,
  submitConfirmActionLabel,
  submitConfirmHeading,
  submitConfirmLargeFileNote,
  submitConfirmSizeLabel,
} from "@/lib/artwork/submit-confirm";
import {
  MAX_FILE_BYTES,
  createEmptyBatch,
  resolveApplySharedDetails,
  type BatchSharedDetails,
} from "@/lib/artwork/types";
import { formatFileSize } from "@/lib/artwork/validation";
import { LARGE_MASTER_PREVIEW_UNAVAILABLE_MESSAGE } from "@/lib/images/preview-client";
import { emptyCleanupResult } from "@/lib/submission/types";
import {
  BatchSubmittingStatusView,
  submittingWaitLabel,
} from "@/components/artwork/BatchSubmittingStatusView";

type TestCase = {
  name: string;
  run: () => void;
};

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

const cssPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../app/globals.css",
);
const reviewPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../components/artwork/BatchReview.tsx",
);
const confirmViewPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../components/artwork/BatchSubmitConfirmationView.tsx",
);

const DECODE_FAILURE =
  "The image could not be decoded. It may be corrupted or an unsupported variant.";

const waitingPanelProps = {
  inventoryId: 1405,
  title: "Vaux’s Swift Watch",
  folderName: "2017_KO_1405_VauxsSwiftWatch",
  masterFilename: "2017_KO_1405_VauxsSwiftWatch_master_01.tif",
  folderWebUrl:
    "https://www.dropbox.com/home/Apps/Kim%20Art%20Archive/2017_KO_1405_VauxsSwiftWatch",
  byteLengthLabel: "150.3 MB",
  canContinueProcessing: false,
  onCheck: () => undefined,
  onContinue: () => undefined,
};

const tests: TestCase[] = [
  {
    name: "submitting panel keeps existing copy and elapsed text",
    run: () => {
      const markup = renderToStaticMarkup(
        <BatchSubmittingStatusView artworkCount={5} elapsedSec={25} />,
      );
      assert(markup.includes("Submitting 5 artworks"), "heading");
      assert(
        markup.includes("Files up to 150 MB will upload automatically."),
        "direct-upload copy",
      );
      assert(
        markup.includes("prepare a Dropbox folder"),
        "large-file wait copy",
      );
      assert(
        markup.includes("keep this page open until it’s complete."),
        "keep-page-open copy",
      );
      assert(
        markup.includes(
          "Elapsed 25s · exact per-artwork stage is not streamed live",
        ),
        "elapsed copy",
      );
    },
  },
  {
    name: "batch uploader displays the 150 MB per-file limit",
    run: () => {
      const markup = renderToStaticMarkup(
        <BatchImageUploader onFilesSelected={() => undefined} />,
      );
      assert(markup.includes("up to 150 MB per"), "150 MB limit");
      assert(markup.includes("large-file Dropbox intake"), "large-file copy");
      assert(markup.includes("list-disc"), "bullet list styling");
      assert(markup.includes("text-base"), "limit copy is slightly larger");
      assert(markup.includes("font-bold"), "heading and intro are bold");
    },
  },
  {
    name: "waiting large-file card shows Dropbox steps without failed or continue",
    run: () => {
      const markup = renderToStaticMarkup(
        <LargeMasterIntakePanel
          {...waitingPanelProps}
          status="waiting_for_dropbox"
          message={DECODE_FAILURE}
        />,
      );
      assert(markup.includes("Vaux’s Swift Watch"), "title");
      assert(markup.includes("Inventory 1405"), "inventory ID");
      assert(markup.includes("150.3 MB"), "size");
      assert(markup.includes("Waiting for Dropbox upload"), "waiting badge");
      assert(
        markup.includes(
          "This master is too large to upload directly through the archive.",
        ),
        "main instruction",
      );
      assert(markup.includes("Open the prepared Dropbox folder"), "step 1");
      assert(markup.includes("Open Dropbox folder"), "open folder action");
      assert(markup.includes("Rename the master file"), "step 2");
      assert(
        markup.includes("2017_KO_1405_VauxsSwiftWatch_master_01.tif"),
        "expected filename",
      );
      assert(markup.includes("Copy filename"), "copy filename");
      assert(
        markup.includes("Upload the renamed file to that folder"),
        "step 3",
      );
      assert(
        markup.includes("Wait until Dropbox confirms the upload is complete."),
        "wait for Dropbox",
      );
      assert(markup.includes("Return here and check the file"), "step 4");
      assert(markup.includes("Check for uploaded file"), "check action");
      assert(
        markup.includes("Having trouble? Show folder details"),
        "disclosure",
      );
      assert(!markup.includes("Remove from this list"), "no old dismiss link");
      assert(
        !markup.includes("Already completed this upload or want to start it over later?"),
        "no dismiss without handler",
      );
      assert(markup.includes("<details"), "collapsed details");
      assert(!/<details[^>]*\sopen/.test(markup), "details start closed");
      const detailsIndex = markup.indexOf("<details");
      assert(
        markup.indexOf("Apps/Kim Art Archive/2017_KO_1405_VauxsSwiftWatch") >
          detailsIndex,
        "folder path only in disclosure",
      );
      assert(markup.includes("Copy folder path"), "copy folder path");
      assert(!markup.includes("Continue processing"), "no continue action");
      assert(!markup.includes("Process artwork"), "no process yet");
      assert(!markup.includes("Failed"), "no failed status");
      assert(!markup.includes("could not be decoded"), "no decode leak");
      assert(!markup.includes("Large master via Dropbox"), "no repeated heading");
      assert(!markup.includes("Destination folder"), "no form-like folder field");
      assert(!markup.includes("Expected filename"), "no form-like filename field");
      assert(!markup.includes("sl."), "no token-looking text");
    },
  },
  {
    name: "resume large-file card offers a dismiss-upload button after Having trouble",
    run: () => {
      const markup = renderToStaticMarkup(
        <LargeMasterIntakePanel
          {...waitingPanelProps}
          status="waiting_for_dropbox"
          message=""
          onDismiss={async () => undefined}
        />,
      );
      assert(
        markup.includes(
          "Already completed this upload or want to start it over later? Dismiss upload.",
        ),
        "dismiss action",
      );
      assert(markup.includes("border-[var(--danger)]"), "slightly red border");
      assert(markup.includes("bg-[var(--danger-soft)]"), "soft red fill");
      assert(markup.includes("text-[var(--danger)]"), "red label");
      assert(markup.includes("Check for uploaded file"), "check remains primary");
      assert(
        markup.includes("Having trouble? Show folder details"),
        "disclosure",
      );
      const checkIndex = markup.indexOf("Check for uploaded file");
      const troubleIndex = markup.indexOf("Having trouble?");
      const removeIndex = markup.indexOf("Dismiss upload.");
      assert(troubleIndex > checkIndex, "trouble after check");
      assert(removeIndex > troubleIndex, "dismiss after trouble, not beside check");
      assert(!markup.includes("Remove from this list"), "old link gone");
      assert(!markup.includes("Remove this incomplete intake?"), "confirm closed");
    },
  },
  {
    name: "remove confirmation keeps the inventory ID retired and does not delete files",
    run: () => {
      const markup = renderToStaticMarkup(
        <RemoveIncompleteIntakeConfirmView
          inventoryId={1405}
          titleId="dismiss-title"
          onKeep={() => undefined}
          onConfirm={() => undefined}
        />,
      );
      assert(markup.includes("Remove this incomplete intake?"), "title");
      assert(
        markup.includes(
          "It will no longer appear here. Inventory 1405 will remain retired, and no Dropbox files or completed artwork records will be deleted.",
        ),
        "body",
      );
      assert(markup.includes("Keep intake"), "keep");
      assert(markup.includes("Remove from list"), "confirm");
      assert(markup.includes('role="dialog"'), "dialog");
    },
  },
  {
    name: "checking large-file card disables duplicate Dropbox checks",
    run: () => {
      const markup = renderToStaticMarkup(
        <LargeMasterIntakePanel
          {...waitingPanelProps}
          status="waiting_for_dropbox"
          message=""
          checking
        />,
      );
      assert(markup.includes("Checking Dropbox…"), "checking label");
      assert(markup.includes("disabled"), "check disabled");
      assert(!markup.includes("Continue processing"), "no continue");
      assert(!markup.includes("Process artwork"), "no process");
    },
  },
  {
    name: "found large-file card replaces check with Process artwork",
    run: () => {
      const markup = renderToStaticMarkup(
        <LargeMasterIntakePanel
          {...waitingPanelProps}
          status="master_found"
          message="The expected master is in Dropbox and is a readable supported image."
          canContinueProcessing
        />,
      );
      assert(markup.includes("Master file found"), "found message");
      assert(markup.includes("Process artwork"), "process action");
      assert(!markup.includes("Check for uploaded file"), "check replaced");
      assert(!markup.includes("Continue processing"), "old continue gone");
      assert(!markup.includes("Checking Dropbox"), "not checking");
    },
  },
  {
    name: "processing large-file card shows the animated indicator",
    run: () => {
      const markup = renderToStaticMarkup(
        <LargeMasterIntakePanel
          {...waitingPanelProps}
          status="processing"
          message=""
          processing
          canContinueProcessing
        />,
      );
      assert(markup.includes("Processing artwork…"), "processing label");
      assert(markup.includes("submit-loading-dots"), "dots");
      assert(markup.includes("disabled"), "process disabled");
      assert(!markup.includes("Check for uploaded file"), "no check");
    },
  },
  {
    name: "completed large-file card offers view artwork and start new batch",
    run: () => {
      const markup = renderToStaticMarkup(
        <LargeMasterIntakePanel
          {...waitingPanelProps}
          status="completed"
          message=""
          onStartNewBatch={() => undefined}
        />,
      );
      assert(markup.includes("Artwork added to the archive"), "completed");
      assert(markup.includes("View artwork"), "view");
      assert(markup.includes("/artworks/1405"), "artwork href");
      assert(markup.includes("Start new batch"), "new batch");
      assert(!markup.includes("Process artwork"), "no process");
      assert(!markup.includes("Check for uploaded file"), "no check");
      assert(!markup.includes("Continue processing"), "no continue");
    },
  },
  {
    name: "file-not-found large-file card keeps waiting separate from failed",
    run: () => {
      const markup = renderToStaticMarkup(
        <LargeMasterIntakePanel
          {...waitingPanelProps}
          status="file_not_found"
          message="stale"
        />,
      );
      assert(markup.includes("File not found"), "badge");
      assert(
        markup.includes("find the expected file in the prepared folder"),
        "not-found copy",
      );
      assert(markup.includes("Check for uploaded file"), "can check again");
      assert(!markup.includes("Failed"), "not failed");
      assert(!markup.includes("Continue processing"), "no continue");
      assert(!markup.includes("Process artwork"), "no process");
    },
  },
  {
    name: "genuine Dropbox decode failure is unsupported, not Failed",
    run: () => {
      const markup = renderToStaticMarkup(
        <LargeMasterIntakePanel
          {...waitingPanelProps}
          status="unsupported_file"
          message={DECODE_FAILURE}
        />,
      );
      assert(markup.includes("Unsupported file"), "unsupported badge");
      assert(markup.includes(DECODE_FAILURE), "decode message after inspection");
      assert(!markup.includes("Waiting for Dropbox upload"), "not waiting");
      assert(!markup.includes(">Failed<"), "no failed badge");
      assert(!markup.includes("Processing failed"), "not processing failed");
      assert(!markup.includes("Continue processing"), "no continue");
    },
  },
  {
    name: "oversized master placeholder is not a Failed decode state",
    run: () => {
      const file = new File([new Uint8Array([73, 73])], "VauxsSwiftWatch.tif", {
        type: "image/tiff",
        lastModified: 1,
      });
      Object.defineProperty(file, "size", { value: MAX_FILE_BYTES + 1 });
      const markup = renderToStaticMarkup(
        <>
          <ArtworkImageThumb
            image={{ file, previewUrl: null, isTiff: true }}
          />
          <ArtworkImageThumbFooterNote
            image={{ file, previewUrl: null, isTiff: true }}
          />
        </>,
      );
      assert(markup.includes("VauxsSwiftWatch.tif"), "filename");
      assert(markup.includes("TIFF"), "type");
      assert(
        markup.includes(LARGE_MASTER_PREVIEW_UNAVAILABLE_MESSAGE),
        "large-master preview copy",
      );
      assert(!markup.includes("could not be decoded"), "not decode error");
      assert(!markup.includes("Status: Failed"), "not failed");
    },
  },
  {
    name: "progress bar is omitted until per-artwork upload items are provided",
    run: () => {
      const markup = renderToStaticMarkup(
        <BatchSubmittingStatusView artworkCount={5} elapsedSec={25} />,
      );
      assert(!markup.includes("h-2"), "no track height class");
      assert(!markup.includes("animate-pulse"), "no pulse bar");
      assert(!markup.includes("%"), "no percentage");
      assert(!markup.includes("w-1/3"), "no faux fill width");
    },
  },
  {
    name: "three-dot indicator is centered with a wait label",
    run: () => {
      const markup = renderToStaticMarkup(
        <BatchSubmittingStatusView artworkCount={5} elapsedSec={0} />,
      );
      assertEqual(
        submittingWaitLabel(5),
        "Submitting 5 artworks. Please wait.",
        "plural label",
      );
      assertEqual(
        submittingWaitLabel(1),
        "Submitting 1 artwork. Please wait.",
        "singular label",
      );
      assert(
        markup.includes('aria-label="Submitting 5 artworks. Please wait."'),
        "dots aria-label",
      );
      assert(markup.includes('aria-live="polite"'), "live region");
      assert(markup.includes('role="status"'), "status role");
      const dots = markup.match(/class="submit-loading-dot"/g) ?? [];
      assertEqual(dots.length, 3, "three dots");
      assert(markup.includes("submit-loading-dots"), "dots container");
    },
  },
  {
    name: "per-artwork upload progress and failure copy are shown",
    run: () => {
      const markup = renderToStaticMarkup(
        <BatchSubmittingStatusView
          artworkCount={1}
          elapsedSec={12}
          items={[
            {
              title: "Blue Garden",
              stage: "Uploading master to Dropbox…",
              percent: 0.42,
              error: null,
            },
            {
              title: "Red Field",
              stage: "Processing failed",
              percent: 1,
              error: "Derivative generation failed. Retry keeps this inventory ID.",
            },
          ]}
        />,
      );
      assert(markup.includes("42% uploaded"), "upload percent");
      assert(markup.includes("Uploading master to Dropbox…"), "upload stage");
      assert(
        markup.includes("Derivative generation failed. Retry keeps this inventory ID."),
        "failure copy",
      );
    },
  },
  {
    name: "CSS sequences the dots and respects reduced motion",
    run: () => {
      const css = readFileSync(cssPath, "utf8");
      assert(css.includes("@keyframes submit-loading-dot"), "keyframe");
      assert(css.includes("animation: submit-loading-dot 1.2s"), "1.2s cycle");
      assert(css.includes("animation-delay: 0.4s"), "center delay");
      assert(css.includes("animation-delay: 0.8s"), "right delay");
      assert(css.includes("width: 8px"), "dot size");
      assert(css.includes("gap: 8px"), "dot spacing");
      assert(
        css.includes("prefers-reduced-motion: reduce"),
        "reduced-motion query",
      );
      const reduced = css.slice(
        css.indexOf("@media (prefers-reduced-motion: reduce)"),
      );
      assert(reduced.includes("animation: none"), "static dots when reduced");
    },
  },
  {
    name: "entering a batch step scrolls to the top instantly and focuses the heading",
    run: () => {
      const scrollCalls: unknown[] = [];
      const focusCalls: unknown[] = [];
      const scrollingElement = { scrollTop: 840, scrollLeft: 12 };
      enterBatchStep(
        {
          focus(options) {
            focusCalls.push(options);
          },
        },
        {
          scrollTo(options) {
            scrollCalls.push(options);
          },
        },
        { scrollingElement },
      );
      assertEqual(scrollingElement.scrollTop, 0, "document scrollTop reset");
      assertEqual(scrollingElement.scrollLeft, 0, "document scrollLeft reset");
      assertEqual(scrollCalls.length, 1, "one window scroll");
      const scroll = scrollCalls[0] as {
        top: number;
        left: number;
        behavior: string;
      };
      assertEqual(scroll.top, 0, "top");
      assertEqual(scroll.left, 0, "left");
      assertEqual(scroll.behavior, BATCH_STEP_SCROLL.behavior, "instant");
      assertEqual(BATCH_STEP_SCROLL.behavior, "auto", "not smooth");
      assertEqual(focusCalls.length, 1, "heading focused");
      const focus = focusCalls[0] as { preventScroll?: boolean };
      assertEqual(focus.preventScroll, true, "no extra heading scroll");
    },
  },
  {
    name: "entering Review Batch uses top-of-step heading focus and scroll",
    run: () => {
      const reviewPath = join(
        dirname(fileURLToPath(import.meta.url)),
        "../../components/artwork/BatchReview.tsx",
      );
      const headingPath = join(
        dirname(fileURLToPath(import.meta.url)),
        "../../components/artwork/BatchStepHeading.tsx",
      );
      const reviewSource = readFileSync(reviewPath, "utf8");
      const headingSource = readFileSync(headingPath, "utf8");
      assert(
        reviewSource.includes("BatchStepHeading"),
        "Review Batch mounts the shared step heading",
      );
      assert(
        !reviewSource.includes("Shared details"),
        "Review Batch source has no Shared details summary",
      );
      assert(
        !reviewSource.includes("SharedMetaRows"),
        "shared summary helper removed",
      );
      assert(
        !reviewSource.includes("enterOnMount"),
        "Review Batch enters the step on mount, not on later updates",
      );
      assert(
        headingSource.includes("enterBatchStep(headingRef.current)"),
        "heading mount runs enterBatchStep",
      );
      assert(
        headingSource.includes("useLayoutEffect"),
        "step entry runs after the heading is committed",
      );
      assert(
        headingSource.includes("}, []);"),
        "step entry effect does not re-run on form updates",
      );

      const appended = appendFilesToBatch(
        createEmptyBatch(),
        [
          new File([new Uint8Array(32)], "Tulip-Tree.jpg", {
            type: "image/jpeg",
            lastModified: 1_700_000_000_000,
          }),
        ],
        { allowDuplicates: true, createPreviewUrls: false },
      );
      const markup = renderToStaticMarkup(
        <BatchReview
          shared={appended.batch.shared}
          artworks={appended.batch.artworks}
          onBack={() => undefined}
          onReset={() => undefined}
          archiveTarget="production"
        />,
      );
      assert(markup.includes("Review batch"), "review heading");
      assert(
        markup.includes(`id="${BATCH_STEP_HEADING_ID}"`),
        "stable step heading id",
      );
      assert(markup.includes('tabindex="-1"'), "programmatically focusable");
      assert(markup.includes("outline-none"), "no mouse focus ring");
      assert(markup.includes("scroll-mt-[68px]"), "clears the in-flow header");
      assert(!markup.includes("Test image processing"), "no per-card test button");
      assert(!markup.includes("Test next unprocessed"), "no batch test button");
      assert(!markup.includes("Status: Not tested"), "no optional test status");
      assert(
        !markup.includes("Optional: test image"),
        "no copy suggesting pre-submission testing",
      );
    },
  },
  {
    name: "Review Batch omits the Shared details summary while applied values remain on artworks",
    run: () => {
      const shared: BatchSharedDetails = {
        exhibition: "Spring Exhibition",
        gallery: "Augen Gallery",
        exhibitionYear: "2026",
        defaultArtworkYear: "2026",
        photographer: "Mario Gallucci",
        defaultMedium: "Monotype",
        defaultDimensionUnit: "in",
      };
      const appended = appendFilesToBatch(
        { ...createEmptyBatch(), shared },
        [
          new File([new Uint8Array(32)], "Tulip-Tree.jpg", {
            type: "image/jpeg",
            lastModified: 1_700_000_000_000,
          }),
        ],
        { allowDuplicates: true, createPreviewUrls: false },
      );
      const artworks = resolveApplySharedDetails(
        appended.batch.artworks,
        shared,
        "apply",
      );
      const artwork = artworks[0]!;
      assertEqual(
        artwork.overrides.exhibition,
        "Spring Exhibition",
        "exhibition applied to artwork",
      );
      assertEqual(
        artwork.overrides.gallery,
        "Augen Gallery",
        "gallery applied to artwork",
      );
      assertEqual(
        artwork.overrides.photographer,
        "Mario Gallucci",
        "photographer applied to artwork",
      );
      assertEqual(shared.exhibitionYear, "2026", "exhibition year still on shared");

      const markup = renderToStaticMarkup(
        <BatchReview
          shared={shared}
          artworks={artworks}
          onBack={() => undefined}
          onReset={() => undefined}
          archiveTarget="production"
        />,
      );
      assert(!markup.includes("Shared details"), "no shared summary heading");
      assert(
        !markup.includes("review-shared-heading"),
        "no shared summary section",
      );
      assert(
        !markup.includes("Exhibition year"),
        "no exhibition-year summary row",
      );
      assert(markup.includes("review-artworks-heading"), "artworks remain");
      assert(markup.includes("Spring Exhibition"), "exhibition on artwork card");
      assert(markup.includes("Augen Gallery"), "gallery on artwork card");
      assert(markup.includes("Mario Gallucci"), "photographer on artwork card");
    },
  },
  {
    name: "Review Batch large-file copy does not use optional processing-test status",
    run: () => {
      const file = new File([new Uint8Array([73, 73])], "VauxsSwiftWatch.tif", {
        type: "image/tiff",
        lastModified: 1,
      });
      Object.defineProperty(file, "size", { value: MAX_FILE_BYTES + 1 });
      const appended = appendFilesToBatch(
        createEmptyBatch(),
        [file],
        { allowDuplicates: true, createPreviewUrls: false },
      );
      const artwork = appended.batch.artworks[0]!;
      artwork.title = "Vaux's Swift Watch";
      artwork.year = "2017";
      artwork.medium = "Monotype";
      const markup = renderToStaticMarkup(
        <BatchReview
          shared={appended.batch.shared}
          artworks={[artwork]}
          onBack={() => undefined}
          onReset={() => undefined}
          archiveTarget="production"
        />,
      );
      assert(markup.includes("Prepare large-file intake"), "large-file submit");
      assert(
        markup.includes("will use Dropbox intake"),
        "batch-level large-file copy",
      );
      assert(
        markup.includes("This master is over"),
        "card-level large-file copy",
      );
      assert(!markup.includes("Test image processing"), "no test button");
      assert(!markup.includes("Use Dropbox intake"), "old test-button label gone");
      assert(!markup.includes("Status: Not tested"), "no not-tested status");
      assert(!markup.includes("Processing failed"), "not a failed local test");
      assert(!markup.includes("could not be decoded"), "not a decode failure");
    },
  },
  {
    name: "edit screen lists Batch summary before Shared details and has no selection banner",
    run: () => {
      const formPath = join(
        dirname(fileURLToPath(import.meta.url)),
        "../../components/artwork/NewArtworkBatchForm.tsx",
      );
      const formSource = readFileSync(formPath, "utf8");
      assert(
        /<p role="status" aria-live="polite" className="sr-only">\s*\{uploadNotice \?\? ""\}\s*<\/p>/.test(
          formSource,
        ),
        "file-selection success is an aria-live announcement",
      );
      assert(
        !/uploadNotice \? \(/.test(formSource),
        "upload notice is not a conditional visual banner",
      );

      const appended = appendFilesToBatch(
        createEmptyBatch(),
        [
          new File([new Uint8Array(32)], "Tulip-Tree.jpg", {
            type: "image/jpeg",
            lastModified: 1_700_000_000_000,
          }),
        ],
        { allowDuplicates: true, createPreviewUrls: false },
      );
      const markup = renderToStaticMarkup(
        <NewArtworkBatchForm initialBatch={appended.batch} />,
      );
      const summaryIndex = markup.indexOf("Batch summary");
      const sharedIndex = markup.indexOf("Shared details for this batch");
      const artworksIndex = markup.indexOf('id="artworks-heading"');
      assert(summaryIndex > -1, "Batch summary present");
      assert(sharedIndex > summaryIndex, "Shared details after Batch summary");
      assert(artworksIndex > sharedIndex, "Artworks after Shared details");
      assert(!markup.includes("images selected"), "no selection banner copy");
      assert(
        !markup.includes("artwork entries created"),
        "no artwork-created banner copy",
      );
      assert(
        !markup.includes("Apply Untitled to selected artworks"),
        "no bulk untitled button",
      );
      assert(markup.includes("Missing / no known title"), "per-artwork untitled");
    },
  },
  {
    name: "edit and completion step headings are also programmatically focusable",
    run: () => {
      const formPath = join(
        dirname(fileURLToPath(import.meta.url)),
        "../../components/artwork/NewArtworkBatchForm.tsx",
      );
      const reportPath = join(
        dirname(fileURLToPath(import.meta.url)),
        "../../components/artwork/BatchSubmissionReport.tsx",
      );
      const formSource = readFileSync(formPath, "utf8");
      const reportSource = readFileSync(reportPath, "utf8");
      assert(
        formSource.includes("enterOnMount={!skipInitialEditStepEntryRef.current}"),
        "returning to edit/start-new-batch enters the step; initial page load does not",
      );
      assert(
        reportSource.includes("BatchStepHeading"),
        "completion screen mounts the shared step heading",
      );
      assert(
        !reportSource.includes("enterOnMount"),
        "completion enters the step on mount",
      );
      const editMarkup = renderToStaticMarkup(<NewArtworkBatchForm />);
      assert(editMarkup.includes("Add New Artwork"), "edit heading");
      assert(
        editMarkup.includes(`id="${BATCH_STEP_HEADING_ID}"`),
        "edit step id",
      );
      assert(editMarkup.includes('tabindex="-1"'), "edit heading focusable");

      const completeMarkup = renderToStaticMarkup(
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
      assert(completeMarkup.includes("Submission complete"), "complete heading");
      assert(
        completeMarkup.includes(`id="${BATCH_STEP_HEADING_ID}"`),
        "complete step id",
      );
      assert(
        completeMarkup.includes('tabindex="-1"'),
        "complete heading focusable",
      );
    },
  },
  {
    name: "submit confirmation uses singular and plural headings and actions",
    run: () => {
      assertEqual(
        submitConfirmHeading(1),
        "Ready to add 1 artwork?",
        "singular heading",
      );
      assertEqual(
        submitConfirmHeading(7),
        "Ready to add 7 artworks?",
        "plural heading",
      );
      assertEqual(
        submitConfirmActionLabel(1),
        "Add 1 artwork",
        "singular action",
      );
      assertEqual(
        submitConfirmActionLabel(7),
        "Add 7 artworks",
        "plural action",
      );

      const singular = renderToStaticMarkup(
        <BatchSubmitConfirmationView
          artworkCount={1}
          sourceBytes={12 * 1024 * 1024}
          largeFileCount={0}
          onConfirm={() => undefined}
          onBack={() => undefined}
        />,
      );
      const plural = renderToStaticMarkup(
        <BatchSubmitConfirmationView
          artworkCount={7}
          sourceBytes={707.4 * 1024 * 1024}
          largeFileCount={0}
          onConfirm={() => undefined}
          onBack={() => undefined}
        />,
      );
      assert(singular.includes("Ready to add 1 artwork?"), "singular heading markup");
      assert(singular.includes("Add 1 artwork"), "singular button markup");
      assert(!singular.includes("Submit Batch"), "review trigger stays off the modal");
      assert(plural.includes("Ready to add 7 artworks?"), "plural heading markup");
      assert(plural.includes("Add 7 artworks"), "plural button markup");
      assert(!plural.includes("Add 7 artwork<"), "plural is not truncated to artwork");
    },
  },
  {
    name: "submit confirmation is a centered modal overlay, not an in-flow card",
    run: () => {
      const markup = renderToStaticMarkup(
        <BatchSubmitConfirmationView
          artworkCount={9}
          sourceBytes={611.5 * 1024 * 1024}
          largeFileCount={0}
          onConfirm={() => undefined}
          onBack={() => undefined}
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
      assert(markup.includes("Ready to add 9 artworks?"), "count heading");
      assert(markup.includes("611.5 MB total"), "formatted total size");
      assert(markup.includes("Add 9 artworks"), "primary action");
      assert(markup.includes("Go back"), "secondary action");
      assert(!markup.includes("mt-6 border"), "not the in-flow card");
      assert(!markup.includes("Submit Batch"), "Submit Batch is not a modal action");
    },
  },
  {
    name: "Review Batch keeps Submit Batch in place and does not insert confirmation into the layout",
    run: () => {
      const appended = appendFilesToBatch(
        createEmptyBatch(),
        [
          new File([new Uint8Array(32)], "Tulip-Tree.jpg", {
            type: "image/jpeg",
            lastModified: 1_700_000_000_000,
          }),
        ],
        { allowDuplicates: true, createPreviewUrls: false },
      );
      const markup = renderToStaticMarkup(
        <BatchReview
          shared={appended.batch.shared}
          artworks={appended.batch.artworks}
          onBack={() => undefined}
          onReset={() => undefined}
          archiveTarget="production"
        />,
      );
      assert(markup.includes("Submit Batch"), "review trigger remains");
      assert(markup.includes("review-artworks-heading"), "artwork list remains");
      assert(!markup.includes("Ready to add"), "confirmation starts closed");
      assert(!markup.includes("Add 1 artwork"), "modal action is not in the page");
      assert(!markup.includes("fixed inset-0"), "overlay is not in the page flow");
      assert(
        !markup.includes(SUBMIT_CONFIRM_DELIVERY),
        "delivery copy stays in the modal",
      );

      const source = readFileSync(reviewPath, "utf8");
      const statusIndex = source.indexOf('role="status"');
      const artworksIndex = source.indexOf(
        'aria-labelledby="review-artworks-heading"',
      );
      const confirmIndex = source.indexOf("<BatchSubmitConfirmationView");
      const confirmCount = source.split("<BatchSubmitConfirmationView").length - 1;
      assert(statusIndex > -1, "review status area exists");
      assert(artworksIndex > -1, "artwork list exists");
      assert(confirmIndex > -1, "confirmation is rendered");
      assertEqual(confirmCount, 1, "only one confirmation is mounted");
      assert(
        confirmIndex > artworksIndex,
        "modal is not inserted between the action area and the artwork list",
      );
      assert(
        !source.slice(statusIndex, artworksIndex).includes(
          "BatchSubmitConfirmationView",
        ),
        "confirmation is not between Submit Batch and Artworks",
      );
      assert(
        source.includes("confirmOpen && !submitting"),
        "confirmation unmounts as soon as submission starts",
      );
      assert(
        /className="animate-fade-in">[\s\S]*<\/div>\s*\{confirmOpen && !submitting/.test(
          source,
        ),
        "modal is a sibling of the animated review content",
      );
      assert(source.includes("openConfirm"), "Submit Batch opens confirmation");
      assert(
        source.includes('onClick={openConfirm}'),
        "review trigger opens the modal",
      );
      const confirmOnBack = source.indexOf("onBack={() => {", confirmIndex);
      assert(confirmOnBack > -1, "Go back handler exists");
      const confirmOnBackBody = source.slice(
        confirmOnBack,
        source.indexOf("}}", confirmOnBack) + 2,
      );
      assert(
        confirmOnBackBody.includes("setConfirmOpen(false)"),
        "Go back closes the modal",
      );
      assert(
        !confirmOnBackBody.includes("runSubmit"),
        "Go back does not start submission",
      );
      assert(
        !confirmOnBackBody.includes("setSubmitting(true)"),
        "Go back leaves Review Batch unchanged",
      );
    },
  },
  {
    name: "submit confirmation traps focus, dismisses on Escape, and restores focus without scrolling",
    run: () => {
      const viewSource = readFileSync(confirmViewPath, "utf8");
      assert(
        viewSource.includes("isModalDismissKey(event.key)"),
        "Escape closes the modal",
      );
      assert(
        viewSource.includes("if (!startedRef.current) onBack()"),
        "Escape does not confirm and is ignored after submit starts",
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
        "focus returns to Submit Batch without scrolling",
      );
      assert(
        viewSource.includes("restoreFocusRef.current = false"),
        "confirming does not return focus to Submit Batch",
      );
      assert(
        viewSource.includes("event.stopPropagation()"),
        "backdrop click does not reach the confirm action",
      );
      assert(
        viewSource.includes("onClick={handleBack}"),
        "backdrop and Go back cancel",
      );
      assert(
        viewSource.includes("onClick={handleConfirm}"),
        "only the primary action confirms",
      );
      assert(
        !viewSource.includes("onClick={onConfirm}"),
        "backdrop is not wired to confirm",
      );

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

      let focusOptions: FocusOptions | undefined;
      focusWithoutScrolling({
        focus(options) {
          focused.push("heading");
          focusOptions = options;
        },
      });
      assertEqual(focused.at(-1), "heading", "initial heading focus helper");
      assertEqual(
        focusOptions?.preventScroll,
        true,
        "restore/open focus does not scroll",
      );
    },
  },
  {
    name: "submit confirmation shows formatted total batch size and delivery copy",
    run: () => {
      const bytes = 707.4 * 1024 * 1024;
      assertEqual(
        submitConfirmSizeLabel(bytes),
        `${formatFileSize(bytes)} total`,
        "size helper",
      );
      const markup = renderToStaticMarkup(
        <BatchSubmitConfirmationView
          artworkCount={7}
          sourceBytes={bytes}
          largeFileCount={0}
          onConfirm={() => undefined}
          onBack={() => undefined}
        />,
      );
      assert(markup.includes(submitConfirmSizeLabel(bytes)), "formatted size");
      assert(markup.includes("707.4 MB total"), "example size");
      assert(markup.includes(SUBMIT_CONFIRM_DELIVERY), "delivery copy");
      assert(markup.includes(SUBMIT_CONFIRM_KEEP_OPEN), "keep-open copy");
      assert(markup.includes("Go back"), "secondary action");
      assert(!markup.includes("list-disc"), "no bullet list");
      assert(!markup.includes("Confirm permanent submission"), "old heading gone");
      assert(!markup.includes("Inventory Claims"), "no claims copy");
      assert(!markup.includes("Failed Intake"), "no failed-intake copy");
      assert(!markup.includes("Preview inventory numbers"), "no preview warning");
      assert(!markup.includes("does not retain"), "no retain copy");
      assert(!markup.includes("permanently consume"), "no consumed-ID copy");
      assert(!markup.includes("type=\"checkbox\""), "no confirmation checkbox");
      assert(!markup.includes(SUBMIT_CONFIRM_LARGE_FILES), "no large-file note");
    },
  },
  {
    name: "submit confirmation adds a concise large-file note for oversized batches",
    run: () => {
      assertEqual(
        submitConfirmLargeFileNote({ artworkCount: 2, largeFileCount: 2 }),
        SUBMIT_CONFIRM_LARGE_FILES,
        "all-large note",
      );
      assertEqual(
        submitConfirmLargeFileNote({ artworkCount: 3, largeFileCount: 1 }),
        `${SUBMIT_CONFIRM_LARGE_FILES} ${SUBMIT_CONFIRM_MIXED_NEXT_STEP}`,
        "mixed note",
      );
      assertEqual(
        submitConfirmLargeFileNote({ artworkCount: 3, largeFileCount: 0 }),
        null,
        "normal batch has no large-file note",
      );

      const largeOnly = renderToStaticMarkup(
        <BatchSubmitConfirmationView
          artworkCount={2}
          sourceBytes={400 * 1024 * 1024}
          largeFileCount={2}
          onConfirm={() => undefined}
          onBack={() => undefined}
        />,
      );
      assert(largeOnly.includes(SUBMIT_CONFIRM_LARGE_FILES), "large-file sentence");
      assert(
        !largeOnly.includes(SUBMIT_CONFIRM_MIXED_NEXT_STEP),
        "all-large does not imply mixed auto-upload",
      );
      assert(!largeOnly.includes("Vercel"), "no vercel copy");
      assert(!largeOnly.includes("Inventory Claims"), "no claims copy");

      const mixed = renderToStaticMarkup(
        <BatchSubmitConfirmationView
          artworkCount={3}
          sourceBytes={500 * 1024 * 1024}
          largeFileCount={1}
          onConfirm={() => undefined}
          onBack={() => undefined}
        />,
      );
      assert(mixed.includes(SUBMIT_CONFIRM_LARGE_FILES), "mixed large-file sentence");
      assert(
        mixed.includes(SUBMIT_CONFIRM_MIXED_NEXT_STEP),
        "mixed next step is explicit",
      );
      assert(!mixed.includes("the entire batch will upload"), "no auto-upload claim");
    },
  },
  {
    name: "submission failure copy names the stage and inventory ID outside confirmation",
    run: () => {
      const confirm = renderToStaticMarkup(
        <BatchSubmitConfirmationView
          artworkCount={1}
          sourceBytes={1024}
          largeFileCount={0}
          onConfirm={() => undefined}
          onBack={() => undefined}
        />,
      );
      assert(!confirm.includes("Submission failed"), "failure stays off confirmation");
      assert(!confirm.includes("Inventory Claims"), "no claims on confirmation");
      assert(!confirm.includes("Failed Intake"), "no failed-intake on confirmation");

      const failure = renderToStaticMarkup(
        <BatchSubmitFailureView
          failure={{
            message: "Dropbox rejected the master upload.",
            stage: "Uploading master to Dropbox",
            inventoryId: 1405,
          }}
        />,
      );
      assert(failure.includes("Submission failed"), "failure heading");
      assert(failure.includes("Inventory 1405"), "inventory ID");
      assert(failure.includes("Uploading master to Dropbox"), "failed stage");
      assert(failure.includes("Dropbox rejected the master upload."), "message");
      assert(!failure.includes("Inventory Claims"), "no claims recovery");
      assert(!failure.includes("Failed Intake"), "no failed-intake recovery");
    },
  },
  {
    name: "review confirmation still uses the existing submission pipeline",
    run: () => {
      const source = readFileSync(reviewPath, "utf8");
      const confirmStart = source.indexOf("async function runSubmit()");
      const confirmNext = source.indexOf("\n  async function ", confirmStart + 1);
      assert(confirmStart > -1, "runSubmit exists");
      const runSubmitBody = source.slice(
        confirmStart,
        confirmNext === -1 ? undefined : confirmNext,
      );
      assert(
        source.includes("BatchSubmitConfirmationView"),
        "confirmation view mounted",
      );
      assert(
        source.includes("void runSubmit()"),
        "primary action still starts runSubmit",
      );
      assertEqual(
        runSubmitBody.split("void runSubmit()").length - 1,
        0,
        "runSubmit does not recurse",
      );
      assert(
        runSubmitBody.includes(
          "if (submitLockRef.current || submitting || !attemptIdRef.current) return",
        ),
        "duplicate clicks return immediately",
      );
      assert(
        runSubmitBody.includes("submitLockRef.current = true"),
        "submit lock is taken before fetch",
      );
      assert(
        /submitLockRef\.current = true[\s\S]{0,80}setSubmitting\(true\)/.test(
          runSubmitBody,
        ),
        "submitting is disabled immediately after the lock",
      );
      assert(
        runSubmitBody.includes("setConfirmOpen(false)"),
        "confirmation modal closes before the upload continues",
      );
      assert(
        runSubmitBody.includes("scrollBatchPageToTop()"),
        "user is returned to the top of the progress view",
      );
      assert(
        source.includes("function scrollBatchPageToTop") === false &&
          source.includes("scrollBatchPageToTop"),
        "review uses the shared top-of-page helper",
      );
      assertEqual(
        typeof scrollBatchPageToTop,
        "function",
        "scroll helper is the existing export",
      );
      assert(
        source.includes('fetch("/api/artwork-batches/prepare"'),
        "prepare unchanged",
      );
      assert(
        source.includes('fetch("/api/artwork-batches/upload-link"'),
        "upload-link unchanged",
      );
      assert(
        source.includes("uploadMasterToTemporaryLink"),
        "direct master upload unchanged",
      );
      assert(
        source.includes('fetch("/api/artwork-batches/process"'),
        "process unchanged",
      );
      assert(
        source.includes('fetch("/api/artwork-batches/large-file/process"'),
        "large-file process unchanged",
      );
      assert(
        !source.includes("/api/dev/process-artwork-image"),
        "optional pre-submission process test removed",
      );
      assert(!source.includes("setConfirmed"), "checkbox gate removed");
      assert(!source.includes("Confirm and submit"), "old primary label gone");
      assert(!source.includes("Confirm and prepare intake"), "old large-file label gone");

      const viewSource = readFileSync(confirmViewPath, "utf8");
      assert(
        viewSource.includes("if (startedRef.current) return"),
        "confirm button ignores a second click",
      );
      assert(
        viewSource.includes("startedRef.current = true"),
        "confirm click is recorded before onConfirm",
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

console.log(`\nAll ${tests.length} submitting-status presentation tests passed.`);
