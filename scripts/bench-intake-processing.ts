/**
 * Temporary local benchmark for derivative generation.
 * Compares the naive sequential three-decode path with processArtworkImage.
 */
import sharp from "sharp";

import {
  generateHrJpegBuffer,
  generateThumbJpegBuffer,
  generateWebJpegBuffer,
  processArtworkImage,
} from "../lib/images/process-impl";

function noisyRaw(width: number, height: number): Buffer {
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i += 3) {
    const n = (i * 13 + ((i / 3) | 0) * 7) & 255;
    pixels[i] = n;
    pixels[i + 1] = (n * 3) & 255;
    pixels[i + 2] = (255 - n) & 255;
  }
  return pixels;
}

async function makeJpeg(width: number, height: number): Promise<Buffer> {
  return sharp(noisyRaw(width, height), {
    raw: { width, height, channels: 3 },
  })
    .jpeg({ quality: 92 })
    .toBuffer();
}

async function makeTiff(width: number, height: number): Promise<Buffer> {
  return sharp(noisyRaw(width, height), {
    raw: { width, height, channels: 3 },
  })
    .tiff({ compression: "lzw" })
    .toBuffer();
}

const planned = {
  master: "2026_KO_1000_Bench_master_01.jpg",
  hr: "2026_KO_1000_Bench_hr_01.jpg",
  web: "2026_KO_1000_Bench_web_01.jpg",
  thumb: "2026_KO_1000_Bench_thumb_01.jpg",
};

async function sequentialIndependent(
  sourceBytes: Buffer,
  width: number,
  height: number,
) {
  const t0 = Date.now();
  const hr = await generateHrJpegBuffer(sourceBytes, false);
  const web = await generateWebJpegBuffer(sourceBytes, false, width, height);
  const thumb = await generateThumbJpegBuffer(sourceBytes, false, width, height);
  return {
    strategy: "before_sequential_independent_decode",
    wallMs: Date.now() - t0,
    hrBytes: hr.info.size,
    webBytes: web.info.size,
    thumbBytes: thumb.info.size,
  };
}

async function currentProcess(sourceBytes: Buffer, name: string) {
  const t0 = Date.now();
  const result = await processArtworkImage({
    sourceBytes,
    originalFilename: name,
    plannedFilenames: planned,
  });
  return {
    strategy: "after_decode_once_parallel_encode",
    wallMs: Date.now() - t0,
    hrBytes: result.hr.byteLength,
    webBytes: result.web.byteLength,
    thumbBytes: result.thumb.byteLength,
    timings: result.timings,
  };
}

async function runSuite(
  label: string,
  bytes: Buffer,
  name: string,
  width: number,
  height: number,
) {
  await sequentialIndependent(bytes, width, height);
  const before = await sequentialIndependent(bytes, width, height);
  const after = await currentProcess(bytes, name);
  console.log(JSON.stringify({ label, sourceBytes: bytes.byteLength, before, after }));
}

async function main() {
  const width = 6000;
  const height = 4000;
  const jpeg = await makeJpeg(width, height);
  const tiff = await makeTiff(width, height);
  console.log(
    JSON.stringify({
      fixtures: {
        jpegBytes: jpeg.byteLength,
        tiffBytes: tiff.byteLength,
        dims: `${width}x${height}`,
      },
    }),
  );
  await runSuite("jpeg-24mp", jpeg, "bench.jpg", width, height);
  await runSuite("tiff-lzw-24mp", tiff, "bench.tif", width, height);
}

void main();
