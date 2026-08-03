import {
  normalizeMedium,
  validateMediumValue,
} from "@/lib/artwork/medium";
import {
  DIMENSION_UNITS,
  MAX_ARTWORKS_PER_BATCH,
  MAX_BATCH_BYTES,
  MAX_FILE_BYTES,
  type ArtworkDraft,
  type BatchDraft,
  type BatchSharedDetails,
} from "@/lib/artwork/types";
import { isSupportedImageFile } from "@/lib/artwork/validation";
import type {
  ArtworkBatchSubmissionInput,
  ArtworkSubmissionInput,
} from "@/lib/submission/types";

export type ServerArtworkFile = {
  clientArtworkId: string;
  file: File;
};

export type ServerBatchValidationFailure = {
  ok: false;
  message: string;
};

export type ServerBatchValidationSuccess = {
  ok: true;
  input: ArtworkBatchSubmissionInput;
  filesByArtworkId: Map<string, File>;
  totalBytes: number;
};

function isPositiveNumber(value: string): boolean {
  if (!value.trim()) return false;
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function validateArtworkInput(
  artwork: ArtworkSubmissionInput,
  file: File | undefined,
): string | null {
  if (!artwork.clientArtworkId.trim()) {
    return "Each artwork requires a stable client ID.";
  }
  if (!artwork.title.trim()) {
    return `Artwork order ${artwork.order}: Title is required.`;
  }
  if (!/^\d{4}$/.test(artwork.year.trim())) {
    return `Artwork “${artwork.title}”: Year must be four digits.`;
  }
  const mediumError = validateMediumValue(artwork.medium);
  if (mediumError) {
    return `Artwork “${artwork.title}”: ${mediumError.replace(/\.$/, "")}.`;
  }
  if (!isPositiveNumber(artwork.height)) {
    return `Artwork “${artwork.title}”: Height must be a positive number.`;
  }
  if (!isPositiveNumber(artwork.width)) {
    return `Artwork “${artwork.title}”: Width must be a positive number.`;
  }
  if (artwork.depth.trim() && !isPositiveNumber(artwork.depth)) {
    return `Artwork “${artwork.title}”: Depth must be a positive number when provided.`;
  }
  if (
    !DIMENSION_UNITS.includes(
      artwork.dimensionUnit as (typeof DIMENSION_UNITS)[number],
    )
  ) {
    return `Artwork “${artwork.title}”: Dimension unit is invalid.`;
  }
  if (!file) {
    return `Artwork “${artwork.title}”: Exactly one source image is required.`;
  }
  if (!isSupportedImageFile(file)) {
    return `Artwork “${artwork.title}”: Source must be TIFF, JPEG, or PNG.`;
  }
  if (file.size > MAX_FILE_BYTES) {
    return `Artwork “${artwork.title}”: Source file exceeds the 250 MB limit.`;
  }
  return null;
}

/**
 * Server-side batch validation. Do not trust browser-only validation.
 */
export function validateSubmissionBatch(params: {
  submissionAttemptId: string;
  shared: ArtworkBatchSubmissionInput["shared"];
  artworks: ArtworkSubmissionInput[];
  files: ServerArtworkFile[];
}): ServerBatchValidationSuccess | ServerBatchValidationFailure {
  const attemptId = params.submissionAttemptId?.trim() ?? "";
  if (!attemptId || attemptId.length < 8) {
    return {
      ok: false,
      message: "A valid submission-attempt ID is required.",
    };
  }

  if (params.artworks.length === 0) {
    return { ok: false, message: "Batch must contain at least one artwork." };
  }
  if (params.artworks.length > MAX_ARTWORKS_PER_BATCH) {
    return {
      ok: false,
      message: `Batch exceeds the maximum of ${MAX_ARTWORKS_PER_BATCH} artworks.`,
    };
  }

  const ids = params.artworks.map((a) => a.clientArtworkId);
  if (new Set(ids).size !== ids.length) {
    return {
      ok: false,
      message: "Duplicate artwork client IDs are not allowed.",
    };
  }

  const filesByArtworkId = new Map<string, File>();
  for (const entry of params.files) {
    if (filesByArtworkId.has(entry.clientArtworkId)) {
      return {
        ok: false,
        message: `Duplicate file association for artwork ${entry.clientArtworkId}.`,
      };
    }
    filesByArtworkId.set(entry.clientArtworkId, entry.file);
  }

  for (const artwork of params.artworks) {
    if (!filesByArtworkId.has(artwork.clientArtworkId)) {
      return {
        ok: false,
        message: `Missing source file for artwork “${artwork.title || artwork.clientArtworkId}”.`,
      };
    }
  }

  for (const fileId of filesByArtworkId.keys()) {
    if (!ids.includes(fileId)) {
      return {
        ok: false,
        message: "A file was submitted for an unknown artwork ID.",
      };
    }
  }

  let totalBytes = 0;
  for (const artwork of params.artworks) {
    const file = filesByArtworkId.get(artwork.clientArtworkId)!;
    const error = validateArtworkInput(artwork, file);
    if (error) return { ok: false, message: error };
    totalBytes += file.size;
  }

  if (totalBytes > MAX_BATCH_BYTES) {
    return {
      ok: false,
      message: "Total batch source size exceeds the 750 MB limit.",
    };
  }

  return {
    ok: true,
    input: {
      submissionAttemptId: attemptId,
      shared: params.shared,
      artworks: [...params.artworks]
        .map((artwork) => ({
          ...artwork,
          medium: normalizeMedium(artwork.medium),
        }))
        .sort((a, b) => a.order - b.order),
    },
    filesByArtworkId,
    totalBytes,
  };
}

/** Client helper: map local drafts into submission metadata (files sent separately). */
export function draftsToSubmissionArtworks(
  artworks: ArtworkDraft[],
): ArtworkSubmissionInput[] {
  return artworks.map((artwork, order) => ({
    clientArtworkId: artwork.id,
    order,
    title: artwork.title,
    year: artwork.year,
    medium: normalizeMedium(artwork.medium),
    height: artwork.height,
    width: artwork.width,
    depth: artwork.depth,
    dimensionUnit: artwork.dimensionUnit,
    notes: artwork.notes,
    overrides: { ...artwork.overrides },
    originalFilename: artwork.image?.file.name ?? "",
  }));
}

export function sharedToSubmissionShared(
  shared: BatchSharedDetails,
): ArtworkBatchSubmissionInput["shared"] {
  return {
    exhibition: shared.exhibition,
    gallery: shared.gallery,
    exhibitionYear: shared.exhibitionYear,
    photographer: shared.photographer,
  };
}

export function batchDraftToSubmissionPayload(batch: BatchDraft): {
  artworks: ArtworkSubmissionInput[];
  shared: ArtworkBatchSubmissionInput["shared"];
} {
  return {
    artworks: draftsToSubmissionArtworks(batch.artworks),
    shared: sharedToSubmissionShared(batch.shared),
  };
}
