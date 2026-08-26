/**
 * Client-side types and helpers for temporary TIFF UI previews.
 * Preview results are never part of submission payloads.
 */

/** Vercel serverless request body cap (`4.5 MB`). */
export const VERCEL_FUNCTION_BODY_LIMIT_BYTES = Math.floor(4.5 * 1024 * 1024);

/**
 * Skip POSTing TIFF bytes to `/api/image-preview` above this size so the
 * 4.5 MB Vercel body limit cannot be hit. Leaves headroom for multipart fields.
 */
export const TIFF_UI_PREVIEW_MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export function shouldSkipTiffUiPreviewUpload(byteLength: number): boolean {
  return byteLength > TIFF_UI_PREVIEW_MAX_UPLOAD_BYTES;
}

export function tiffUiPreviewSkippedMessage(fileName: string): string {
  return `${fileName} (TIFF) — preview skipped for files over 4.5 MB. Intake can continue.`;
}

export type SourceFileFingerprintInput = {
  imageName: string;
  imageSize: number;
  imageLastModified: number;
};

/** Fingerprint for tying a preview to the current source file only. */
export function buildSourceFileFingerprint(
  input: SourceFileFingerprintInput,
): string {
  return [input.imageName, String(input.imageSize), String(input.imageLastModified)].join(
    "|",
  );
}

export type TiffPreviewReady = {
  status: "ready";
  fingerprint: string;
  resultId: string;
  previewUrl: string;
  expiresAt: number;
  isMultiPage: boolean;
  pageCount: number | null;
};

export type TiffPreviewState =
  | { status: "idle" }
  | { status: "queued"; fingerprint: string }
  | { status: "loading"; fingerprint: string }
  | TiffPreviewReady
  | {
      status: "error";
      fingerprint: string;
      message: string;
    };

export type ImagePreviewApiSuccess = {
  ok: true;
  uiPreviewOnly: true;
  artworkId: string | null;
  resultId: string;
  expiresAt: number;
  previewUrl: string;
  durationMs: number;
  width: number;
  height: number;
  byteLength: number;
  quality: number;
  wasResized: boolean;
  isMultiPage: boolean;
  pageCount: number | null;
  detectedFormat: string;
};

export type ImagePreviewApiFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
    artworkId: string | null;
  };
};

export function isTiffPreviewFresh(
  state: TiffPreviewState | undefined,
  fingerprint: string,
): boolean {
  if (!state) return false;
  if (state.status === "idle") return false;
  return state.fingerprint === fingerprint;
}

export function resolveTiffPreviewUrl(
  state: TiffPreviewState | undefined,
  fingerprint: string,
): string | null {
  if (!state || state.status !== "ready") return null;
  if (state.fingerprint !== fingerprint) return null;
  return state.previewUrl;
}

/** Discard a server-side preview result. Best-effort; TTL covers failures. */
export function discardImagePreviewResult(resultId: string): void {
  void fetch(`/api/image-preview/${resultId}`, { method: "DELETE" }).catch(
    () => {
      // TTL cleanup remains the safety net.
    },
  );
}

export function clearTiffPreviewState(
  byArtworkId: Record<string, TiffPreviewState>,
  artworkId: string,
): Record<string, TiffPreviewState> {
  const current = byArtworkId[artworkId];
  if (!current) return byArtworkId;
  if (current.status === "ready") {
    discardImagePreviewResult(current.resultId);
  }
  const next = { ...byArtworkId };
  delete next[artworkId];
  return next;
}

export function clearAllTiffPreviewState(
  byArtworkId: Record<string, TiffPreviewState>,
): Record<string, TiffPreviewState> {
  for (const state of Object.values(byArtworkId)) {
    if (state.status === "ready") {
      discardImagePreviewResult(state.resultId);
    }
  }
  return {};
}
