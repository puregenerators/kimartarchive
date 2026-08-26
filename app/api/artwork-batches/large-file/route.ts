/**
 * Authenticated resume listing for incomplete large-file intakes.
 * Never allocates inventory IDs. Never returns Dropbox tokens.
 */

import { NextResponse } from "next/server";

import { unauthorizedApiResponse } from "@/lib/auth/access";
import { listIncompleteLargeFileIntakes } from "@/lib/submission/large-file-intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const denied = await unauthorizedApiResponse();
  if (denied) return denied;

  try {
    const result = await listIncompleteLargeFileIntakes({ authenticated: true });
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
        event: "list_large_file_unhandled_error",
        ts: new Date().toISOString(),
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    return NextResponse.json(
      {
        ok: false,
        code: "UNKNOWN",
        message: "Could not list incomplete large-file intakes.",
      },
      { status: 500 },
    );
  }
}
