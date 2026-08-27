/**
 * Dismiss a stale incomplete large-file intake without deleting archive files
 * or Artwork Inventory rows. Marks the claim Abandoned so the inventory ID
 * stays retired. Never allocates a new inventory ID.
 */

import { NextResponse } from "next/server";

import { unauthorizedApiResponse } from "@/lib/auth/access";
import { dismissIncompleteLargeFileIntake } from "@/lib/submission/large-file-intake";
import { rejectClientProvidedDropboxPath } from "@/lib/submission/large-file-intake-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const denied = await unauthorizedApiResponse();
  if (denied) return denied;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (rejectClientProvidedDropboxPath(body)) {
      return NextResponse.json(
        {
          ok: false,
          code: "INVALID_PATH",
          message: "Do not send a Dropbox path. Dismiss only updates the claim status.",
        },
        { status: 400 },
      );
    }
    const result = await dismissIncompleteLargeFileIntake({
      authenticated: true,
      claimId: String(body.claimId ?? ""),
      inventoryId: Number(body.inventoryId ?? 0),
    });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, code: result.code, message: result.message },
        { status: result.status },
      );
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error(
      JSON.stringify({
        scope: "artwork-submission",
        event: "dismiss_large_file_unhandled_error",
        ts: new Date().toISOString(),
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    return NextResponse.json(
      {
        ok: false,
        code: "UNKNOWN",
        message: "Could not remove this incomplete intake from the list.",
      },
      { status: 500 },
    );
  }
}
