/**
 * Temporary UI preview thumbnails for intake (especially TIFF masters).
 *
 * Not a general-purpose image transformation API.
 * Thumbnails are never archival outputs and must not be uploaded or sheet-written.
 */

import { NextResponse } from "next/server";

import { unauthorizedApiResponse } from "@/lib/auth/access";
import { IMAGE_PROCESSING_CONFIG } from "@/lib/images/config";
import {
  ArtworkImageProcessingError,
  toClientErrorPayload,
} from "@/lib/images/errors";
import { generateUiPreviewJpeg } from "@/lib/images/preview";
import { storeTempPreviewOutput } from "@/lib/images/temp-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function jsonError(
  status: number,
  code: string,
  message: string,
  artworkId?: string | null,
) {
  return NextResponse.json(
    {
      ok: false as const,
      error: { code, message, artworkId: artworkId ?? null },
    },
    { status },
  );
}

export async function POST(request: Request) {
  const denied = await unauthorizedApiResponse();
  if (denied) return denied;

  let artworkId: string | null = null;

  try {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      return jsonError(
        400,
        "INVALID_REQUEST",
        "Expected multipart/form-data with a single image file.",
      );
    }

    const form = await request.formData();
    artworkId =
      typeof form.get("artworkId") === "string"
        ? (form.get("artworkId") as string)
        : null;

    const fileEntry = form.get("file");
    if (!(fileEntry instanceof File)) {
      return jsonError(
        400,
        "MISSING_FILE",
        "Exactly one image file is required.",
        artworkId,
      );
    }

    const allFiles = form.getAll("file").filter((v) => v instanceof File);
    if (allFiles.length !== 1) {
      return jsonError(
        400,
        "INVALID_REQUEST",
        "Submit exactly one image file per request.",
        artworkId,
      );
    }

    if (fileEntry.size > IMAGE_PROCESSING_CONFIG.maxSourceBytes) {
      return jsonError(
        400,
        "FILE_TOO_LARGE",
        "Source file exceeds the 250 MB limit.",
        artworkId,
      );
    }

    const originalFilename =
      (typeof form.get("originalFilename") === "string" &&
        (form.get("originalFilename") as string).trim()) ||
      fileEntry.name ||
      "upload.bin";

    const sourceBytes = Buffer.from(await fileEntry.arrayBuffer());
    const preview = await generateUiPreviewJpeg(sourceBytes, originalFilename);

    const stored = await storeTempPreviewOutput({
      artworkId,
      sourceOriginalFilename: originalFilename,
      isMultiPage: preview.source.isMultiPage,
      pageCount: preview.source.pageCount,
      preview: {
        buffer: preview.buffer,
        width: preview.width,
        height: preview.height,
        byteLength: preview.byteLength,
        quality: preview.quality,
        wasResized: preview.wasResized,
      },
    });

    return NextResponse.json({
      ok: true as const,
      uiPreviewOnly: true as const,
      artworkId,
      resultId: stored.resultId,
      expiresAt: stored.expiresAt,
      previewUrl: stored.previewUrl,
      durationMs: preview.durationMs,
      width: preview.width,
      height: preview.height,
      byteLength: preview.byteLength,
      quality: preview.quality,
      wasResized: preview.wasResized,
      isMultiPage: preview.source.isMultiPage,
      pageCount: preview.source.pageCount,
      detectedFormat: preview.source.detectedFormat,
    });
  } catch (error) {
    if (error instanceof ArtworkImageProcessingError) {
      const payload = toClientErrorPayload(error);
      const status =
        payload.code === "FILE_TOO_LARGE"
          ? 413
          : payload.code === "MEMORY_OR_RESOURCE"
            ? 507
            : payload.code === "PROCESSING_TIMEOUT"
              ? 504
              : 400;
      return jsonError(status, payload.code, payload.message, artworkId);
    }

    console.error("[image-preview]", error instanceof Error ? error.message : "unknown");
    return jsonError(
      500,
      "SHARP_DECODE_FAILURE",
      "Preview generation failed. The original file can still be processed.",
      artworkId,
    );
  }
}
