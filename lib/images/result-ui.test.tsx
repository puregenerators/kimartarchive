/**
 * Presentation tests for the image-processing result UI.
 * Static markup only — no browser, no new test framework.
 * Run: npx tsx lib/images/result-ui.test.tsx
 */

import { renderToStaticMarkup } from "react-dom/server";

import { ProcessingResultPanel } from "@/components/artwork/ProcessingResultPanel";
import type { ArtworkProcessingSuccess } from "@/lib/images/client-types";
import {
  buildProcessingSummaryItems,
  buildSourceTechnicalItems,
  formatOutputEncodingLine,
  formatOutputSizeLine,
  formatProcessingDuration,
  formatSizeComparison,
  rawFilenameForCopy,
} from "@/lib/images/result-presentation";

type TestCase = {
  name: string;
  run: () => void;
};

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(
      `${message}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`,
    );
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const MULTI_PAGE_WARNING =
  "Multi-page TIFF detected (3 pages). Only page 1 was used for HR and web derivatives.";

/** Byte counts chosen so formatted values are stable, hand-checkable strings. */
const result: ArtworkProcessingSuccess = {
  status: "success",
  fingerprint: "fp-1",
  resultId: "result-1",
  expiresAt: 0,
  durationMs: 2594,
  warnings: [MULTI_PAGE_WARNING],
  source: {
    originalFilename: "BlueGarden_scan.tif",
    detectedFormat: "tiff",
    width: 6932,
    height: 4758,
    pixelCount: 6932 * 4758,
    colourspace: "srgb",
    channels: 3,
    hasAlpha: false,
    orientation: 1,
    density: 300,
    hasIccProfile: true,
    originalByteLength: 99_000_000,
    pageCount: 3,
    isMultiPage: true,
  },
  master: {
    filename: "2026_KO_1000_BlueGarden_master_01.tif",
    extension: ".tif",
    byteLength: 99_000_000,
    preservedOriginalBytes: true,
  },
  hr: {
    filename: "2026_KO_1000_BlueGarden_hr_01.jpg",
    width: 6932,
    height: 4758,
    byteLength: 9_227_000,
    format: "jpeg",
    quality: 95,
    wasResized: false,
    previewUrl: "/api/dev/processed-image/result-1/hr",
    downloadUrl: "/api/dev/processed-image/result-1/hr?download=1",
  },
  web: {
    filename: "2026_KO_1000_BlueGarden_web_01.jpg",
    width: 2400,
    height: 1647,
    byteLength: 776_000,
    format: "jpeg",
    quality: 86,
    wasResized: true,
    previewUrl: "/api/dev/processed-image/result-1/web",
    downloadUrl: "/api/dev/processed-image/result-1/web?download=1",
  },
  comparisons: {
    hrSizeRatio: 9_227_000 / 99_000_000,
    webSizeRatio: 776_000 / 99_000_000,
    webSizeReductionPercent: 99.2,
    webWasResized: true,
  },
};

function renderPanel(overrides?: Partial<ArtworkProcessingSuccess>): string {
  return renderToStaticMarkup(
    <ProcessingResultPanel
      result={{ ...result, ...overrides }}
      sourcePreviewUrl={null}
      isTiff
      stale={false}
    />,
  );
}

const tests: TestCase[] = [
  {
    name: "size comparison renders one statement per derivative",
    run: () => {
      assertEqual(
        formatSizeComparison(result.comparisons.webSizeRatio),
        "99.2% smaller than source",
        "web comparison",
      );
      assertEqual(
        formatSizeComparison(result.comparisons.hrSizeRatio),
        "90.7% smaller than source",
        "hr comparison",
      );
      assertEqual(formatSizeComparison(1), "Same size as source", "equal");
      assertEqual(formatSizeComparison(1.25), "25% larger than source", "larger");
      assertEqual(formatSizeComparison(null), null, "missing ratio");
      assertEqual(formatSizeComparison(Number.NaN), null, "non-finite ratio");
    },
  },
  {
    name: "duplicate reduction wording is gone from the panel",
    run: () => {
      const markup = renderPanel();
      assert(
        markup.includes("99.2% smaller than source"),
        "single web reduction statement",
      );
      assert(
        !markup.includes("file-size reduction"),
        "old duplicate reduction wording removed",
      );
      assertEqual(
        markup.split("99.2%").length - 1,
        1,
        "web reduction percent appears once",
      );
    },
  },
  {
    name: "filename copy helper returns the raw filename",
    run: () => {
      assertEqual(
        rawFilenameForCopy("2026_KO_1000_BlueGarden_hr_01.jpg"),
        "2026_KO_1000_BlueGarden_hr_01.jpg",
        "unchanged filename",
      );
      assertEqual(
        rawFilenameForCopy("\n  2026_KO_1000_BlueGarden_web_01.jpg  "),
        "2026_KO_1000_BlueGarden_web_01.jpg",
        "surrounding whitespace only",
      );
    },
  },
  {
    name: "copy controls are labelled buttons for every planned/generated file",
    run: () => {
      const markup = renderPanel();
      for (const [label, filename] of [
        ["high-resolution JPG", result.hr.filename],
        ["web JPG", result.web.filename],
        ["planned master", result.master.filename],
      ] as const) {
        assert(
          markup.includes(`aria-label="Copy ${label} filename ${filename}"`),
          `accessible copy label for ${label}`,
        );
      }
      assertEqual(
        markup.split(">Copy</button>").length - 1,
        3,
        "one copy button per file",
      );
    },
  },
  {
    name: "technical details are a disclosure collapsed by default",
    run: () => {
      const markup = renderPanel();
      assert(markup.includes("<details"), "uses native disclosure");
      assert(
        !/<details[^>]*\sopen/.test(markup),
        "disclosure is collapsed by default",
      );
      assert(markup.includes("Technical details"), "disclosure summary label");

      for (const label of [
        "Detected format",
        "Color space",
        "DPI",
        "ICC profile",
        "Alpha",
        "Orientation",
        "Channels",
        "Pages",
      ]) {
        assert(markup.includes(label), `technical detail preserved: ${label}`);
      }
    },
  },
  {
    name: "important warnings stay outside the disclosure",
    run: () => {
      const markup = renderPanel();
      const warningIndex = markup.indexOf(MULTI_PAGE_WARNING);
      assert(warningIndex >= 0, "warning is rendered");
      assert(
        warningIndex < markup.indexOf("<details"),
        "warning is not inside technical details",
      );
      assert(markup.includes(">Warning<"), "warnings labelled by text, not color");
    },
  },
  {
    name: "original filename and source size stay visible outside the disclosure",
    run: () => {
      const markup = renderPanel();
      const detailsIndex = markup.indexOf("<details");
      assert(
        markup.indexOf(result.source.originalFilename) < detailsIndex,
        "source filename visible before disclosure",
      );
      assert(
        markup.indexOf("94.4 MB") < detailsIndex,
        "source size visible before disclosure",
      );
    },
  },
  {
    name: "summary uses existing result data",
    run: () => {
      const items = buildProcessingSummaryItems(result);
      assertEqual(items.length, 4, "four summary items");
      assertEqual(items[0]!.label, "Master", "master label");
      assertEqual(items[0]!.value, "94.4 MB", "master size");
      assertEqual(items[1]!.value, "8.8 MB", "hr size");
      assertEqual(items[2]!.value, "757.8 KB", "web size");
      assertEqual(items[3]!.label, "Processed in", "duration label");
      assertEqual(items[3]!.value, "2.6 seconds", "duration value");

      const markup = renderPanel();
      for (const item of items) {
        assert(markup.includes(item.value), `summary renders ${item.value}`);
      }
    },
  },
  {
    name: "processing duration formatting",
    run: () => {
      assertEqual(formatProcessingDuration(594), "594 ms", "sub-second");
      assertEqual(formatProcessingDuration(2594), "2.6 seconds", "seconds");
      assertEqual(formatProcessingDuration(-1), "—", "invalid");
    },
  },
  {
    name: "output lines lead with size and dimensions",
    run: () => {
      assertEqual(
        formatOutputSizeLine(result.hr),
        "8.8 MB · 6932 × 4758",
        "hr primary line",
      );
      assertEqual(
        formatOutputEncodingLine(result.hr),
        "Quality 95 · Original dimensions",
        "hr secondary line",
      );
      assertEqual(
        formatOutputSizeLine(result.web),
        "757.8 KB · 2400 × 1647",
        "web primary line",
      );
      assertEqual(
        formatOutputEncodingLine(result.web),
        "Quality 86 · Resized to 2400 px long edge",
        "web secondary line",
      );
    },
  },
  {
    name: "optional source details are omitted when absent",
    run: () => {
      const items = buildSourceTechnicalItems({
        ...result.source,
        orientation: null,
        channels: null,
        pageCount: null,
        isMultiPage: false,
      });
      const labels = items.map((item) => item.label);
      assert(!labels.includes("Orientation"), "orientation omitted");
      assert(!labels.includes("Channels"), "channels omitted");
      assert(!labels.includes("Pages"), "pages omitted");
      assert(labels.includes("Detected format"), "core details kept");
    },
  },
  {
    name: "dev label is present but separate from the heading",
    run: () => {
      const markup = renderPanel();
      assert(
        markup.includes("Dev preview · processed in 2594 ms"),
        "quiet dev label",
      );
      assert(
        markup.includes(">Image processing result</h4>"),
        "heading text is not merged with the dev label",
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

console.log(`\nAll ${tests.length} result-UI presentation tests passed.`);
