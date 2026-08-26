/**
 * Serve a temporary UI preview JPEG by opaque result ID.
 * No directory listing. Expired results return 404.
 * Never exposes filesystem paths.
 */

import { NextResponse } from "next/server";

import { unauthorizedApiResponse } from "@/lib/auth/access";
import {
  discardTempResult,
  getTempPreviewAsset,
} from "@/lib/images/temp-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    resultId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const denied = await unauthorizedApiResponse();
  if (denied) return denied;

  const { resultId } = await context.params;
  const result = await getTempPreviewAsset(resultId);
  if (!result) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: "Preview not found or expired.",
        },
      },
      { status: 404 },
    );
  }

  const headers = new Headers({
    "Content-Type": result.contentType,
    "Content-Length": String(result.buffer.byteLength),
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex",
    "Content-Disposition": `inline; filename="${result.filename}"`,
  });

  return new NextResponse(new Uint8Array(result.buffer), {
    status: 200,
    headers,
  });
}

/** Client cleanup when a TIFF is replaced, removed, or the batch is reset. */
export async function DELETE(_request: Request, context: RouteContext) {
  const denied = await unauthorizedApiResponse();
  if (denied) return denied;

  const { resultId } = await context.params;
  await discardTempResult(resultId);
  return NextResponse.json({ ok: true as const });
}
