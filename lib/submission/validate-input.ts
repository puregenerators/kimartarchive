import {
  normalizeMedium,
  validateMediumValue,
} from "@/lib/artwork/medium";
import {
  DIMENSION_UNITS,
  MAX_ARTWORKS_PER_BATCH,
  MAX_BATCH_BYTES,
  MAX_FILE_BYTES,
  MAX_FILE_SIZE_LABEL,
  type ArtworkDraft,
  type BatchDraft,
  type BatchSharedDetails,
} from "@/lib/artwork/types";
import {
  UNTITLED_TITLE,
  isUntitledArtwork,
  resolveArtworkTitle,
} from "@/lib/artwork/untitled";
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
  if (!isUntitledArtwork(artwork) && !artwork.title.trim()) {
    return `Artwork order ${artwork.order}: Title is required.`;
  }
  const label = resolveArtworkTitle(artwork) || artwork.title;
  if (!/^\d{4}$/.test(artwork.year.trim())) {
    return `Artwork “${label}”: Year must be four digits.`;
  }
  const mediumError = validateMediumValue(artwork.medium);
  if (mediumError) {
    return `Artwork “${label}”: ${mediumError.replace(/\.$/, "")}.`;
  }
  if (artwork.height.trim() && !isPositiveNumber(artwork.height)) {
    return `Artwork “${label}”: Height must be a positive number when provided.`;
  }
  if (artwork.width.trim() && !isPositiveNumber(artwork.width)) {
    return `Artwork “${label}”: Width must be a positive number when provided.`;
  }
  if (artwork.depth.trim() && !isPositiveNumber(artwork.depth)) {
    return `Artwork “${label}”: Depth must be a positive number when provided.`;
  }
  if (
    !DIMENSION_UNITS.includes(
      artwork.dimensionUnit as (typeof DIMENSION_UNITS)[number],
    )
  ) {
    return `Artwork “${label}”: Dimension unit is invalid.`;
  }
  if (!file) {
    return `Artwork “${label}”: Exactly one source image is required.`;
  }
  if (!isSupportedImageFile(file)) {
    return `Artwork “${label}”: Source must be TIFF, JPEG, or PNG.`;
  }
  if (file.size > MAX_FILE_BYTES) {
    return `Artwork “${label}”: Source file exceeds the ${MAX_FILE_SIZE_LABEL} limit.`;
  }
  return null;
}

function resolveSubmissionArtwork(
  artwork: ArtworkSubmissionInput,
): ArtworkSubmissionInput {
  const { isUntitled, ...rest } = artwork;
  return {
    ...rest,
    title: isUntitled === true ? UNTITLED_TITLE : artwork.title.trim(),
    medium: normalizeMedium(artwork.medium),
  };
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
        .map(resolveSubmissionArtwork)
        .sort((a, b) => a.order - b.order),
    },
    filesByArtworkId,
    totalBytes,
  };
}

export type DeclaredArtworkFileInput = {
  clientArtworkId: string;
  filename: string;
  mimeType: string;
  byteLength: number;
};

/**
 * Server-side batch validation for the direct-to-Dropbox path.
 * Declared size/type are checked here; master bytes never reach this function.
 */
export function validateSubmissionBatchDeclared(params: {
  submissionAttemptId: string;
  shared: ArtworkBatchSubmissionInput["shared"];
  artworks: ArtworkSubmissionInput[];
  files: DeclaredArtworkFileInput[];
}):
  | {
      ok: true;
      input: ArtworkBatchSubmissionInput;
      filesByArtworkId: Map<string, DeclaredArtworkFileInput>;
      totalBytes: number;
    }
  | ServerBatchValidationFailure {
  const files: ServerArtworkFile[] = params.files.map((file) => ({
    clientArtworkId: file.clientArtworkId,
    file: {
      name: file.filename,
      type: file.mimeType,
      size: file.byteLength,
    } as File,
  }));
  const validated = validateSubmissionBatch({
    submissionAttemptId: params.submissionAttemptId,
    shared: params.shared,
    artworks: params.artworks,
    files,
  });
  if (!validated.ok) return validated;
  const filesByArtworkId = new Map<string, DeclaredArtworkFileInput>();
  for (const file of params.files) {
    filesByArtworkId.set(file.clientArtworkId, file);
  }
  return {
    ok: true,
    input: validated.input,
    filesByArtworkId,
    totalBytes: validated.totalBytes,
  };
}

/** Client helper: map local drafts into submission metadata (files sent separately). */
export function draftsToSubmissionArtworks(
  artworks: ArtworkDraft[],
): ArtworkSubmissionInput[] {
  return artworks.map((artwork, order) => ({
    clientArtworkId: artwork.id,
    order,
    title: resolveArtworkTitle(artwork) || artwork.title,
    ...(isUntitledArtwork(artwork) ? { isUntitled: true as const } : {}),
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
