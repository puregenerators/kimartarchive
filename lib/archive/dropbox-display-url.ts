/**
 * Convert a stored Dropbox shared URL into a browser-renderable image URL.
 * Never mutates the canonical URL stored in Google Sheets.
 *
 * Implementation lives in the Dropbox helper so Sheets IMAGE() formulas and
 * archive <img> tags share one transformation.
 */

import {
  getDropboxDirectImageUrl,
  normalizeDropboxSharedLinkForImage,
  type DropboxDirectImageUrlFailureReason,
  type DropboxDirectImageUrlResult,
} from "@/lib/dropbox/direct-image-url";

export type DropboxDisplayUrlFailureReason = DropboxDirectImageUrlFailureReason;

export type DropboxDisplayUrlResult =
  | {
      ok: true;
      canonicalUrl: string;
      displayUrl: string;
    }
  | {
      ok: false;
      canonicalUrl: string;
      reason: DropboxDisplayUrlFailureReason;
    };

/**
 * Derive a renderable image URL from a Dropbox shared link when possible.
 * Preserves required query parameters such as `rlkey`.
 */
export function dropboxSharedUrlToDisplayUrl(
  canonicalUrl: string,
): DropboxDisplayUrlResult {
  const result: DropboxDirectImageUrlResult =
    normalizeDropboxSharedLinkForImage(canonicalUrl);
  if (result.ok) {
    return {
      ok: true,
      canonicalUrl: result.sharedUrl,
      displayUrl: result.directImageUrl,
    };
  }
  return {
    ok: false,
    canonicalUrl: result.sharedUrl,
    reason: result.reason,
  };
}

/** Convenience: render URL or null when conversion is not safe. */
export function webFileDisplayUrlFromCanonical(
  canonicalUrl: string,
): string | null {
  return getDropboxDirectImageUrl(canonicalUrl);
}
