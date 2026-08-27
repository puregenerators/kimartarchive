/**
 * TIFF UI preview thumbnail tests (temporary previews only).
 * Run: npx tsx lib/images/preview.test.ts
 */

import sharp from "sharp";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ArtworkImageThumb } from "@/components/artwork/ArtworkImageThumb";
import {
  clearAllTiffPreviewState,
  clearTiffPreviewState,
  buildSourceFileFingerprint,
  LARGE_MASTER_PREVIEW_UNAVAILABLE_MESSAGE,
  largeMasterPreviewUnavailableMessage,
  resolveTiffPreviewUrl,
  shouldSkipLargeMasterUiPreview,
  shouldSkipTiffUiPreviewUpload,
  TIFF_UI_PREVIEW_MAX_UPLOAD_BYTES,
  VERCEL_FUNCTION_BODY_LIMIT_BYTES,
  tiffUiPreviewSkippedMessage,
  type TiffPreviewState,
} from "./preview-client";
import { IMAGE_PROCESSING_CONFIG } from "./config";
import { createPreviewQueue } from "./preview-queue";
import { generateUiPreviewJpeg } from "./preview";
import {
  appendFilesToBatch,
  reorderArtworks,
  replaceArtworkImage,
} from "@/lib/artwork/batch-files";
import {
  createEmptyBatch,
  createArtworkDraft,
  MAX_FILE_BYTES,
  type ArtworkDraft,
} from "@/lib/artwork/types";
import { validateArtworkDraft, validateBatch, hasBatchErrors } from "@/lib/artwork/validation";
import { batchDraftToSubmissionPayload, validateSubmissionBatchDeclared } from "@/lib/submission/validate-input";
import { buildArtworkInventoryRow } from "@/lib/submission/inventory-row";
import { resolveArtworkMetadata } from "@/lib/submission/claim-logic";
import { ARTWORK_INVENTORY_HEADERS } from "@/lib/google/headers";

type TestCase = {
  name: string;
  run: () => void | Promise<void>;
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

async function solidTiff(
  width: number,
  height: number,
): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 40, g: 80, b: 120 },
    },
  })
    .tiff({ compression: "lzw" })
    .toBuffer();
}

function makeFileFromBuffer(
  name: string,
  buffer: Buffer,
  type = "image/tiff",
): File {
  const copy = Uint8Array.from(buffer);
  return new File([copy], name, {
    type,
    lastModified: 1_700_000_000_000,
  });
}

function makeOversizedTiff(name: string, size = MAX_FILE_BYTES + 314_573): File {
  const buffer = Buffer.from("II*\u0000");
  const file = new File([buffer], name, {
    type: "image/tiff",
    lastModified: 1_700_000_000_000,
  });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

const tests: TestCase[] = [
  {
    name: "TIFF generates a JPEG thumbnail within 600×600",
    run: async () => {
      const tiff = await solidTiff(1200, 800);
      const result = await generateUiPreviewJpeg(tiff, "wide.tif");
      assertEqual(result.format, "jpeg", "format");
      assert(result.width <= 600, `width ${result.width} <= 600`);
      assert(result.height <= 600, `height ${result.height} <= 600`);
      assert(result.wasResized, "should resize down");
      assertEqual(result.quality, IMAGE_PROCESSING_CONFIG.preview.quality, "quality");
      const meta = await sharp(result.buffer).metadata();
      assertEqual(meta.format, "jpeg", "output is jpeg");
    },
  },
  {
    name: "preview does not enlarge small TIFFs",
    run: async () => {
      const tiff = await solidTiff(120, 80);
      const result = await generateUiPreviewJpeg(tiff, "tiny.tif");
      assertEqual(result.width, 120, "width preserved");
      assertEqual(result.height, 80, "height preserved");
      assertEqual(result.wasResized, false, "not resized");
    },
  },
  {
    name: "portrait and landscape TIFFs preserve aspect ratio",
    run: async () => {
      const landscape = await generateUiPreviewJpeg(
        await solidTiff(900, 300),
        "landscape.tif",
      );
      const portrait = await generateUiPreviewJpeg(
        await solidTiff(300, 900),
        "portrait.tif",
      );

      assert(landscape.width === 600, `landscape width ${landscape.width}`);
      assert(
        Math.abs(landscape.height - 200) <= 1,
        `landscape height ~200 got ${landscape.height}`,
      );
      assert(portrait.height === 600, `portrait height ${portrait.height}`);
      assert(
        Math.abs(portrait.width - 200) <= 1,
        `portrait width ~200 got ${portrait.width}`,
      );
    },
  },
  {
    name: "multi-page TIFF uses page 1 and reports isMultiPage",
    run: async () => {
      // Pyramid TIFF is a practical small multi-page fixture.
      const tiff = await sharp({
        create: {
          width: 128,
          height: 96,
          channels: 3,
          background: { r: 10, g: 20, b: 30 },
        },
      })
        .tiff({
          compression: "lzw",
          pyramid: true,
          tile: true,
          tileWidth: 64,
          tileHeight: 64,
        })
        .toBuffer();

      const result = await generateUiPreviewJpeg(tiff, "multi.tif");
      assert(result.source.isMultiPage, "isMultiPage");
      assert(
        (result.source.pageCount ?? 0) > 1,
        `pageCount > 1 got ${result.source.pageCount}`,
      );
      assert(result.width > 0 && result.height > 0, "page 1 dimensions");
      assert(result.width <= 600 && result.height <= 600, "within bounds");
    },
  },
  {
    name: "preview failure falls back to placeholder state helpers",
    run: () => {
      const fingerprint = buildSourceFileFingerprint({
        imageName: "a.tif",
        imageSize: 10,
        imageLastModified: 1,
      });
      const errorState: TiffPreviewState = {
        status: "error",
        fingerprint,
        message: "Preview unavailable. The original TIFF can still be processed.",
      };
      assertEqual(
        resolveTiffPreviewUrl(errorState, fingerprint),
        null,
        "no url on error",
      );
    },
  },
  {
    name: "TIFFs over the Vercel preview body limit skip the preview upload",
    run: () => {
      assertEqual(
        shouldSkipTiffUiPreviewUpload(TIFF_UI_PREVIEW_MAX_UPLOAD_BYTES),
        false,
        "4 MB still attempted",
      );
      assertEqual(
        shouldSkipTiffUiPreviewUpload(TIFF_UI_PREVIEW_MAX_UPLOAD_BYTES + 1),
        true,
        "over 4 MB skipped",
      );
      assertEqual(
        shouldSkipTiffUiPreviewUpload(VERCEL_FUNCTION_BODY_LIMIT_BYTES + 1),
        true,
        "over 4.5 MB skipped",
      );
      const message = tiffUiPreviewSkippedMessage("HarmonyInRed.tif");
      assert(message.includes("HarmonyInRed.tif"), "filename in skip message");
      assert(message.includes("TIFF"), "type in skip message");
      assert(
        message.toLowerCase().includes("intake can continue"),
        "intake continues",
      );
    },
  },
  {
    name: "oversized TIFF with no preview remains eligible for large-file intake",
    run: () => {
      const size = MAX_FILE_BYTES + 314_573;
      assertEqual(shouldSkipLargeMasterUiPreview(MAX_FILE_BYTES), false, "at cap");
      assertEqual(shouldSkipLargeMasterUiPreview(size), true, "over cap");
      assertEqual(
        shouldSkipTiffUiPreviewUpload(size),
        true,
        "does not POST /api/image-preview",
      );
      assertEqual(
        largeMasterPreviewUnavailableMessage(),
        LARGE_MASTER_PREVIEW_UNAVAILABLE_MESSAGE,
        "preview copy",
      );

      const file = makeOversizedTiff("Vauxs Swift Watch 44X84.tif", size);
      const result = appendFilesToBatch(createEmptyBatch(), [file], {
        createPreviewUrls: true,
      });
      assertEqual(result.added.length, 1, "kept in batch");
      assertEqual(result.rejected.length, 0, "not rejected");
      const artwork = result.added[0]!;
      artwork.title = "Vaux's Swift Watch";
      artwork.year = "2017";
      artwork.medium = "Monotype";
      assertEqual(artwork.image?.previewUrl, null, "no browser preview url");
      assertEqual(artwork.image?.isTiff, true, "tiff");

      const errors = validateArtworkDraft(artwork);
      assertEqual(errors.image, undefined, "preview skip is not a validation error");
      const batchErrors = validateBatch(result.batch);
      assertEqual(
        batchErrors.artworks[artwork.id]?.image,
        undefined,
        "batch image field ok",
      );
      assertEqual(hasBatchErrors(batchErrors), false, "batch eligible to review");

      const fingerprint = buildSourceFileFingerprint({
        imageName: file.name,
        imageSize: file.size,
        imageLastModified: file.lastModified,
      });
      const markup = renderToStaticMarkup(
        createElement(ArtworkImageThumb, {
          image: artwork.image,
          tiffPreview: {
            status: "error",
            fingerprint,
            message: LARGE_MASTER_PREVIEW_UNAVAILABLE_MESSAGE,
          },
        }),
      );
      assert(markup.includes("Vauxs Swift Watch 44X84.tif"), "filename placeholder");
      assert(markup.includes("TIFF"), "type placeholder");
      assert(
        !markup.includes("could not be decoded"),
        "placeholder is not a decode failure",
      );

      const payload = batchDraftToSubmissionPayload({
        shared: result.batch.shared,
        artworks: [artwork],
      });
      const declared = validateSubmissionBatchDeclared({
        submissionAttemptId: "attempt-large-tiff",
        shared: payload.shared,
        artworks: payload.artworks,
        files: [
          {
            clientArtworkId: artwork.id,
            filename: file.name,
            mimeType: file.type,
            byteLength: file.size,
          },
        ],
      });
      assertEqual(declared.ok, true, "prepare validation accepts oversized TIFF");
    },
  },
  {
    name: "large TIFF preview skip shows filename/type placeholder and does not block intake",
    run: () => {
      const file = makeFileFromBuffer(
        "HarmonyInRed.tif",
        Buffer.from([0, 1, 2, 3]),
      );
      const image = {
        file,
        previewUrl: null,
        isTiff: true,
      };
      const fingerprint = buildSourceFileFingerprint({
        imageName: file.name,
        imageSize: file.size,
        imageLastModified: file.lastModified,
      });
      const markup = renderToStaticMarkup(
        createElement(ArtworkImageThumb, {
          image,
          tiffPreview: {
            status: "error",
            fingerprint,
            message: tiffUiPreviewSkippedMessage(file.name),
          },
        }),
      );
      assert(markup.includes("HarmonyInRed.tif"), "filename placeholder");
      assert(markup.includes("TIFF"), "type placeholder");
      assert(markup.includes("Intake can continue"), "continue copy");

      const draft = createArtworkDraft(
        {
          exhibition: "",
          gallery: "",
          exhibitionYear: "",
          defaultArtworkYear: "2021",
          photographer: "",
          defaultMedium: "Monotype",
          defaultDimensionUnit: "in",
        },
        {
          title: "Harmony in Red",
          year: "2021",
          medium: "Monotype",
          image,
        },
      );
      const errors = validateArtworkDraft(draft);
      assertEqual(
        errors.image,
        undefined,
        "preview skip does not fail validation",
      );
    },
  },
  {
    name: "replacing a file invalidates the prior thumbnail association",
    run: () => {
      const draft = createArtworkDraft(
        {
          exhibition: "",
          gallery: "",
          exhibitionYear: "",
          defaultArtworkYear: "2026",
          photographer: "",
          defaultMedium: "Monotype",
          defaultDimensionUnit: "in",
        },
        {
          image: {
            file: makeFileFromBuffer("old.tif", Buffer.from([0, 1, 2, 3])),
            previewUrl: null,
            isTiff: true,
          },
        },
      );

      const oldFp = buildSourceFileFingerprint({
        imageName: draft.image!.file.name,
        imageSize: draft.image!.file.size,
        imageLastModified: draft.image!.file.lastModified,
      });

      let previews: Record<string, TiffPreviewState> = {
        [draft.id]: {
          status: "ready",
          fingerprint: oldFp,
          resultId: "11111111-1111-4111-8111-111111111111",
          previewUrl: "/api/image-preview/11111111-1111-4111-8111-111111111111",
          expiresAt: Date.now() + 60_000,
          isMultiPage: false,
          pageCount: 1,
        },
      };

      const replaced = replaceArtworkImage(
        draft,
        makeFileFromBuffer("new.tif", Buffer.from([9, 9, 9]), "image/tiff"),
        { createPreviewUrl: false },
      );
      assert(replaced.ok, "replace ok");

      previews = clearTiffPreviewState(previews, draft.id);
      assert(!(draft.id in previews), "preview cleared after replace");

      const newFp = buildSourceFileFingerprint({
        imageName: replaced.artwork.image!.file.name,
        imageSize: replaced.artwork.image!.file.size,
        imageLastModified: replaced.artwork.image!.file.lastModified,
      });
      assert(oldFp !== newFp, "fingerprint changed");
    },
  },
  {
    name: "reordering preserves thumbnail association by artwork id",
    run: () => {
      const a = createArtworkDraft(
        {
          exhibition: "",
          gallery: "",
          exhibitionYear: "",
          defaultArtworkYear: "2026",
          photographer: "",
          defaultMedium: "Monotype",
          defaultDimensionUnit: "in",
        },
        {
          image: {
            file: makeFileFromBuffer("a.tif", Buffer.from([1])),
            previewUrl: null,
            isTiff: true,
          },
        },
      );
      const b = createArtworkDraft(
        {
          exhibition: "",
          gallery: "",
          exhibitionYear: "",
          defaultArtworkYear: "2026",
          photographer: "",
          defaultMedium: "Monotype",
          defaultDimensionUnit: "in",
        },
        {
          image: {
            file: makeFileFromBuffer("b.tif", Buffer.from([2])),
            previewUrl: null,
            isTiff: true,
          },
        },
      );

      const previews: Record<string, TiffPreviewState> = {
        [a.id]: {
          status: "ready",
          fingerprint: "a",
          resultId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          previewUrl: "/api/image-preview/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          expiresAt: Date.now() + 60_000,
          isMultiPage: false,
          pageCount: 1,
        },
        [b.id]: {
          status: "ready",
          fingerprint: "b",
          resultId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          previewUrl: "/api/image-preview/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          expiresAt: Date.now() + 60_000,
          isMultiPage: false,
          pageCount: 1,
        },
      };

      const reordered = reorderArtworks([a, b], a.id, 1);
      assertEqual(reordered[0].id, b.id, "b first");
      assertEqual(reordered[1].id, a.id, "a second");
      assertEqual(
        previews[a.id]?.previewUrl,
        "/api/image-preview/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "a preview preserved",
      );
      assertEqual(
        previews[b.id]?.previewUrl,
        "/api/image-preview/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "b preview preserved",
      );
    },
  },
  {
    name: "batch reset clears preview state",
    run: () => {
      const previews: Record<string, TiffPreviewState> = {
        "id-1": {
          status: "ready",
          fingerprint: "x",
          resultId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          previewUrl: "/api/image-preview/cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          expiresAt: Date.now() + 60_000,
          isMultiPage: false,
          pageCount: 1,
        },
      };
      const cleared = clearAllTiffPreviewState(previews);
      assertEqual(Object.keys(cleared).length, 0, "empty after reset");
    },
  },
  {
    name: "preview queue limits concurrency to 2",
    run: async () => {
      let maxActive = 0;
      let active = 0;
      const started: string[] = [];
      const finished: string[] = [];

      const queue = createPreviewQueue<{ label: string }>({
        concurrency: IMAGE_PROCESSING_CONFIG.preview.concurrency,
        async run(job) {
          active += 1;
          maxActive = Math.max(maxActive, active);
          started.push(job.id);
          await new Promise((resolve) => setTimeout(resolve, 30));
          active -= 1;
          finished.push(job.id);
        },
      });

      for (let i = 0; i < 5; i += 1) {
        queue.enqueue({ id: `job-${i}`, payload: { label: `j${i}` } });
      }

      assertEqual(
        IMAGE_PROCESSING_CONFIG.preview.concurrency,
        2,
        "config concurrency",
      );
      assert(queue.activeCount() <= 2, "active <= 2 immediately");
      assert(queue.queuedCount() >= 3, "remaining queued");

      await new Promise((resolve) => setTimeout(resolve, 250));
      assertEqual(finished.length, 5, "all finished");
      assert(maxActive <= 2, `maxActive ${maxActive} <= 2`);
      assertEqual(started.length, 5, "all started");
    },
  },
  {
    name: "failed queue job does not block later jobs",
    run: async () => {
      const finished: string[] = [];
      const queue = createPreviewQueue<{ fail: boolean }>({
        concurrency: 1,
        async run(job) {
          if (job.payload.fail) throw new Error("boom");
          finished.push(job.id);
        },
      });
      queue.enqueue({ id: "fail", payload: { fail: true } });
      queue.enqueue({ id: "ok", payload: { fail: false } });
      await new Promise((resolve) => setTimeout(resolve, 50));
      assertEqual(finished.join(","), "ok", "ok ran after failure");
    },
  },
  {
    name: "thumbnail output is never included in submission payloads or Sheet rows",
    run: () => {
      const batch = createEmptyBatch();
      batch.shared = {
        exhibition: "Show",
        gallery: "Gallery",
        exhibitionYear: "2026",
        defaultArtworkYear: "2026",
        photographer: "Kim",
        defaultMedium: "Monotype",
        defaultDimensionUnit: "in",
      };

      const file = makeFileFromBuffer("piece.tif", Buffer.from([1, 2, 3, 4]));
      const appended = appendFilesToBatch(batch, [file], {
        createPreviewUrls: false,
      });
      const artwork = appended.added[0] as ArtworkDraft;
      artwork.title = "Piece";
      artwork.year = "2026";
      artwork.medium = "Monotype";
      artwork.height = "10";
      artwork.width = "8";

      // Simulate a ready TIFF preview hanging off client state only.
      const previewState: TiffPreviewState = {
        status: "ready",
        fingerprint: "x",
        resultId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        previewUrl: "/api/image-preview/dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        expiresAt: Date.now() + 60_000,
        isMultiPage: false,
        pageCount: 1,
      };

      const payload = batchDraftToSubmissionPayload({
        shared: batch.shared,
        artworks: [artwork],
      });
      const payloadJson = JSON.stringify(payload);
      assert(
        !payloadJson.includes("image-preview"),
        "payload has no preview url",
      );
      assert(
        !payloadJson.includes(previewState.resultId),
        "payload has no result id",
      );
      assert(
        !payloadJson.includes("previewUrl"),
        "payload has no previewUrl field",
      );

      const metadata = resolveArtworkMetadata(payload.artworks[0]!, {
        exhibition: "Show",
        gallery: "Gallery",
        photographer: "Kim",
      });
      const row = buildArtworkInventoryRow({
        inventoryId: 1000,
        metadata,
        links: {
          masterFilename: "2026_KO_1000_Piece_master_01.tif",
          masterFileUrl: "https://example.com/m",
          hrFilename: "2026_KO_1000_Piece_hr_01.jpg",
          hrFileUrl: "https://example.com/h",
          webFilename: "2026_KO_1000_Piece_web_01.jpg",
          webFileUrl: "https://example.com/w",
          artworkFolderUrl: "https://example.com/folder",
        },
        thumbnailFormula:
          '=IMAGE("https://dl.dropboxusercontent.com/scl/fi/thumb.jpg?rlkey=k&raw=1", 1)',
        createdAt: "2026-08-03T12:00:00.000Z",
      });
      const rowText = row.join("|");
      assert(
        !rowText.includes("image-preview"),
        "sheet row has no preview url",
      );
      assert(
        !rowText.includes(previewState.resultId),
        "sheet row has no preview result id",
      );
      assertEqual(row.length, ARTWORK_INVENTORY_HEADERS.length, "schema width");
    },
  },
];

async function main() {
  let passed = 0;
  for (const test of tests) {
    try {
      await test.run();
      passed += 1;
      console.log(`ok - ${test.name}`);
    } catch (error) {
      console.error(`fail - ${test.name}`);
      console.error(error);
      process.exitCode = 1;
      return;
    }
  }
  console.log(`\n${passed}/${tests.length} preview tests passed`);
}

void main();
