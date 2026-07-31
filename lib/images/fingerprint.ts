/**
 * Client-side fingerprint for detecting stale image-processing results.
 * Notes and unrelated metadata are intentionally excluded.
 */

export type ImageProcessingFingerprintInput = {
  title: string;
  year: string;
  previewInventoryId: number;
  /** Stable-ish identity for the source file without hashing bytes. */
  imageName: string;
  imageSize: number;
  imageLastModified: number;
};

export function buildImageProcessingFingerprint(
  input: ImageProcessingFingerprintInput,
): string {
  return [
    input.title.trim(),
    input.year.trim(),
    String(input.previewInventoryId),
    input.imageName,
    String(input.imageSize),
    String(input.imageLastModified),
  ].join("|");
}

export function isProcessingResultStale(
  storedFingerprint: string | null | undefined,
  current: ImageProcessingFingerprintInput,
): boolean {
  if (!storedFingerprint) return true;
  return storedFingerprint !== buildImageProcessingFingerprint(current);
}
