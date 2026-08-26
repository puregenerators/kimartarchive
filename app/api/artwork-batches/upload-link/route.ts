/**
 * Mint a short-lived, path-bound Dropbox temporary upload link.
 * Never returns Dropbox access or refresh tokens.
 */

import { NextResponse } from "next/server";

import { unauthorizedApiResponse } from "@/lib/auth/access";
import { mintDirectUploadLink } from "@/lib/submission/mint-upload-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  const denied = await unauthorizedApiResponse();
  if (denied) return denied;

  try {
    const body = await request.json();
    const result = await mintDirectUploadLink({
      authenticated: true,
      body,
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
        event: "upload_link_unhandled_error",
        ts: new Date().toISOString(),
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    return NextResponse.json(
      {
        ok: false,
        code: "UNKNOWN",
        message: "Could not create a Dropbox upload link.",
      },
      { status: 500 },
    );
  }
}
