import { planFilenamesForArtwork } from "@/lib/artwork/filenames";
import {
  MAX_FILE_BYTES,
  MAX_FILE_SIZE_LABEL,
} from "@/lib/artwork/types";
import { isSafePlannedFilename } from "@/lib/images/filename-safety";
import { buildArtworkFolderName } from "@/lib/submission/claim-logic";
import type { ClaimStatus } from "@/lib/submission/types";

export const TEMP_UPLOAD_LINK_DURATION_SECONDS = 900;

const ALLOWED_EXTENSIONS = new Set([".tif", ".tiff", ".jpg", ".jpeg", ".png"]);

const ALLOWED_MIME_TYPES = new Set([
  "image/tiff",
  "image/x-tiff",
  "image/jpeg",
  "image/png",
  "image/jpg",
]);

export type DeclaredArtworkFile = {
  clientArtworkId: string;
  filename: string;
  mimeType: string;
  byteLength: number;
};

export type UploadLinkRequestBody = {
  claimId: string;
  inventoryId: number;
  clientArtworkId: string;
  filename: string;
  dropboxPath: string;
  mimeType: string;
  byteLength: number;
  year: string;
  title: string;
  originalFilename: string;
};

export type UploadLinkValidationCode =
  | "UNAUTHENTICATED"
  | "INVALID_REQUEST"
  | "INVALID_PATH"
  | "INVALID_FILENAME"
  | "INVALID_TYPE"
  | "INVALID_EXTENSION"
  | "FILE_TOO_LARGE"
  | "FILE_EMPTY"
  | "CLAIM_NOT_REUSABLE";

export type UploadLinkValidationFailure = {
  ok: false;
  code: UploadLinkValidationCode;
  message: string;
};

export type UploadLinkValidationSuccess = {
  ok: true;
  request: UploadLinkRequestBody;
  plannedMasterFilename: string;
  folderName: string;
};

export type MintTemporaryUploadLinkCommit = {
  path: string;
  mode: "add";
  autorename: false;
  mute: true;
  strict_conflict: true;
};

export function buildTemporaryUploadLinkPayload(path: string): {
  commit_info: MintTemporaryUploadLinkCommit;
  duration: number;
} {
  return {
    commit_info: {
      path,
      mode: "add",
      autorename: false,
      mute: true,
      strict_conflict: true,
    },
    duration: TEMP_UPLOAD_LINK_DURATION_SECONDS,
  };
}

export function parseTemporaryUploadLinkResponse(
  json: unknown,
): { ok: true; link: string } | { ok: false; message: string } {
  if (!json || typeof json !== "object") {
    return { ok: false, message: "Dropbox did not return a temporary upload link." };
  }
  const link = (json as { link?: unknown }).link;
  if (typeof link !== "string" || !link.startsWith("https://")) {
    return { ok: false, message: "Dropbox did not return a temporary upload link." };
  }
  if (/sl\.[A-Za-z0-9_-]+/.test(link) || /access_token=/i.test(link)) {
    return { ok: false, message: "Dropbox did not return a temporary upload link." };
  }
  return { ok: true, link };
}

export function normalizeDeclaredMimeType(mimeType: string): string {
  return mimeType.trim().toLowerCase();
}

export function masterExtensionFromFilename(filename: string): string {
  const match = /\.([^.]+)$/.exec(filename.trim().toLowerCase());
  return match ? `.${match[1]}` : "";
}

export function mimeMatchesExtension(
  mimeType: string,
  filename: string,
): boolean {
  const mime = normalizeDeclaredMimeType(mimeType);
  const ext = masterExtensionFromFilename(filename);
  if (!ext || !ALLOWED_EXTENSIONS.has(ext)) return false;
  if (!mime) return true;
  if (ext === ".tif" || ext === ".tiff") {
    return mime === "image/tiff" || mime === "image/x-tiff";
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    return mime === "image/jpeg" || mime === "image/jpg";
  }
  if (ext === ".png") return mime === "image/png";
  return false;
}

export function expectedMasterDropboxPath(params: {
  year: string;
  inventoryId: number;
  title: string;
  masterFilename: string;
}): string {
  const folderName = buildArtworkFolderName(params);
  return `/${folderName}/${params.masterFilename}`;
}

export function validateDeclaredFileSize(
  byteLength: number,
): UploadLinkValidationFailure | null {
  if (!Number.isInteger(byteLength) || byteLength <= 0) {
    return {
      ok: false,
      code: "FILE_EMPTY",
      message: "Source file is empty.",
    };
  }
  if (byteLength > MAX_FILE_BYTES) {
    return {
      ok: false,
      code: "FILE_TOO_LARGE",
      message: `Source file exceeds the ${MAX_FILE_SIZE_LABEL} limit.`,
    };
  }
  return null;
}

export function validateDeclaredMasterFile(file: DeclaredArtworkFile): {
  ok: true;
} | UploadLinkValidationFailure {
  const filename = file.filename.trim();
  if (!filename || filename !== file.filename.replace(/\\/g, "/").split("/").pop()) {
    return {
      ok: false,
      code: "INVALID_FILENAME",
      message: "Master filename must be a basename with no path segments.",
    };
  }
  const ext = masterExtensionFromFilename(filename);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return {
      ok: false,
      code: "INVALID_EXTENSION",
      message: "Master must be TIFF, JPEG, or PNG.",
    };
  }
  const mime = normalizeDeclaredMimeType(file.mimeType);
  if (mime && !ALLOWED_MIME_TYPES.has(mime)) {
    return {
      ok: false,
      code: "INVALID_TYPE",
      message: "Master MIME type must be TIFF, JPEG, or PNG.",
    };
  }
  if (!mimeMatchesExtension(file.mimeType, filename)) {
    return {
      ok: false,
      code: "INVALID_TYPE",
      message: "Master MIME type does not match the file extension.",
    };
  }
  const sizeError = validateDeclaredFileSize(file.byteLength);
  if (sizeError) return sizeError;
  return { ok: true };
}

export function canReuseClaimStatus(status: string): boolean {
  return status === "Claimed" || status === "Processing";
}

export function parseUploadLinkRequestBody(
  raw: unknown,
): UploadLinkRequestBody | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const inventoryId = Number(value.inventoryId);
  const byteLength = Number(value.byteLength);
  if (!Number.isInteger(inventoryId) || inventoryId <= 0) return null;
  if (!Number.isInteger(byteLength)) return null;
  return {
    claimId: String(value.claimId ?? "").trim(),
    inventoryId,
    clientArtworkId: String(value.clientArtworkId ?? "").trim(),
    filename: String(value.filename ?? ""),
    dropboxPath: String(value.dropboxPath ?? ""),
    mimeType: String(value.mimeType ?? ""),
    byteLength,
    year: String(value.year ?? "").trim(),
    title: String(value.title ?? "").trim(),
    originalFilename: String(value.originalFilename ?? value.filename ?? ""),
  };
}

export function validateUploadLinkRequest(params: {
  authenticated: boolean;
  body: unknown;
  claim?: { claimId: string; inventoryId: number; claimStatus: ClaimStatus } | null;
}): UploadLinkValidationSuccess | UploadLinkValidationFailure {
  if (!params.authenticated) {
    return {
      ok: false,
      code: "UNAUTHENTICATED",
      message: "Authentication required.",
    };
  }

  const request = parseUploadLinkRequestBody(params.body);
  if (!request || !request.claimId || !request.clientArtworkId) {
    return {
      ok: false,
      code: "INVALID_REQUEST",
      message: "Upload-link request is missing required fields.",
    };
  }

  const declared = validateDeclaredMasterFile({
    clientArtworkId: request.clientArtworkId,
    filename: request.originalFilename || request.filename,
    mimeType: request.mimeType,
    byteLength: request.byteLength,
  });
  if (!declared.ok) return declared;

  const planned = planFilenamesForArtwork({
    year: request.year,
    inventoryId: request.inventoryId,
    title: request.title,
    masterFilename: request.originalFilename || request.filename,
  });

  if (!isSafePlannedFilename(planned.master)) {
    return {
      ok: false,
      code: "INVALID_FILENAME",
      message: "Planned master filename is not safe.",
    };
  }

  if (request.filename !== planned.master) {
    return {
      ok: false,
      code: "INVALID_FILENAME",
      message: "Filename must match the planned master name for this inventory ID.",
    };
  }

  const expectedPath = expectedMasterDropboxPath({
    year: request.year,
    inventoryId: request.inventoryId,
    title: request.title,
    masterFilename: planned.master,
  });
  if (request.dropboxPath !== expectedPath) {
    return {
      ok: false,
      code: "INVALID_PATH",
      message: "Dropbox path does not match the reserved artwork folder and master filename.",
    };
  }

  if (!params.claim) {
    return {
      ok: false,
      code: "CLAIM_NOT_REUSABLE",
      message: "Inventory claim was not found.",
    };
  }
  if (
    params.claim.claimId !== request.claimId ||
    params.claim.inventoryId !== request.inventoryId
  ) {
    return {
      ok: false,
      code: "CLAIM_NOT_REUSABLE",
      message: "Inventory claim does not match this artwork.",
    };
  }
  if (!canReuseClaimStatus(params.claim.claimStatus)) {
    return {
      ok: false,
      code: "CLAIM_NOT_REUSABLE",
      message:
        params.claim.claimStatus === "Completed"
          ? "This artwork is already completed."
          : "This inventory claim cannot be reused.",
    };
  }

  return {
    ok: true,
    request,
    plannedMasterFilename: planned.master,
    folderName: buildArtworkFolderName({
      year: request.year,
      inventoryId: request.inventoryId,
      title: request.title,
    }),
  };
}
