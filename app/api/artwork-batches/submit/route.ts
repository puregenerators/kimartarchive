/**
 * Permanent artwork batch submission endpoint.
 *
 * Accepts one complete batch as multipart/form-data, claims inventory IDs,
 * processes artworks sequentially, and returns one structured report.
 *
 * Local-only architecture: temporary files live under os.tmpdir(), not the repo.
 * Production hosting for large uploads remains unresolved.
 */

import { NextResponse } from "next/server";

import { submitArtworkBatch } from "@/lib/submission/submit-batch";
import type {
  ArtworkBatchSubmissionInput,
  ArtworkSubmissionInput,
} from "@/lib/submission/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Large TIFF masters: product limit 250 MB/file; sequential processing. */
export const maxDuration = 300;

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function parseArtworksJson(
  raw: FormDataEntryValue | null,
): ArtworkSubmissionInput[] | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed as ArtworkSubmissionInput[];
  } catch {
    return null;
  }
}

function parseSharedJson(
  raw: FormDataEntryValue | null,
): ArtworkBatchSubmissionInput["shared"] | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw) as ArtworkBatchSubmissionInput["shared"];
    if (!parsed || typeof parsed !== "object") return null;
    return {
      exhibition: String(parsed.exhibition ?? ""),
      gallery: String(parsed.gallery ?? ""),
      exhibitionYear: String(parsed.exhibitionYear ?? ""),
      photographer: String(parsed.photographer ?? ""),
      defaultLocation: String(parsed.defaultLocation ?? ""),
    };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      return json(
        {
          ok: false,
          kind: "invalid_request",
          submissionAttemptId: null,
          archiveTarget: null,
          code: "INVALID_BATCH",
          message: "Expected multipart/form-data.",
          completedAt: new Date().toISOString(),
        },
        400,
      );
    }

    const form = await request.formData();
    const submissionAttemptId =
      typeof form.get("submissionAttemptId") === "string"
        ? (form.get("submissionAttemptId") as string)
        : "";

    const artworks = parseArtworksJson(form.get("artworks"));
    const shared = parseSharedJson(form.get("shared"));

    if (!artworks || !shared) {
      return json(
        {
          ok: false,
          kind: "invalid_request",
          submissionAttemptId: submissionAttemptId || null,
          archiveTarget: null,
          code: "INVALID_BATCH",
          message: "Request must include JSON fields `artworks` and `shared`.",
          completedAt: new Date().toISOString(),
        },
        400,
      );
    }

    const files: { clientArtworkId: string; file: File }[] = [];
    for (const artwork of artworks) {
      const key = `file:${artwork.clientArtworkId}`;
      const entry = form.get(key);
      if (entry instanceof File) {
        files.push({ clientArtworkId: artwork.clientArtworkId, file: entry });
      }
    }

    const result = await submitArtworkBatch({
      submissionAttemptId,
      shared,
      artworks,
      files,
    });

    const status = result.ok
      ? 200
      : result.kind === "duplicate_attempt"
        ? 409
        : result.kind === "preflight_failed"
          ? 503
          : 400;

    return json(result, status);
  } catch (error) {
    console.error(
      JSON.stringify({
        scope: "artwork-submission",
        event: "unhandled_error",
        ts: new Date().toISOString(),
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    return json(
      {
        ok: false,
        kind: "invalid_request",
        submissionAttemptId: null,
        archiveTarget: null,
        code: "UNKNOWN",
        message:
          "Batch submission failed unexpectedly. Check server logs and Google diagnostic records before retrying.",
        completedAt: new Date().toISOString(),
      },
      500,
    );
  }
}
