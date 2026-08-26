/**
 * Verify that the reserved large-file master exists in Dropbox.
 * Derives the permitted path from the server-side claim. Never accepts a
 * client-provided Dropbox path. Never allocates a new inventory ID.
 */

import { NextResponse } from "next/server";

import { unauthorizedApiResponse } from "@/lib/auth/access";
import { checkLargeFileMaster } from "@/lib/submission/large-file-intake";
import { rejectClientProvidedDropboxPath } from "@/lib/submission/large-file-intake-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
          message: "Do not send a Dropbox path. The reserved master path is derived from the claim.",
        },
        { status: 400 },
      );
    }
    const result = await checkLargeFileMaster({
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
        event: "check_master_unhandled_error",
        ts: new Date().toISOString(),
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    return NextResponse.json(
      {
        ok: false,
        code: "UNKNOWN",
        message: "Could not check Dropbox for the reserved master.",
      },
      { status: 500 },
    );
  }
}
