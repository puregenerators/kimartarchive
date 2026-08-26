/**
 * Continue processing a reserved large-file intake after the master is in Dropbox.
 * Derives the path from the server-side claim. Never allocates a new inventory ID.
 */

import { NextResponse } from "next/server";

import { unauthorizedApiResponse } from "@/lib/auth/access";
import { processLargeFileIntake } from "@/lib/submission/large-file-intake";
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
          errorCode: "INVALID_PATH",
          message: "Do not send a Dropbox path. The reserved master path is derived from the claim.",
        },
        { status: 400 },
      );
    }
    const result = await processLargeFileIntake({
      authenticated: true,
      claimId: String(body.claimId ?? ""),
      inventoryId: Number(body.inventoryId ?? 0),
    });
    const status = result.ok
      ? 200
      : "errorCode" in result && result.errorCode === "UNAUTHENTICATED"
        ? 401
        : result.ok === false && "errorCode" in result && result.errorCode === "LOCAL_PROCESSING_REQUIRED"
          ? 409
          : 500;
    return NextResponse.json(result, { status });
  } catch (error) {
    console.error(
      JSON.stringify({
        scope: "artwork-submission",
        event: "large_file_process_unhandled_error",
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
