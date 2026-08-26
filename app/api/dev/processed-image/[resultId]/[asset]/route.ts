/**
 * Authenticated serving of temporary HR/web derivatives by opaque result ID.
 * No directory listing. Expired results return 404.
 */

import { NextResponse } from "next/server";

import { unauthorizedApiResponse } from "@/lib/auth/access";
import { getTempAsset, type TempAssetKind } from "@/lib/images/temp-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    resultId: string;
    asset: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const denied = await unauthorizedApiResponse();
  if (denied) return denied;

  const { resultId, asset: assetParam } = await context.params;

  if (assetParam !== "hr" && assetParam !== "web" && assetParam !== "thumb") {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_REQUEST", message: "Unknown asset." } },
      { status: 404 },
    );
  }

  const asset = assetParam as TempAssetKind;
  const result = await getTempAsset(resultId, asset);
  if (!result) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: "Processed image not found or expired.",
        },
      },
      { status: 404 },
    );
  }

  const download =
    new URL(request.url).searchParams.get("download") === "1";

  const headers = new Headers({
    "Content-Type": result.contentType,
    "Content-Length": String(result.buffer.byteLength),
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex",
  });

  if (download) {
    headers.set(
      "Content-Disposition",
      `attachment; filename="${result.filename.replace(/"/g, "")}"`,
    );
  } else {
    headers.set(
      "Content-Disposition",
      `inline; filename="${result.filename.replace(/"/g, "")}"`,
    );
  }

  return new NextResponse(new Uint8Array(result.buffer), {
    status: 200,
    headers,
  });
}
