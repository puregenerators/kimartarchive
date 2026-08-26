import sharp from "sharp";

import { IMAGE_PROCESSING_CONFIG } from "@/lib/images/config";
import {
  ArtworkImageProcessingError,
  mapImageProcessingError,
} from "@/lib/images/errors";
import { normalizeSourceExtension } from "@/lib/images/filename-safety";
import type {
  ArtworkImageProcessingResult,
  ArtworkSourceMetadata,
  PlannedFilenamesInput,
  ProcessedImageOutput,
  SupportedArtworkImageFormat,
} from "@/lib/images/types";

type LongEdgeJpegConfig = {
  quality: number;
  progressive: boolean;
  maxLongEdge: number;
  neverEnlarge: true;
  sharpenWhenResized: { sigma: number; m1: number; m2: number };
};

type SharpInstance = ReturnType<typeof sharp>;
type SharpMetadata = Awaited<ReturnType<SharpInstance["metadata"]>>;

type SharpOutputInfo = {
  format: string;
  size: number;
  width: number;
  height: number;
  channels: number;
};

const FORMAT_BY_SHARP: Record<string, SupportedArtworkImageFormat | undefined> = {
  jpeg: "jpeg",
  jpg: "jpeg",
  png: "png",
  tiff: "tiff",
  tif: "tiff",
};

export function normalizeMasterExtensionForPlan(filename: string): string {
  return normalizeSourceExtension(filename);
}

export function mapSharpFormatToSupported(
  format: string | undefined,
): SupportedArtworkImageFormat | null {
  if (!format) return null;
  return FORMAT_BY_SHARP[format.toLowerCase()] ?? null;
}

export type ValidateSourceOptions = {
  originalFilename: string;
  byteLength: number;
};

/**
 * Validate byte length and that Sharp can identify a supported format.
 * Does not trust the filename extension alone.
 */
export async function validateArtworkSourceImage(
  source: ArtworkImageSource,
  options: ValidateSourceOptions,
): Promise<{
  metadata: SharpMetadata;
  detectedFormat: SupportedArtworkImageFormat;
}> {
  const isPath = typeof source === "string";
  if (!isPath && !source.length) {
    throw new ArtworkImageProcessingError(
      "CORRUPTED_IMAGE",
      "The uploaded file is empty.",
    );
  }

  if (options.byteLength > IMAGE_PROCESSING_CONFIG.maxSourceBytes) {
    throw new ArtworkImageProcessingError(
      "FILE_TOO_LARGE",
      `Source file exceeds the 150 MB limit (${formatBytes(options.byteLength)}).`,
    );
  }

  let metadata: SharpMetadata;
  try {
    metadata = await sharp(source, {
      failOn: "error",
      // Only ever read page 0 for multi-page TIFF masters in this milestone.
      pages: 1,
      page: 0,
      limitInputPixels: IMAGE_PROCESSING_CONFIG.maxDecodedPixels,
    }).metadata();
  } catch (error) {
    throw mapImageProcessingError(error);
  }

  const detectedFormat = mapSharpFormatToSupported(metadata.format);
  if (!detectedFormat) {
    throw new ArtworkImageProcessingError(
      "UNSUPPORTED_FORMAT",
      `Unsupported image format${metadata.format ? ` (${metadata.format})` : ""}. Use TIFF, JPEG, or PNG.`,
    );
  }

  if (!metadata.width || !metadata.height) {
    throw new ArtworkImageProcessingError(
      "MISSING_DIMENSIONS",
      "Could not determine image dimensions.",
    );
  }

  if (
    metadata.width > IMAGE_PROCESSING_CONFIG.maxDimension ||
    metadata.height > IMAGE_PROCESSING_CONFIG.maxDimension
  ) {
    throw new ArtworkImageProcessingError(
      "UNREASONABLE_DIMENSIONS",
      `Image dimensions ${metadata.width}×${metadata.height} exceed the maximum allowed edge of ${IMAGE_PROCESSING_CONFIG.maxDimension}px.`,
    );
  }

  const pixelCount = metadata.width * metadata.height;
  if (pixelCount > IMAGE_PROCESSING_CONFIG.maxDecodedPixels) {
    throw new ArtworkImageProcessingError(
      "EXCESSIVE_PIXELS",
      `Image has ${pixelCount.toLocaleString()} pixels, which exceeds the safe decode limit of ${IMAGE_PROCESSING_CONFIG.maxDecodedPixels.toLocaleString()}.`,
    );
  }

  return { metadata, detectedFormat };
}

export function readArtworkSourceMetadata(
  metadata: SharpMetadata,
  detectedFormat: SupportedArtworkImageFormat,
  options: {
    originalFilename: string;
    originalByteLength: number;
  },
): ArtworkSourceMetadata {
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const pageCount =
    typeof metadata.pages === "number" && metadata.pages > 0
      ? metadata.pages
      : detectedFormat === "tiff"
        ? 1
        : null;
  const isMultiPage = Boolean(pageCount && pageCount > 1);

  return {
    originalFilename: options.originalFilename,
    detectedFormat,
    width,
    height,
    pixelCount: width * height,
    colourspace: metadata.space ?? null,
    channels: metadata.channels ?? null,
    hasAlpha: Boolean(metadata.hasAlpha),
    orientation: metadata.orientation ?? null,
    density: metadata.density ?? null,
    hasIccProfile: Boolean(metadata.icc && metadata.icc.length > 0),
    originalByteLength: options.originalByteLength,
    pageCount,
    isMultiPage,
  };
}

/**
 * Pixel size after applying EXIF orientation tags 5–8 (axis swap).
 * Matches Sharp `rotate()` with no angle, without opening the source again.
 */
export function orientedPixelSize(
  width: number,
  height: number,
  orientation: number | null | undefined,
): { width: number; height: number } {
  const tag = orientation ?? 1;
  if (tag >= 5 && tag <= 8) {
    return { width: height, height: width };
  }
  return { width, height };
}

export type ArtworkImageSource = Buffer | string;

function createBasePipeline(source: ArtworkImageSource): SharpInstance {
  return sharp(source, {
    failOn: "error",
    pages: 1,
    page: 0,
    limitInputPixels: IMAGE_PROCESSING_CONFIG.maxDecodedPixels,
  })
    .rotate() // apply EXIF orientation
    .toColourspace(IMAGE_PROCESSING_CONFIG.hr.colourspace)
    .withIccProfile("srgb");
}

function applyFlatten(pipeline: SharpInstance, hasAlpha: boolean): SharpInstance {
  if (!hasAlpha) return pipeline;
  return pipeline.flatten({
    background: IMAGE_PROCESSING_CONFIG.hr.flattenBackground,
  });
}

function createSharedSourcePipeline(
  source: ArtworkImageSource,
  hasAlpha: boolean,
): SharpInstance {
  return applyFlatten(createBasePipeline(source), hasAlpha);
}

type SharpChannels = 1 | 2 | 3 | 4;

type DecodedSourcePixels = {
  data: Buffer;
  width: number;
  height: number;
  channels: SharpChannels;
};

/**
 * Decode the master once (EXIF rotate, sRGB, flatten) into raw pixels.
 * Sharp `.clone()` shares the compressed input, but each pipeline still
 * decodes independently — materializing raw pixels is the reuse Sharp allows.
 */
async function decodeSourcePixels(
  source: ArtworkImageSource,
  hasAlpha: boolean,
): Promise<DecodedSourcePixels> {
  const { data, info } = await createSharedSourcePipeline(
    source,
    hasAlpha,
  )
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (!info.width || !info.height || !info.channels) {
    throw new ArtworkImageProcessingError(
      "MISSING_DIMENSIONS",
      "Could not determine image dimensions after decoding.",
    );
  }
  if (
    info.channels !== 1 &&
    info.channels !== 2 &&
    info.channels !== 3 &&
    info.channels !== 4
  ) {
    throw new ArtworkImageProcessingError(
      "SHARP_DECODE_FAILURE",
      "Could not decode source image pixels.",
    );
  }

  return {
    data,
    width: info.width,
    height: info.height,
    channels: info.channels,
  };
}

function pipelineFromDecodedPixels(decoded: DecodedSourcePixels): SharpInstance {
  return sharp(decoded.data, {
    raw: {
      width: decoded.width,
      height: decoded.height,
      channels: decoded.channels,
    },
    limitInputPixels: IMAGE_PROCESSING_CONFIG.maxDecodedPixels,
  }).withIccProfile("srgb");
}

async function encodeHrJpeg(
  pipeline: SharpInstance,
): Promise<{ buffer: Buffer; info: SharpOutputInfo }> {
  const cfg = IMAGE_PROCESSING_CONFIG.hr;
  const { data, info } = await pipeline
    .jpeg({
      quality: cfg.quality,
      progressive: cfg.progressive,
      mozjpeg: true,
    })
    .toBuffer({ resolveWithObject: true });
  return { buffer: data, info };
}

async function encodeLongEdgeJpeg(
  pipeline: SharpInstance,
  cfg: LongEdgeJpegConfig,
  sourceWidth: number,
  sourceHeight: number,
): Promise<{ buffer: Buffer; info: SharpOutputInfo; wasResized: boolean }> {
  const longEdge = Math.max(sourceWidth, sourceHeight);
  const wasResized = longEdge > cfg.maxLongEdge;

  let next = pipeline.resize({
    width: cfg.maxLongEdge,
    height: cfg.maxLongEdge,
    fit: "inside",
    withoutEnlargement: cfg.neverEnlarge,
    kernel: sharp.kernel.lanczos3,
  });

  if (wasResized) {
    next = next.sharpen(cfg.sharpenWhenResized);
  }

  const { data, info } = await next
    .jpeg({
      quality: cfg.quality,
      progressive: cfg.progressive,
      mozjpeg: true,
    })
    .toBuffer({ resolveWithObject: true });

  return { buffer: data, info, wasResized };
}

async function timed<T>(work: Promise<T>): Promise<{ value: T; ms: number }> {
  const started = Date.now();
  const value = await work;
  return { value, ms: Date.now() - started };
}

export async function generateHrJpegBuffer(
  sourceBytes: Buffer,
  hasAlpha: boolean,
): Promise<{ buffer: Buffer; info: SharpOutputInfo }> {
  return encodeHrJpeg(createSharedSourcePipeline(sourceBytes, hasAlpha));
}

export async function generateWebJpegBuffer(
  sourceBytes: Buffer,
  hasAlpha: boolean,
  sourceWidth: number,
  sourceHeight: number,
): Promise<{ buffer: Buffer; info: SharpOutputInfo; wasResized: boolean }> {
  return encodeLongEdgeJpeg(
    createSharedSourcePipeline(sourceBytes, hasAlpha),
    IMAGE_PROCESSING_CONFIG.web,
    sourceWidth,
    sourceHeight,
  );
}

export async function generateThumbJpegBuffer(
  sourceBytes: Buffer,
  hasAlpha: boolean,
  sourceWidth: number,
  sourceHeight: number,
): Promise<{ buffer: Buffer; info: SharpOutputInfo; wasResized: boolean }> {
  return encodeLongEdgeJpeg(
    createSharedSourcePipeline(sourceBytes, hasAlpha),
    IMAGE_PROCESSING_CONFIG.thumb,
    sourceWidth,
    sourceHeight,
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new ArtworkImageProcessingError(
          "PROCESSING_TIMEOUT",
          "Image processing timed out. Try a smaller file or process again.",
        ),
      );
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export type ProcessArtworkImageInput = {
  sourceBytes?: Buffer;
  /** File-backed master path. Preferred in production so Sharp can read from disk. */
  sourcePath?: string;
  /** Declared or stat'd byte length when `sourcePath` is used. */
  sourceByteLength?: number;
  originalFilename: string;
  plannedFilenames: PlannedFilenamesInput;
};

function resolveArtworkImageSource(
  input: ProcessArtworkImageInput,
): { source: ArtworkImageSource; byteLength: number } {
  if (input.sourcePath) {
    return {
      source: input.sourcePath,
      byteLength: input.sourceByteLength ?? input.sourceBytes?.byteLength ?? 0,
    };
  }
  if (input.sourceBytes) {
    return {
      source: input.sourceBytes,
      byteLength: input.sourceBytes.byteLength,
    };
  }
  throw new ArtworkImageProcessingError(
    "CORRUPTED_IMAGE",
    "The uploaded file is empty.",
  );
}

/**
 * Process one artwork source image into HR, web, and thumbnail JPG buffers.
 * Master bytes are preserved as-is (not rewritten).
 * HR, web, and thumbnail are encoded sequentially from one decoded buffer.
 */
export async function processArtworkImage(
  input: ProcessArtworkImageInput,
): Promise<ArtworkImageProcessingResult> {
  const started = Date.now();

  try {
    return await withTimeout(
      processArtworkImageInner(input, started),
      IMAGE_PROCESSING_CONFIG.processingTimeoutMs,
    );
  } catch (error) {
    throw mapImageProcessingError(error);
  }
}

async function processArtworkImageInner(
  input: ProcessArtworkImageInput,
  started: number,
): Promise<ArtworkImageProcessingResult> {
  const readStarted = Date.now();
  const resolved = resolveArtworkImageSource(input);
  const byteLength =
    resolved.byteLength > 0
      ? resolved.byteLength
      : Buffer.isBuffer(resolved.source)
        ? resolved.source.byteLength
        : 0;

  if (typeof resolved.source === "string" && byteLength <= 0) {
    throw new ArtworkImageProcessingError(
      "CORRUPTED_IMAGE",
      "The uploaded file is empty.",
    );
  }

  const { metadata, detectedFormat } = await validateArtworkSourceImage(
    resolved.source,
    {
      originalFilename: input.originalFilename,
      byteLength,
    },
  );

  const source = readArtworkSourceMetadata(metadata, detectedFormat, {
    originalFilename: input.originalFilename,
    originalByteLength: byteLength,
  });

  const warnings: string[] = [];
  if (source.isMultiPage) {
    warnings.push(
      `This TIFF contains ${source.pageCount} pages. Only page 1 was used for HR, web, and thumbnail derivatives. The original multi-page file is preserved unchanged as the master.`,
    );
  }

  const decoded = await decodeSourcePixels(
    resolved.source,
    source.hasAlpha,
  );
  const masterReadDecodeMs = Date.now() - readStarted;

  const derivativesStarted = Date.now();
  let hrTimed: { value: Awaited<ReturnType<typeof encodeHrJpeg>>; ms: number };
  let webTimed: {
    value: Awaited<ReturnType<typeof encodeLongEdgeJpeg>>;
    ms: number;
  };
  let thumbTimed: {
    value: Awaited<ReturnType<typeof encodeLongEdgeJpeg>>;
    ms: number;
  };
  try {
    hrTimed = await timed(encodeHrJpeg(pipelineFromDecodedPixels(decoded)));
    webTimed = await timed(
      encodeLongEdgeJpeg(
        pipelineFromDecodedPixels(decoded),
        IMAGE_PROCESSING_CONFIG.web,
        decoded.width,
        decoded.height,
      ),
    );
    try {
      thumbTimed = await timed(
        encodeLongEdgeJpeg(
          pipelineFromDecodedPixels(decoded),
          IMAGE_PROCESSING_CONFIG.thumb,
          decoded.width,
          decoded.height,
        ),
      );
    } catch (error) {
      const mapped = mapImageProcessingError(error);
      throw new ArtworkImageProcessingError(
        "THUMBNAIL_GENERATION_FAILED",
        mapped.message,
      );
    }
  } catch (error) {
    throw mapImageProcessingError(error);
  }
  const derivativesWallMs = Date.now() - derivativesStarted;
  const hrResult = hrTimed.value;
  const webResult = webTimed.value;
  const thumbResult = thumbTimed.value;

  const hr: ProcessedImageOutput & { buffer: Buffer } = {
    filename: input.plannedFilenames.hr,
    width: hrResult.info.width,
    height: hrResult.info.height,
    byteLength: hrResult.info.size,
    format: "jpeg",
    quality: IMAGE_PROCESSING_CONFIG.hr.quality,
    wasResized: false,
    buffer: hrResult.buffer,
  };

  const web: ProcessedImageOutput & { buffer: Buffer } = {
    filename: input.plannedFilenames.web,
    width: webResult.info.width,
    height: webResult.info.height,
    byteLength: webResult.info.size,
    format: "jpeg",
    quality: IMAGE_PROCESSING_CONFIG.web.quality,
    wasResized: webResult.wasResized,
    buffer: webResult.buffer,
  };

  const thumb: ProcessedImageOutput & { buffer: Buffer } = {
    filename: input.plannedFilenames.thumb,
    width: thumbResult.info.width,
    height: thumbResult.info.height,
    byteLength: thumbResult.info.size,
    format: "jpeg",
    quality: IMAGE_PROCESSING_CONFIG.thumb.quality,
    wasResized: thumbResult.wasResized,
    buffer: thumbResult.buffer,
  };

  const masterExt =
    normalizeMasterExtensionForPlan(input.originalFilename) ||
    extensionForFormat(detectedFormat);

  return {
    source,
    master: {
      filename: input.plannedFilenames.master,
      extension: masterExt,
      byteLength,
      preservedOriginalBytes: true,
    },
    hr,
    web,
    thumb,
    warnings,
    durationMs: Date.now() - started,
    timings: {
      masterReadDecodeMs,
      hrGenerationMs: hrTimed.ms,
      webGenerationMs: webTimed.ms,
      thumbnailGenerationMs: thumbTimed.ms,
      derivativesWallMs,
    },
  };
}

function extensionForFormat(format: SupportedArtworkImageFormat): string {
  if (format === "jpeg") return ".jpg";
  if (format === "png") return ".png";
  return ".tif";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
