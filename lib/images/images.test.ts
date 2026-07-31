/**
 * Focused image-processing tests using small generated fixtures.
 * Run: npx tsx lib/images/images.test.ts
 */

import sharp from "sharp";

import { IMAGE_PROCESSING_CONFIG } from "./config";
import { ArtworkImageProcessingError } from "./errors";
import {
  buildImageProcessingFingerprint,
  isProcessingResultStale,
} from "./fingerprint";
import {
  isSafePlannedFilename,
  normalizeSourceExtension,
} from "./filename-safety";
import {
  generateHrJpegBuffer,
  generateWebJpegBuffer,
  mapSharpFormatToSupported,
  processArtworkImage,
  readArtworkSourceMetadata,
  validateArtworkSourceImage,
} from "./process-impl";

type TestCase = {
  name: string;
  run: () => void | Promise<void>;
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

async function solidPng(
  width: number,
  height: number,
  rgba?: { r: number; g: number; b: number; alpha?: number },
): Promise<Buffer> {
  const { r = 20, g = 40, b = 60, alpha = 1 } = rgba ?? {};
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r, g, b, alpha },
    },
  })
    .png()
    .toBuffer();
}

async function jpegWithOrientation(
  width: number,
  height: number,
  orientation: number,
): Promise<Buffer> {
  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 180, g: 90, b: 40 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();

  return sharp(buffer)
    .withMetadata({ orientation })
    .jpeg({ quality: 90 })
    .toBuffer();
}

const tests: TestCase[] = [
  {
    name: "extension normalization jpeg→jpg and tiff→tif",
    run: () => {
      assertEqual(normalizeSourceExtension("a.JPEG"), ".jpg", "JPEG");
      assertEqual(normalizeSourceExtension("a.jpeg"), ".jpg", "jpeg");
      assertEqual(normalizeSourceExtension("a.jpg"), ".jpg", "jpg");
      assertEqual(normalizeSourceExtension("a.TIFF"), ".tif", "TIFF");
      assertEqual(normalizeSourceExtension("a.tiff"), ".tif", "tiff");
      assertEqual(normalizeSourceExtension("a.tif"), ".tif", "tif");
      assertEqual(normalizeSourceExtension("a.png"), ".png", "png");
    },
  },
  {
    name: "filename safety rejects paths and accepts planned names",
    run: () => {
      assert(
        isSafePlannedFilename("2026_KO_1000_BlueGarden_hr_01.jpg"),
        "valid hr",
      );
      assert(
        isSafePlannedFilename("2026_KO_1000_BlueGarden_web_01.jpg"),
        "valid web",
      );
      assert(
        isSafePlannedFilename("2026_KO_1000_BlueGarden_master_01.tif"),
        "valid master",
      );
      assert(!isSafePlannedFilename("../secret.jpg"), "traversal");
      assert(!isSafePlannedFilename("foo/bar_hr_01.jpg"), "nested path");
      assert(
        !isSafePlannedFilename("2026_KO_1000_BlueGarden_hr_01.exe"),
        "exe",
      );
      assert(!isSafePlannedFilename(""), "empty");
    },
  },
  {
    name: "actual format validation rejects mismatched/non-image bytes",
    run: async () => {
      const fake = Buffer.from("not-an-image-at-all");
      let failed = false;
      try {
        await validateArtworkSourceImage(fake, {
          originalFilename: "scan.tif",
          byteLength: fake.byteLength,
        });
      } catch (error) {
        failed = true;
        assert(error instanceof ArtworkImageProcessingError, "typed error");
      }
      assert(failed, "should reject non-image");

      const png = await solidPng(32, 24);
      const ok = await validateArtworkSourceImage(png, {
        originalFilename: "misnamed.tif",
        byteLength: png.byteLength,
      });
      assertEqual(ok.detectedFormat, "png", "detect png despite .tif name");
      assertEqual(mapSharpFormatToSupported("png"), "png", "map png");
      assertEqual(mapSharpFormatToSupported("gif"), null, "reject gif");
    },
  },
  {
    name: "transparent PNG flattens to white in HR output",
    run: async () => {
      const png = await solidPng(16, 16, { r: 0, g: 0, b: 0, alpha: 0 });
      const { buffer } = await generateHrJpegBuffer(png, true);
      const { data, info } = await sharp(buffer)
        .raw()
        .toBuffer({ resolveWithObject: true });
      assertEqual(info.channels, 3, "no alpha in jpeg");
      assert(
        data[0]! > 250 && data[1]! > 250 && data[2]! > 250,
        "white flatten",
      );
    },
  },
  {
    name: "HR preserves dimensions and never enlarges",
    run: async () => {
      const png = await solidPng(120, 80);
      const { info } = await generateHrJpegBuffer(png, true);
      assertEqual(info.width, 120, "hr width");
      assertEqual(info.height, 80, "hr height");
      assertEqual(info.format, "jpeg", "hr jpeg");
    },
  },
  {
    name: "web long-edge resize to 2400 for landscape",
    run: async () => {
      const png = await solidPng(4800, 2400);
      const result = await generateWebJpegBuffer(png, true, 4800, 2400);
      assert(result.wasResized, "resized");
      assertEqual(result.info.width, 2400, "web width");
      assertEqual(result.info.height, 1200, "web height");
      assertEqual(result.info.format, "jpeg", "web jpeg");
    },
  },
  {
    name: "web long-edge resize for portrait",
    run: async () => {
      const png = await solidPng(1200, 3600);
      const result = await generateWebJpegBuffer(png, true, 1200, 3600);
      assert(result.wasResized, "resized");
      assertEqual(result.info.width, 800, "web width");
      assertEqual(result.info.height, 2400, "web height");
    },
  },
  {
    name: "web does not enlarge small images",
    run: async () => {
      const png = await solidPng(800, 600);
      const result = await generateWebJpegBuffer(png, true, 800, 600);
      assert(!result.wasResized, "not resized");
      assertEqual(result.info.width, 800, "width kept");
      assertEqual(result.info.height, 600, "height kept");
    },
  },
  {
    name: "EXIF orientation is applied for HR output",
    run: async () => {
      const jpeg = await jpegWithOrientation(40, 20, 6);
      const meta = await sharp(jpeg).metadata();
      assertEqual(meta.orientation, 6, "orientation tag present");

      const { info } = await generateHrJpegBuffer(jpeg, false);
      assertEqual(info.width, 20, "oriented width");
      assertEqual(info.height, 40, "oriented height");
    },
  },
  {
    name: "processArtworkImage returns jpeg derivatives and master plan",
    run: async () => {
      const png = await solidPng(100, 50, {
        r: 10,
        g: 200,
        b: 30,
        alpha: 1,
      });
      const result = await processArtworkImage({
        sourceBytes: png,
        originalFilename: "study.png",
        plannedFilenames: {
          master: "2026_KO_1000_Study_master_01.png",
          hr: "2026_KO_1000_Study_hr_01.jpg",
          web: "2026_KO_1000_Study_web_01.jpg",
        },
      });

      assertEqual(result.source.detectedFormat, "png", "format");
      assertEqual(result.hr.format, "jpeg", "hr format");
      assertEqual(result.web.format, "jpeg", "web format");
      assertEqual(
        result.hr.quality,
        IMAGE_PROCESSING_CONFIG.hr.quality,
        "hr q",
      );
      assertEqual(
        result.web.quality,
        IMAGE_PROCESSING_CONFIG.web.quality,
        "web q",
      );
      assertEqual(
        result.master.preservedOriginalBytes,
        true,
        "master preserved",
      );
      assertEqual(result.master.byteLength, png.byteLength, "master bytes");
      assert(
        result.hr.buffer[0] === 0xff && result.hr.buffer[1] === 0xd8,
        "jpeg soi",
      );
    },
  },
  {
    name: "stale-result fingerprint logic",
    run: () => {
      const base = {
        title: "Blue Garden",
        year: "2026",
        previewInventoryId: 1000,
        imageName: "a.jpg",
        imageSize: 1234,
        imageLastModified: 99,
      };
      const fp = buildImageProcessingFingerprint(base);
      assert(!isProcessingResultStale(fp, base), "same not stale");
      assert(
        isProcessingResultStale(fp, { ...base, title: "Other" }),
        "title stale",
      );
      assert(
        isProcessingResultStale(fp, { ...base, year: "2025" }),
        "year stale",
      );
      assert(
        isProcessingResultStale(fp, { ...base, previewInventoryId: 1001 }),
        "inventory stale",
      );
      assert(
        isProcessingResultStale(fp, { ...base, imageName: "b.jpg" }),
        "image stale",
      );
      assert(
        !isProcessingResultStale(fp, base),
        "unchanged fingerprint still fresh (notes excluded)",
      );
    },
  },
  {
    name: "oversized byte length rejected",
    run: async () => {
      const png = await solidPng(8, 8);
      let code: string | null = null;
      try {
        await validateArtworkSourceImage(png, {
          originalFilename: "big.png",
          byteLength: IMAGE_PROCESSING_CONFIG.maxSourceBytes + 1,
        });
      } catch (error) {
        assert(error instanceof ArtworkImageProcessingError, "typed");
        code = error.code;
      }
      assertEqual(code, "FILE_TOO_LARGE", "too large");
    },
  },
  {
    name: "excessive pixel / dimension limits are configured for artwork photography",
    run: () => {
      assert(
        IMAGE_PROCESSING_CONFIG.maxDecodedPixels >= 100_000_000,
        "limit high enough for professional photography",
      );
      assert(
        IMAGE_PROCESSING_CONFIG.maxDecodedPixels <= 500_000_000,
        "limit still bounds decompression bombs",
      );
      assert(
        IMAGE_PROCESSING_CONFIG.maxDimension >= 20_000,
        "max edge allows large masters",
      );
    },
  },
  {
    name: "multi-page TIFF metadata yields page-1 warning",
    run: async () => {
      // Pyramid TIFF reports pages > 1 and is a practical small fixture.
      const tiffBytes = await sharp({
        create: {
          width: 32,
          height: 32,
          channels: 3,
          background: { r: 10, g: 20, b: 30 },
        },
      })
        .tiff({
          pyramid: true,
          tile: true,
          tileWidth: 16,
          tileHeight: 16,
        })
        .toBuffer();

      const meta = await sharp(tiffBytes, { pages: 1, page: 0 }).metadata();
      assert((meta.pages ?? 1) > 1, "fixture reports multiple pages");

      const source = readArtworkSourceMetadata(meta, "tiff", {
        originalFilename: "multi.tif",
        originalByteLength: tiffBytes.byteLength,
      });
      assert(source.isMultiPage, "isMultiPage");

      const result = await processArtworkImage({
        sourceBytes: tiffBytes,
        originalFilename: "multi.tif",
        plannedFilenames: {
          master: "2026_KO_1000_Multi_master_01.tif",
          hr: "2026_KO_1000_Multi_hr_01.jpg",
          web: "2026_KO_1000_Multi_web_01.jpg",
        },
      });

      assert(result.source.isMultiPage, "processed multi");
      assert(
        result.warnings.some((w) => /page 1/i.test(w)),
        "warning mentions page 1",
      );
      assertEqual(
        result.master.byteLength,
        tiffBytes.byteLength,
        "master intact",
      );
    },
  },
];

let failed = 0;

async function main() {
  for (const test of tests) {
    try {
      await test.run();
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

  console.log(`\nAll ${tests.length} image-processing tests passed.`);
}

void main();
