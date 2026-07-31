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
  sourceBytes: Buffer,
  options: ValidateSourceOptions,
): Promise<{
  metadata: SharpMetadata;
  detectedFormat: SupportedArtworkImageFormat;
}> {
  if (!sourceBytes.length) {
    throw new ArtworkImageProcessingError(
      "CORRUPTED_IMAGE",
      "The uploaded file is empty.",
    );
  }

  if (options.byteLength > IMAGE_PROCESSING_CONFIG.maxSourceBytes) {
    throw new ArtworkImageProcessingError(
      "FILE_TOO_LARGE",
      `Source file exceeds the 250 MB limit (${formatBytes(options.byteLength)}).`,
    );
  }

  let metadata: SharpMetadata;
  try {
    metadata = await sharp(sourceBytes, {
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

function createBasePipeline(sourceBytes: Buffer): SharpInstance {
  return sharp(sourceBytes, {
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

export async function generateHrJpegBuffer(
  sourceBytes: Buffer,
  hasAlpha: boolean,
): Promise<{ buffer: Buffer; info: SharpOutputInfo }> {
  const cfg = IMAGE_PROCESSING_CONFIG.hr;
  let pipeline = createBasePipeline(sourceBytes);
  pipeline = applyFlatten(pipeline, hasAlpha);

  const { data, info } = await pipeline
    .jpeg({
      quality: cfg.quality,
      progressive: cfg.progressive,
      mozjpeg: true,
    })
    .toBuffer({ resolveWithObject: true });

  return { buffer: data, info };
}

export async function generateWebJpegBuffer(
  sourceBytes: Buffer,
  hasAlpha: boolean,
  sourceWidth: number,
  sourceHeight: number,
): Promise<{ buffer: Buffer; info: SharpOutputInfo; wasResized: boolean }> {
  const cfg = IMAGE_PROCESSING_CONFIG.web;
  const longEdge = Math.max(sourceWidth, sourceHeight);
  const wasResized = longEdge > cfg.maxLongEdge;

  let pipeline = createBasePipeline(sourceBytes);
  pipeline = applyFlatten(pipeline, hasAlpha);

  pipeline = pipeline.resize({
    width: cfg.maxLongEdge,
    height: cfg.maxLongEdge,
    fit: "inside",
    withoutEnlargement: cfg.neverEnlarge,
    kernel: sharp.kernel.lanczos3,
  });

  if (wasResized) {
    pipeline = pipeline.sharpen(cfg.sharpenWhenResized);
  }

  const { data, info } = await pipeline
    .jpeg({
      quality: cfg.quality,
      progressive: cfg.progressive,
      mozjpeg: true,
    })
    .toBuffer({ resolveWithObject: true });

  return { buffer: data, info, wasResized };
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
  sourceBytes: Buffer;
  originalFilename: string;
  plannedFilenames: PlannedFilenamesInput;
};

/**
 * Process one artwork source image into HR + web JPG buffers.
 * Master bytes are preserved as-is (not rewritten).
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
  const { metadata, detectedFormat } = await validateArtworkSourceImage(
    input.sourceBytes,
    {
      originalFilename: input.originalFilename,
      byteLength: input.sourceBytes.byteLength,
    },
  );

  const source = readArtworkSourceMetadata(metadata, detectedFormat, {
    originalFilename: input.originalFilename,
    originalByteLength: input.sourceBytes.byteLength,
  });

  const warnings: string[] = [];
  if (source.isMultiPage) {
    warnings.push(
      `This TIFF contains ${source.pageCount} pages. Only page 1 was used for HR and web derivatives. The original multi-page file is preserved unchanged as the master.`,
    );
  }

  // Oriented dimensions for resize decisions (rotate() applied in pipelines).
  const oriented = await sharp(input.sourceBytes, {
    failOn: "error",
    pages: 1,
    page: 0,
    limitInputPixels: IMAGE_PROCESSING_CONFIG.maxDecodedPixels,
  })
    .rotate()
    .metadata();

  const orientedWidth = oriented.width ?? source.width;
  const orientedHeight = oriented.height ?? source.height;

  const [hrResult, webResult] = await Promise.all([
    generateHrJpegBuffer(input.sourceBytes, source.hasAlpha),
    generateWebJpegBuffer(
      input.sourceBytes,
      source.hasAlpha,
      orientedWidth,
      orientedHeight,
    ),
  ]);

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

  const masterExt =
    normalizeMasterExtensionForPlan(input.originalFilename) ||
    extensionForFormat(detectedFormat);

  return {
    source,
    master: {
      filename: input.plannedFilenames.master,
      extension: masterExt,
      byteLength: input.sourceBytes.byteLength,
      preservedOriginalBytes: true,
    },
    hr,
    web,
    warnings,
    durationMs: Date.now() - started,
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
