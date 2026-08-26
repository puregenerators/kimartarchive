export type SupportedArtworkImageFormat = "jpeg" | "png" | "tiff";

export type ArtworkImageProcessingErrorCode =
  | "UNSUPPORTED_FORMAT"
  | "FILE_TOO_LARGE"
  | "CORRUPTED_IMAGE"
  | "UNREADABLE_IMAGE"
  | "MISSING_DIMENSIONS"
  | "EXCESSIVE_PIXELS"
  | "UNREASONABLE_DIMENSIONS"
  | "MALFORMED_TIFF"
  | "UNSUPPORTED_TIFF_COMPRESSION"
  | "SHARP_DECODE_FAILURE"
  | "MEMORY_OR_RESOURCE"
  | "TEMP_WRITE_FAILURE"
  | "PROCESSING_TIMEOUT"
  | "INVALID_FILENAME"
  | "MISSING_FILE"
  | "INVALID_REQUEST"
  | "THUMBNAIL_GENERATION_FAILED";

export type ArtworkSourceMetadata = {
  originalFilename: string;
  detectedFormat: SupportedArtworkImageFormat;
  width: number;
  height: number;
  pixelCount: number;
  colourspace: string | null;
  channels: number | null;
  hasAlpha: boolean;
  orientation: number | null;
  density: number | null;
  hasIccProfile: boolean;
  originalByteLength: number;
  pageCount: number | null;
  isMultiPage: boolean;
};

export type ProcessedImageOutput = {
  filename: string;
  width: number;
  height: number;
  byteLength: number;
  format: "jpeg";
  quality: number;
  /** True when the long edge was reduced for this derivative. */
  wasResized: boolean;
};

export type PlannedMasterInfo = {
  filename: string;
  extension: string;
  byteLength: number;
  /** Master is original bytes; not rewritten in this milestone. */
  preservedOriginalBytes: true;
};

/** Server/dev diagnostics only — not stored as artwork metadata. */
export type ArtworkImageProcessingTimings = {
  /** Metadata plus one pixel decode of the master (reused for all derivatives). */
  masterReadDecodeMs: number;
  hrGenerationMs: number;
  webGenerationMs: number;
  thumbnailGenerationMs: number;
  /** Wall clock of concurrent HR + web + thumbnail generation. */
  derivativesWallMs: number;
};

export type ArtworkImageProcessingResult = {
  source: ArtworkSourceMetadata;
  master: PlannedMasterInfo;
  hr: ProcessedImageOutput & { buffer: Buffer };
  web: ProcessedImageOutput & { buffer: Buffer };
  thumb: ProcessedImageOutput & { buffer: Buffer };
  warnings: string[];
  durationMs: number;
  timings: ArtworkImageProcessingTimings;
};

export type ArtworkImageProcessingFailure = {
  code: ArtworkImageProcessingErrorCode;
  message: string;
};

export type PlannedFilenamesInput = {
  master: string;
  hr: string;
  web: string;
  thumb: string;
};
