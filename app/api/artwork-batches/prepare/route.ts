/**
 * Permanent artwork batch prepare: claim inventory IDs and reserve Dropbox
 * folders. JSON only — no master bytes.
 */

import { NextResponse } from "next/server";

import { unauthorizedApiResponse } from "@/lib/auth/access";
import { prepareDirectIntake } from "@/lib/submission/prepare-direct-intake";
import type { ArtworkSubmissionInput } from "@/lib/submission/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function parseArtworkEntry(value: unknown): ArtworkSubmissionInput | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const overridesRaw =
    raw.overrides && typeof raw.overrides === "object"
      ? (raw.overrides as Record<string, unknown>)
      : {};
  return {
    clientArtworkId: String(raw.clientArtworkId ?? ""),
    order: Number(raw.order ?? 0),
    title: String(raw.title ?? ""),
    ...(raw.isUntitled === true ? { isUntitled: true as const } : {}),
    year: String(raw.year ?? ""),
    medium: String(raw.medium ?? "").trim(),
    height: String(raw.height ?? ""),
    width: String(raw.width ?? ""),
    depth: String(raw.depth ?? ""),
    dimensionUnit: String(raw.dimensionUnit ?? ""),
    notes: String(raw.notes ?? ""),
    overrides: {
      exhibition: String(overridesRaw.exhibition ?? ""),
      gallery: String(overridesRaw.gallery ?? ""),
      photographer: String(overridesRaw.photographer ?? ""),
    },
    originalFilename: String(raw.originalFilename ?? ""),
  };
}

export async function POST(request: Request) {
  const denied = await unauthorizedApiResponse();
  if (denied) return denied;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const artworksRaw = Array.isArray(body.artworks) ? body.artworks : null;
    const filesRaw = Array.isArray(body.files) ? body.files : null;
    const sharedRaw =
      body.shared && typeof body.shared === "object"
        ? (body.shared as Record<string, unknown>)
        : null;
    if (!artworksRaw || !filesRaw || !sharedRaw) {
      return json(
        {
          ok: false,
          kind: "invalid_request",
          code: "INVALID_BATCH",
          message: "Request must include JSON fields `artworks`, `files`, and `shared`.",
        },
        400,
      );
    }

    const artworks: ArtworkSubmissionInput[] = [];
    for (const entry of artworksRaw) {
      const artwork = parseArtworkEntry(entry);
      if (!artwork) {
        return json(
          {
            ok: false,
            kind: "invalid_request",
            code: "INVALID_BATCH",
            message: "Artwork metadata is invalid.",
          },
          400,
        );
      }
      artworks.push(artwork);
    }

    const files = filesRaw.map((entry) => {
      const raw = entry as Record<string, unknown>;
      return {
        clientArtworkId: String(raw.clientArtworkId ?? ""),
        filename: String(raw.filename ?? ""),
        mimeType: String(raw.mimeType ?? ""),
        byteLength: Number(raw.byteLength ?? 0),
      };
    });

    const retryClaims = Array.isArray(body.retryClaims)
      ? body.retryClaims.map((entry) => {
          const raw = entry as Record<string, unknown>;
          return {
            clientArtworkId: String(raw.clientArtworkId ?? ""),
            claimId: String(raw.claimId ?? ""),
            inventoryId: Number(raw.inventoryId ?? 0),
          };
        })
      : [];

    const result = await prepareDirectIntake({
      submissionAttemptId: String(body.submissionAttemptId ?? ""),
      shared: {
        exhibition: String(sharedRaw.exhibition ?? ""),
        gallery: String(sharedRaw.gallery ?? ""),
        exhibitionYear: String(sharedRaw.exhibitionYear ?? ""),
        photographer: String(sharedRaw.photographer ?? ""),
      },
      artworks,
      files,
      retryClaims,
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
        event: "prepare_unhandled_error",
        ts: new Date().toISOString(),
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    return json(
      {
        ok: false,
        kind: "invalid_request",
        code: "UNKNOWN",
        message: "Could not prepare this batch. Check server logs before retrying.",
      },
      500,
    );
  }
}
