import type { ArtworkImageProcessingErrorCode } from "@/lib/images/types";

export class ArtworkImageProcessingError extends Error {
  readonly code: ArtworkImageProcessingErrorCode;

  constructor(code: ArtworkImageProcessingErrorCode, message: string) {
    super(message);
    this.name = "ArtworkImageProcessingError";
    this.code = code;
  }
}

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

/**
 * Map Sharp / filesystem failures to safe user-facing errors.
 * Never expose stack traces or absolute paths to the client.
 */
export function mapImageProcessingError(error: unknown): ArtworkImageProcessingError {
  if (error instanceof ArtworkImageProcessingError) {
    return error;
  }

  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const lower = message.toLowerCase();

  if (includesAny(lower, ["timeout", "timed out"])) {
    return new ArtworkImageProcessingError(
      "PROCESSING_TIMEOUT",
      "Image processing timed out. Try a smaller file or process again.",
    );
  }

  if (
    includesAny(lower, [
      "enospc",
      "eacces",
      "eperm",
      "unable to open",
      "enoent",
      "write",
      "tmpdir",
    ]) &&
    includesAny(lower, ["write", "open", "mkdir", "rename", "temp", "tmp"])
  ) {
    return new ArtworkImageProcessingError(
      "TEMP_WRITE_FAILURE",
      "Could not write temporary processing files. Check local disk space and try again.",
    );
  }

  if (includesAny(lower, ["out of memory", "memory", "allocation failed", "vips error: out"])) {
    return new ArtworkImageProcessingError(
      "MEMORY_OR_RESOURCE",
      "The image is too large to process with available memory. Try a smaller source file.",
    );
  }

  if (includesAny(lower, ["password", "encrypted", "decrypt"])) {
    return new ArtworkImageProcessingError(
      "UNREADABLE_IMAGE",
      "This image appears password-protected or encrypted and cannot be read.",
    );
  }

  if (includesAny(lower, ["compression", "unsupported compression", "jp2k", "jpeg2000"])) {
    return new ArtworkImageProcessingError(
      "UNSUPPORTED_TIFF_COMPRESSION",
      "This TIFF uses an unsupported compression. Export as an uncompressed or LZW TIFF, JPEG, or PNG.",
    );
  }

  if (includesAny(lower, ["tiff", "tif"]) && includesAny(lower, ["invalid", "malformed", "corrupt"])) {
    return new ArtworkImageProcessingError(
      "MALFORMED_TIFF",
      "This TIFF file appears malformed and could not be read.",
    );
  }

  if (
    includesAny(lower, [
      "unsupported image format",
      "input buffer contains unsupported",
      "vips load",
      "is not a valid",
      "corrupt",
      "premature end",
      "incomplete",
      "decode",
      "bad seek",
    ])
  ) {
    return new ArtworkImageProcessingError(
      "CORRUPTED_IMAGE",
      "The image could not be decoded. It may be corrupted or an unsupported variant.",
    );
  }

  if (includesAny(lower, ["sharp", "vips", "libvips"])) {
    return new ArtworkImageProcessingError(
      "SHARP_DECODE_FAILURE",
      "Sharp could not process this image. Check the file and try again.",
    );
  }

  return new ArtworkImageProcessingError(
    "SHARP_DECODE_FAILURE",
    "Image processing failed. Check the source file and try again.",
  );
}

export function toClientErrorPayload(error: ArtworkImageProcessingError): {
  code: ArtworkImageProcessingErrorCode;
  message: string;
} {
  return {
    code: error.code,
    message: error.message,
  };
}
