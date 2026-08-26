/**
 * Presentation tests for the Review Batch submitting-status UI.
 * Static markup only — no browser, no new test framework.
 * Run: npx tsx lib/artwork/submit-status-ui.test.tsx
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import { BatchImageUploader } from "@/components/artwork/BatchImageUploader";
import { LargeMasterIntakePanel } from "@/components/artwork/LargeMasterIntakePanel";
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

const tests: TestCase[] = [
  {
    name: "submitting panel keeps existing copy and elapsed text",
    run: () => {
      const markup = renderToStaticMarkup(
        <BatchSubmittingStatusView artworkCount={5} elapsedSec={25} />,
      );
      assert(markup.includes("Submitting 5 artworks"), "heading");
      assert(
        markup.includes("Masters upload directly to Dropbox (up to 150 MB each)."),
        "direct-upload copy",
      );
      assert(
        markup.includes("Larger masters"),
        "large-file wait copy",
      );
      assert(markup.includes("Do not close this page."), "do-not-close copy");
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
      assert(markup.includes("Larger masters stay in the batch"), "large-file copy");
    },
  },
  {
    name: "large-file intake panel shows reserved ID, filename, folder, and actions",
    run: () => {
      const markup = renderToStaticMarkup(
        <LargeMasterIntakePanel
          inventoryId={1401}
          title="Blue Garden"
          folderName="2026_KO_1401_BlueGarden"
          masterFilename="2026_KO_1401_BlueGarden_master_01.tif"
          folderWebUrl="https://www.dropbox.com/home/Apps/Kim%20Art%20Archive/2026_KO_1401_BlueGarden"
          status="waiting_for_dropbox"
          message="Upload the expected filename through Dropbox."
          canContinueProcessing={false}
          onCheck={() => undefined}
          onContinue={() => undefined}
        />,
      );
      assert(markup.includes("Inventory 1401"), "inventory ID");
      assert(
        markup.includes("2026_KO_1401_BlueGarden_master_01.tif"),
        "expected filename",
      );
      assert(markup.includes("2026_KO_1401_BlueGarden"), "folder");
      assert(markup.includes("Waiting for Dropbox upload"), "waiting status");
      assert(markup.includes("Check for master"), "check action");
      assert(markup.includes("Continue processing"), "continue action");
      assert(markup.includes("Open destination folder on dropbox.com"), "web link");
      assert(markup.includes("Dropbox desktop"), "desktop instructions");
      assert(!markup.includes("sl."), "no token-looking text");
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
