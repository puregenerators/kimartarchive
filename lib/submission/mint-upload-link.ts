import "server-only";

import { getDropboxFilesOps } from "@/lib/dropbox/files";
import { readInventoryClaimRows } from "@/lib/google/sheets";
import { findClaimRowByClaimId } from "@/lib/submission/append-claims";
import type { ClaimStatus } from "@/lib/submission/types";
import {
  TEMP_UPLOAD_LINK_DURATION_SECONDS,
  parseTemporaryUploadLinkResponse,
  validateUploadLinkRequest,
} from "@/lib/submission/upload-link-logic";

export type MintDirectUploadLinkResult =
  | {
      ok: true;
      alreadyUploaded: false;
      uploadUrl: string;
      expiresAt: string;
      dropboxPath: string;
      durationSeconds: number;
    }
  | {
      ok: true;
      alreadyUploaded: true;
      dropboxPath: string;
      byteLength: number;
    }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
    };

export async function mintDirectUploadLink(params: {
  authenticated: boolean;
  body: unknown;
}): Promise<MintDirectUploadLinkResult> {
  if (!params.authenticated) {
    return {
      ok: false,
      status: 401,
      code: "UNAUTHENTICATED",
      message: "Authentication required.",
    };
  }

  const parsed = params.body;
  const claimId =
    parsed && typeof parsed === "object"
      ? String((parsed as { claimId?: unknown }).claimId ?? "")
      : "";

  let claim: { claimId: string; inventoryId: number; claimStatus: ClaimStatus } | null =
    null;
  if (claimId) {
    const rows = await readInventoryClaimRows();
    const row = findClaimRowByClaimId(rows, claimId);
    if (row) {
      claim = {
        claimId: row.claimId,
        inventoryId: row.inventoryId,
        claimStatus: row.status as ClaimStatus,
      };
    }
  }

  const validated = validateUploadLinkRequest({
    authenticated: true,
    body: params.body,
    claim,
  });
  if (!validated.ok) {
    const status =
      validated.code === "UNAUTHENTICATED"
        ? 401
        : validated.code === "FILE_TOO_LARGE"
          ? 413
          : 400;
    return {
      ok: false,
      status,
      code: validated.code,
      message: validated.message,
    };
  }

  const ops = await getDropboxFilesOps();
  const existing = await ops.pathExists(validated.request.dropboxPath);
  if (existing) {
    const meta = await ops.getMetadata(validated.request.dropboxPath);
    if (meta.size === validated.request.byteLength) {
      return {
        ok: true,
        alreadyUploaded: true,
        dropboxPath: validated.request.dropboxPath,
        byteLength: meta.size,
      };
    }
    return {
      ok: false,
      status: 409,
      code: "INVALID_PATH",
      message:
        "A different file already exists at this Dropbox path. The master was not overwritten.",
    };
  }

  const minted = await ops.getTemporaryUploadLink({
    path: validated.request.dropboxPath,
    durationSeconds: TEMP_UPLOAD_LINK_DURATION_SECONDS,
  });
  const parsedLink = parseTemporaryUploadLinkResponse(minted);
  if (!parsedLink.ok) {
    return {
      ok: false,
      status: 502,
      code: "UNKNOWN",
      message: parsedLink.message,
    };
  }

  return {
    ok: true,
    alreadyUploaded: false,
    uploadUrl: parsedLink.link,
    expiresAt: new Date(
      Date.now() + TEMP_UPLOAD_LINK_DURATION_SECONDS * 1000,
    ).toISOString(),
    dropboxPath: validated.request.dropboxPath,
    durationSeconds: TEMP_UPLOAD_LINK_DURATION_SECONDS,
  };
}
