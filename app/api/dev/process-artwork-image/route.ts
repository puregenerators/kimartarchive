/**
 * Authenticated preview tooling for intake (same shared-password gate as
 * the rest of the app). Not part of the permanent submission pipeline.
 */

import { NextResponse } from "next/server";

import { unauthorizedApiResponse } from "@/lib/auth/access";
import { planFilenamesForArtwork } from "@/lib/artwork/filenames";
import { IMAGE_PROCESSING_CONFIG } from "@/lib/images/config";
import {
  ArtworkImageProcessingError,
  toClientErrorPayload,
} from "@/lib/images/errors";
import {
  assertSafePlannedFilename,
  isSafePlannedFilename,
} from "@/lib/images/filename-safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Local-dev allowance for large TIFF masters (product limit 250 MB + multipart overhead). */
export const maxDuration = 300;

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

function parseOptionalInt(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function POST(request: Request) {
  const denied = await unauthorizedApiResponse();
  if (denied) return denied;

  // DEV TOOLING: not part of the final submission pipeline.
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

    // Reject extra file parts if clients send more than one.
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

    const title =
      typeof form.get("title") === "string" ? (form.get("title") as string) : "";
    const year =
      typeof form.get("year") === "string" ? (form.get("year") as string) : "";
    const inventoryId = parseOptionalInt(form.get("inventoryId"));

    let masterFilename =
      typeof form.get("masterFilename") === "string"
        ? (form.get("masterFilename") as string).trim()
        : "";
    let hrFilename =
      typeof form.get("hrFilename") === "string"
        ? (form.get("hrFilename") as string).trim()
        : "";
    let webFilename =
      typeof form.get("webFilename") === "string"
        ? (form.get("webFilename") as string).trim()
        : "";
    let thumbFilename =
      typeof form.get("thumbFilename") === "string"
        ? (form.get("thumbFilename") as string).trim()
        : "";

    if (
      (!masterFilename || !hrFilename || !webFilename || !thumbFilename) &&
      inventoryId &&
      year
    ) {
      const planned = planFilenamesForArtwork({
        year,
        inventoryId,
        title: title || "Untitled",
        masterFilename: originalFilename,
      });
      masterFilename = masterFilename || planned.master;
      hrFilename = hrFilename || planned.hr;
      webFilename = webFilename || planned.web;
      thumbFilename = thumbFilename || planned.thumb;
    }

    for (const [label, name] of [
      ["master", masterFilename],
      ["hr", hrFilename],
      ["web", webFilename],
      ["thumb", thumbFilename],
    ] as const) {
      if (!name || !isSafePlannedFilename(name)) {
        return jsonError(
          400,
          "INVALID_FILENAME",
          `Invalid or missing ${label} filename. Provide planned filenames or year, inventoryId, and title.`,
          artworkId,
        );
      }
      assertSafePlannedFilename(name, label);
    }

    const sourceBytes = Buffer.from(await fileEntry.arrayBuffer());

    const { processArtworkImage } = await import(
      "@/lib/images/process-artwork-image"
    );
    const { storeTempProcessingOutputs } = await import(
      "@/lib/images/temp-store"
    );
    const processed = await processArtworkImage({
      sourceBytes,
      originalFilename,
      plannedFilenames: {
        master: masterFilename,
        hr: hrFilename,
        web: webFilename,
        thumb: thumbFilename,
      },
    });

    console.info(
      JSON.stringify({
        scope: "image-processing",
        event: "process_timings",
        artworkId,
        durationMs: processed.durationMs,
        timings: processed.timings,
      }),
    );

    const stored = await storeTempProcessingOutputs({
      artworkId,
      masterFilename: processed.master.filename,
      sourceOriginalFilename: processed.source.originalFilename,
      warnings: processed.warnings,
      hr: processed.hr,
      web: processed.web,
      thumb: processed.thumb,
    });

    return NextResponse.json({
      ok: true as const,
      // DEV TOOLING marker for clients
      developmentOnly: true,
      artworkId,
      resultId: stored.resultId,
      expiresAt: stored.expiresAt,
      durationMs: processed.durationMs,
      timings: processed.timings,
      warnings: processed.warnings,
      source: processed.source,
      master: processed.master,
      hr: {
        filename: processed.hr.filename,
        width: processed.hr.width,
        height: processed.hr.height,
        byteLength: processed.hr.byteLength,
        format: processed.hr.format,
        quality: processed.hr.quality,
        wasResized: processed.hr.wasResized,
        previewUrl: stored.hrUrl,
        downloadUrl: stored.hrDownloadUrl,
      },
      web: {
        filename: processed.web.filename,
        width: processed.web.width,
        height: processed.web.height,
        byteLength: processed.web.byteLength,
        format: processed.web.format,
        quality: processed.web.quality,
        wasResized: processed.web.wasResized,
        previewUrl: stored.webUrl,
        downloadUrl: stored.webDownloadUrl,
      },
      thumb: {
        filename: processed.thumb.filename,
        width: processed.thumb.width,
        height: processed.thumb.height,
        byteLength: processed.thumb.byteLength,
        format: processed.thumb.format,
        quality: processed.thumb.quality,
        wasResized: processed.thumb.wasResized,
        previewUrl: stored.thumbUrl,
        downloadUrl: stored.thumbDownloadUrl,
      },
      comparisons: {
        hrSizeRatio:
          processed.source.originalByteLength > 0
            ? processed.hr.byteLength / processed.source.originalByteLength
            : null,
        webSizeRatio:
          processed.source.originalByteLength > 0
            ? processed.web.byteLength / processed.source.originalByteLength
            : null,
        webSizeReductionPercent:
          processed.source.originalByteLength > 0
            ? Math.round(
                (1 -
                  processed.web.byteLength /
                    processed.source.originalByteLength) *
                  1000,
              ) / 10
            : null,
        webWasResized: processed.web.wasResized,
      },
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

    console.error("[dev/process-artwork-image]", error);
    return jsonError(
      500,
      "SHARP_DECODE_FAILURE",
      "Image processing failed. Check the source file and try again.",
      artworkId,
    );
  }
}
