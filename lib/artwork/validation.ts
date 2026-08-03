import { validateMediumValue } from "@/lib/artwork/medium";
import {
  DIMENSION_UNITS,
  MAX_ARTWORKS_PER_BATCH,
  MAX_BATCH_BYTES,
  MAX_FILE_BYTES,
  formatArtworkNumber,
  type ArtworkDraft,
  type ArtworkValidationErrors,
  type BatchDraft,
  type BatchValidationResult,
} from "@/lib/artwork/types";

function totalBatchBytes(artworks: readonly ArtworkDraft[]): number {
  return artworks.reduce((sum, artwork) => {
    return sum + (artwork.image?.file.size ?? 0);
  }, 0);
}

function isPositiveNumber(value: string): boolean {
  if (!value.trim()) return false;
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

export function isSupportedImageFile(file: File): boolean {
  const name = file.name.toLowerCase();
  const extOk =
    name.endsWith(".tif") ||
    name.endsWith(".tiff") ||
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg") ||
    name.endsWith(".png");

  const type = file.type.toLowerCase();
  const mimeOk =
    !type ||
    type === "image/tiff" ||
    type === "image/jpeg" ||
    type === "image/png" ||
    type === "image/x-tiff";

  return extOk && mimeOk;
}

export function isTiffFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".tif") ||
    name.endsWith(".tiff") ||
    file.type === "image/tiff" ||
    file.type === "image/x-tiff"
  );
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function describeImageType(file: File): string {
  const name = file.name.toLowerCase();
  if (name.endsWith(".tif") || name.endsWith(".tiff")) return "TIFF";
  if (name.endsWith(".png")) return "PNG";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "JPEG";
  if (file.type === "image/tiff") return "TIFF";
  if (file.type === "image/png") return "PNG";
  if (file.type === "image/jpeg") return "JPEG";
  return file.type || "Unknown";
}

export type SingleImageResult =
  | { ok: true; file: File }
  | { ok: false; error: string };

export function evaluateSingleImage(file: File | undefined): SingleImageResult {
  if (!file) {
    return { ok: false, error: "No file was selected." };
  }

  if (!isSupportedImageFile(file)) {
    return {
      ok: false,
      error: `Unsupported file type. Use TIFF, JPEG, or PNG only. (${file.name})`,
    };
  }

  if (file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      error: `${file.name} exceeds the 250 MB per-file limit (${formatFileSize(file.size)}).`,
    };
  }

  return { ok: true, file };
}

export function validateArtworkDraft(
  artwork: ArtworkDraft,
): ArtworkValidationErrors {
  const errors: ArtworkValidationErrors = {};

  if (!artwork.title.trim()) {
    errors.title = "Title is required.";
  }

  if (!/^\d{4}$/.test(artwork.year.trim())) {
    errors.year = "Year must be a four-digit number.";
  }

  const mediumError = validateMediumValue(artwork.medium);
  if (mediumError) {
    errors.medium = mediumError;
  }

  if (!isPositiveNumber(artwork.height)) {
    errors.height = "Height must be a positive number.";
  }

  if (!isPositiveNumber(artwork.width)) {
    errors.width = "Width must be a positive number.";
  }

  if (artwork.depth.trim() && !isPositiveNumber(artwork.depth)) {
    errors.depth = "Depth must be a positive number when provided.";
  }

  if (!DIMENSION_UNITS.includes(artwork.dimensionUnit)) {
    errors.dimensionUnit = "Dimension unit must be in or cm.";
  }

  if (!artwork.image) {
    errors.image = "Add exactly one master image (TIFF, JPEG, or PNG).";
  } else if (!isSupportedImageFile(artwork.image.file)) {
    errors.image = `Unsupported file: ${artwork.image.file.name}.`;
  } else if (artwork.image.file.size > MAX_FILE_BYTES) {
    errors.image = `${artwork.image.file.name} exceeds the 250 MB limit.`;
  }

  return errors;
}

function firstArtworkErrorMessage(
  errors: ArtworkValidationErrors,
): string {
  if (errors.title) return errors.title.replace(/\.$/, "");
  if (errors.year) return errors.year.replace(/\.$/, "");
  if (errors.medium) return errors.medium.replace(/\.$/, "");
  if (errors.height) return errors.height.replace(/\.$/, "");
  if (errors.width) return errors.width.replace(/\.$/, "");
  if (errors.depth) return errors.depth.replace(/\.$/, "");
  if (errors.dimensionUnit) return errors.dimensionUnit.replace(/\.$/, "");
  if (errors.image) {
    if (errors.image.toLowerCase().includes("unsupported")) {
      return "Unsupported image type";
    }
    return errors.image.replace(/\.$/, "");
  }
  return "Has validation errors";
}

export function validateBatch(batch: BatchDraft): BatchValidationResult {
  const artworks: BatchValidationResult["artworks"] = {};

  if (batch.artworks.length === 0) {
    return {
      form: "Upload at least one artwork image to continue.",
      artworks,
    };
  }

  if (batch.artworks.length > MAX_ARTWORKS_PER_BATCH) {
    return {
      form: `A batch can include at most ${MAX_ARTWORKS_PER_BATCH} artworks (currently ${batch.artworks.length}).`,
      artworks,
    };
  }

  const totalBytes = totalBatchBytes(batch.artworks);
  if (totalBytes > MAX_BATCH_BYTES) {
    return {
      form: `Total batch size ${formatFileSize(totalBytes)} exceeds the ${formatFileSize(MAX_BATCH_BYTES)} limit.`,
      artworks,
    };
  }

  batch.artworks.forEach((artwork) => {
    const errors = validateArtworkDraft(artwork);
    if (Object.keys(errors).length > 0) {
      artworks[artwork.id] = errors;
    }
  });

  const invalidCount = Object.keys(artworks).length;
  if (invalidCount === 0) {
    return { artworks };
  }

  const summaryParts = batch.artworks
    .map((artwork, index) => {
      const errors = artworks[artwork.id];
      if (!errors) return null;
      return `Artwork ${formatArtworkNumber(index)}: ${firstArtworkErrorMessage(errors)}`;
    })
    .filter(Boolean);

  return {
    form: `Please fix ${invalidCount} artwork${invalidCount === 1 ? "" : "s"} before reviewing. ${summaryParts.join(" · ")}`,
    artworks,
  };
}

export function hasBatchErrors(result: BatchValidationResult): boolean {
  return Boolean(result.form) || Object.keys(result.artworks).length > 0;
}

export function formatDimensions(artwork: {
  height: string;
  width: string;
  depth: string;
  dimensionUnit: string;
}): string {
  const unit = artwork.dimensionUnit;
  const h = artwork.height.trim();
  const w = artwork.width.trim();
  const d = artwork.depth.trim();

  if (d) {
    return `${h} × ${w} × ${d} ${unit}`;
  }
  return `${h} × ${w} ${unit}`;
}
