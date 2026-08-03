import sharp from "sharp";

import { IMAGE_PROCESSING_CONFIG } from "@/lib/images/config";
import { mapImageProcessingError } from "@/lib/images/errors";
import {
  readArtworkSourceMetadata,
  validateArtworkSourceImage,
} from "@/lib/images/process-impl";
import type { ArtworkSourceMetadata } from "@/lib/images/types";

export type UiPreviewJpegResult = {
  buffer: Buffer;
  width: number;
  height: number;
  byteLength: number;
  format: "jpeg";
  quality: number;
  wasResized: boolean;
  source: ArtworkSourceMetadata;
  durationMs: number;
};

/**
 * Generate a temporary UI-only JPEG thumbnail.
 * Uses page 1 only for multi-page TIFFs. Does not alter the source master.
 */
export async function generateUiPreviewJpeg(
  sourceBytes: Buffer,
  originalFilename: string,
): Promise<UiPreviewJpegResult> {
  const started = Date.now();
  const cfg = IMAGE_PROCESSING_CONFIG.preview;

  try {
    const { metadata, detectedFormat } = await validateArtworkSourceImage(
      sourceBytes,
      {
        originalFilename,
        byteLength: sourceBytes.byteLength,
      },
    );

    const source = readArtworkSourceMetadata(metadata, detectedFormat, {
      originalFilename,
      originalByteLength: sourceBytes.byteLength,
    });

    const oriented = await sharp(sourceBytes, {
      failOn: "error",
      pages: 1,
      page: 0,
      limitInputPixels: IMAGE_PROCESSING_CONFIG.maxDecodedPixels,
    })
      .rotate()
      .metadata();

    const orientedWidth = oriented.width ?? source.width;
    const orientedHeight = oriented.height ?? source.height;
    const wasResized =
      orientedWidth > cfg.maxWidth || orientedHeight > cfg.maxHeight;

    let pipeline = sharp(sourceBytes, {
      failOn: "error",
      pages: 1,
      page: 0,
      limitInputPixels: IMAGE_PROCESSING_CONFIG.maxDecodedPixels,
    })
      .rotate()
      .toColourspace(cfg.colourspace)
      .withIccProfile("srgb");

    if (source.hasAlpha) {
      pipeline = pipeline.flatten({ background: cfg.flattenBackground });
    }

    pipeline = pipeline.resize({
      width: cfg.maxWidth,
      height: cfg.maxHeight,
      fit: "inside",
      withoutEnlargement: cfg.neverEnlarge,
    });

    const { data, info } = await pipeline
      .jpeg({
        quality: cfg.quality,
        progressive: cfg.progressive,
        mozjpeg: true,
      })
      .toBuffer({ resolveWithObject: true });

    return {
      buffer: data,
      width: info.width,
      height: info.height,
      byteLength: info.size,
      format: "jpeg",
      quality: cfg.quality,
      wasResized,
      source,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    throw mapImageProcessingError(error);
  }
}
