/**
 * Process one artwork after the master is already in Dropbox.
 * JSON metadata + Dropbox path only — no master bytes.
 */

import { NextResponse } from "next/server";

import { unauthorizedApiResponse } from "@/lib/auth/access";
import { processArtworkFromDropbox } from "@/lib/submission/process-from-dropbox";
import { runSubmissionPreflight } from "@/lib/submission/preflight";
import type { ArtworkSubmissionInput } from "@/lib/submission/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
    const artwork = parseArtworkEntry(body.artwork);
    const sharedRaw =
      body.shared && typeof body.shared === "object"
        ? (body.shared as Record<string, unknown>)
        : null;
    if (!artwork || !sharedRaw) {
      return NextResponse.json(
        {
          ok: false,
          errorCode: "INVALID_BATCH",
          message: "Request must include JSON `artwork` and `shared`.",
        },
        { status: 400 },
      );
    }

    const preflight = await runSubmissionPreflight();
    if (!preflight.ok) {
      return NextResponse.json(
        {
          ok: false,
          errorCode: "PREFLIGHT_FAILED",
          message: preflight.message,
        },
        { status: 503 },
      );
    }

    const result = await processArtworkFromDropbox({
      submissionAttemptId: String(body.submissionAttemptId ?? ""),
      artwork,
      shared: {
        exhibition: String(sharedRaw.exhibition ?? ""),
        gallery: String(sharedRaw.gallery ?? ""),
        photographer: String(sharedRaw.photographer ?? ""),
      },
      claimId: String(body.claimId ?? ""),
      inventoryId: Number(body.inventoryId ?? 0),
      dropboxPath: String(body.dropboxPath ?? ""),
      spreadsheetId: preflight.archive.sheetId,
      storage: preflight.storage,
    });

    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (error) {
    console.error(
      JSON.stringify({
        scope: "artwork-submission",
        event: "process_unhandled_error",
        ts: new Date().toISOString(),
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    return NextResponse.json(
      {
        ok: false,
        errorCode: "UNKNOWN",
        message: "Processing failed unexpectedly. The master in Dropbox was not deleted.",
      },
      { status: 500 },
    );
  }
}
