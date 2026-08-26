/**
 * Convert a Dropbox shared/preview URL into a direct image URL.
 * A www.dropbox.com preview page returns HTML; Google Sheets IMAGE() and
 * <img> tags need the actual JPEG bytes.
 */

const DROPBOX_FILE_HOSTS = new Set([
  "dropbox.com",
  "www.dropbox.com",
  "dl.dropbox.com",
  "dl.dropboxusercontent.com",
  "www.dropboxusercontent.com",
]);

const DIRECT_IMAGE_HOST = "dl.dropboxusercontent.com";

export type DropboxDirectImageUrlFailureReason =
  | "empty"
  | "malformed"
  | "not_dropbox"
  | "unsupported";

export type DropboxDirectImageUrlResult =
  | {
      ok: true;
      sharedUrl: string;
      directImageUrl: string;
    }
  | {
      ok: false;
      sharedUrl: string;
      reason: DropboxDirectImageUrlFailureReason;
    };

function isDropboxHost(hostname: string): boolean {
  return DROPBOX_FILE_HOSTS.has(hostname.toLowerCase());
}

function isDropboxFilePath(pathname: string): boolean {
  const path = pathname.toLowerCase();
  return path.includes("/scl/fi/") || path.includes("/s/");
}

function isDropboxFolderPath(pathname: string): boolean {
  const path = pathname.toLowerCase();
  return path.includes("/scl/fo/") || path.includes("/sh/");
}

/**
 * Normalize a Dropbox shared link so it returns the file bytes, not HTML.
 * Preserves required query parameters such as `rlkey`.
 */
export function normalizeDropboxSharedLinkForImage(
  sharedUrl: string,
): DropboxDirectImageUrlResult {
  const shared = sharedUrl.trim();
  if (!shared) {
    return { ok: false, sharedUrl: "", reason: "empty" };
  }

  let parsed: URL;
  try {
    parsed = new URL(shared);
  } catch {
    return { ok: false, sharedUrl: shared, reason: "malformed" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, sharedUrl: shared, reason: "malformed" };
  }

  if (!isDropboxHost(parsed.hostname)) {
    return { ok: false, sharedUrl: shared, reason: "not_dropbox" };
  }

  if (isDropboxFolderPath(parsed.pathname) || !isDropboxFilePath(parsed.pathname)) {
    return { ok: false, sharedUrl: shared, reason: "unsupported" };
  }

  const direct = new URL(parsed.toString());
  direct.protocol = "https:";
  direct.hostname = DIRECT_IMAGE_HOST;
  direct.searchParams.delete("dl");
  direct.searchParams.set("raw", "1");

  return {
    ok: true,
    sharedUrl: shared,
    directImageUrl: direct.toString(),
  };
}

/** Convenience: direct image URL or null when conversion is not safe. */
export function getDropboxDirectImageUrl(sharedUrl: string): string | null {
  const result = normalizeDropboxSharedLinkForImage(sharedUrl);
  return result.ok ? result.directImageUrl : null;
}

export function isDropboxSharedLinkAlreadyExistsError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const tagged = error as {
    errorTag?: string;
    errorSummary?: string;
    message?: string;
    code?: string;
  };
  if (tagged.errorTag === "shared_link_already_exists") return true;
  const haystack = [
    tagged.errorSummary,
    tagged.message,
    tagged.code,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes("shared_link_already_exists");
}
