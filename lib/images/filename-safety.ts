/**
 * Filename safety helpers for planned derivative names.
 * Never accept filesystem paths from the client.
 */

const PLANNED_FILENAME_PATTERN =
  /^\d{4}_KO_\d+_[A-Za-z0-9]+_(master|hr|web|thumb)_\d{2}\.(jpg|png|tif)$/;

export function basenameOnly(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] ?? "";
}

/** Reject path segments, null bytes, and control characters. */
export function isSafePlannedFilename(filename: string): boolean {
  if (!filename || filename.length > 255) return false;
  if (filename !== basenameOnly(filename)) return false;
  if (filename.includes("\0")) return false;
  if (/[\u0000-\u001f\u007f]/.test(filename)) return false;
  if (filename.includes("..")) return false;
  return PLANNED_FILENAME_PATTERN.test(filename);
}

export function assertSafePlannedFilename(
  filename: string,
  label: string,
): void {
  if (!isSafePlannedFilename(filename)) {
    throw new Error(`Invalid ${label} filename.`);
  }
}

/**
 * Normalize master extensions for planned filenames:
 * .jpeg → .jpg, .tiff → .tif
 */
export function normalizeSourceExtension(filename: string): string {
  const match = /\.([^.]+)$/.exec(filename);
  if (!match) return "";

  const ext = match[1].toLowerCase();
  if (ext === "jpeg" || ext === "jpg") return ".jpg";
  if (ext === "png") return ".png";
  if (ext === "tif" || ext === "tiff") return ".tif";
  return `.${ext}`;
}
