import {
  MAX_ARTWORKS_PER_BATCH,
  MAX_BATCH_BYTES,
  createArtworkDraft,
  requiresLargeFileDropboxIntake,
  type ArtworkDraft,
  type ArtworkImage,
  type BatchDraft,
  type BatchSharedDetails,
} from "@/lib/artwork/types";
import {
  evaluateSingleImage,
  formatFileSize,
  isTiffFile,
} from "@/lib/artwork/validation";
import { suggestTitleFromFilename } from "@/lib/artwork/suggest-title";

export type FileLike = {
  name: string;
  size: number;
  lastModified: number;
  type?: string;
};

export {
  suggestTitleFromFilename,
  type SuggestedTitle,
} from "@/lib/artwork/suggest-title";

/** Stable identity for duplicate detection (not content hashing). */
export function fileIdentityKey(file: FileLike): string {
  return `${file.name}\0${file.size}\0${file.lastModified}`;
}

export function totalBatchBytes(artworks: readonly ArtworkDraft[]): number {
  return artworks.reduce((sum, artwork) => {
    return sum + (artwork.image?.file.size ?? 0);
  }, 0);
}

export function revokeArtworkImagePreview(image: ArtworkImage | null): void {
  if (image?.previewUrl) {
    URL.revokeObjectURL(image.previewUrl);
  }
}

export function revokeArtworkDraftImage(artwork: ArtworkDraft): void {
  revokeArtworkImagePreview(artwork.image);
}

export function createArtworkImageFromFile(
  file: File,
  options?: { createPreviewUrl?: boolean },
): ArtworkImage {
  const tiff = isTiffFile(file);
  const createPreview = options?.createPreviewUrl ?? true;
  return {
    file,
    previewUrl: !tiff && createPreview ? URL.createObjectURL(file) : null,
    isTiff: tiff,
  };
}

export type DuplicateMatch = {
  file: File;
  existingArtworkId: string;
  existingFilename: string;
};

export type AppendFilesRejection =
  | { code: "unsupported"; file: File; message: string }
  | { code: "batch_too_large"; message: string }
  | { code: "batch_count"; message: string };

export type AppendFilesResult = {
  batch: BatchDraft;
  added: ArtworkDraft[];
  rejected: AppendFilesRejection[];
  duplicates: DuplicateMatch[];
  /** Files that are ready to add if the user confirms duplicates. */
  pendingDuplicates: File[];
};

function findDuplicateArtwork(
  artworks: readonly ArtworkDraft[],
  file: File,
): ArtworkDraft | undefined {
  const key = fileIdentityKey(file);
  return artworks.find((artwork) => {
    if (!artwork.image) return false;
    // Exact same File object reference
    if (artwork.image.file === file) return true;
    return fileIdentityKey(artwork.image.file) === key;
  });
}

/**
 * Append files as new artwork drafts at the end of the batch.
 * Does not mutate existing drafts. Order of accepted files is preserved.
 *
 * When duplicates are found and `allowDuplicates` is false, those files are
 * reported in `duplicates` / `pendingDuplicates` and not added.
 */
export function appendFilesToBatch(
  batch: BatchDraft,
  files: readonly File[],
  options?: {
    allowDuplicates?: boolean;
    createPreviewUrls?: boolean;
    shared?: BatchSharedDetails;
  },
): AppendFilesResult {
  const shared = options?.shared ?? batch.shared;
  const allowDuplicates = options?.allowDuplicates ?? false;
  const createPreviewUrls = options?.createPreviewUrls ?? true;

  const rejected: AppendFilesRejection[] = [];
  const duplicates: DuplicateMatch[] = [];
  const pendingDuplicates: File[] = [];
  const added: ArtworkDraft[] = [];
  const nextArtworks = [...batch.artworks];

  let runningBytes = totalBatchBytes(nextArtworks);

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]!;
    const existing = findDuplicateArtwork(nextArtworks, file);
    if (existing && !allowDuplicates) {
      duplicates.push({
        file,
        existingArtworkId: existing.id,
        existingFilename: existing.image?.file.name ?? file.name,
      });
      pendingDuplicates.push(file);
      continue;
    }

    // Count accepted drafts only. `nextArtworks` already includes files added
    // in this call — do not also add `added.length` or a 24-cap becomes 12.
    if (nextArtworks.length >= MAX_ARTWORKS_PER_BATCH) {
      const skipped = files.length - index;
      rejected.push({
        code: "batch_count",
        message:
          skipped === 1
            ? `A batch can include at most ${MAX_ARTWORKS_PER_BATCH} artworks.`
            : `A batch can include at most ${MAX_ARTWORKS_PER_BATCH} artworks. ${skipped} files were not added.`,
      });
      break;
    }

    const evaluated = evaluateSingleImage(file);
    if (!evaluated.ok) {
      rejected.push({
        code: "unsupported",
        file,
        message: evaluated.error,
      });
      continue;
    }

    const largeMaster = requiresLargeFileDropboxIntake(file.size);
    if (!largeMaster && runningBytes + file.size > MAX_BATCH_BYTES) {
      rejected.push({
        code: "batch_too_large",
        message: `Adding ${file.name} would exceed the ${formatFileSize(MAX_BATCH_BYTES)} batch limit.`,
      });
      continue;
    }

    const suggested = suggestTitleFromFilename(file.name);
    const image = createArtworkImageFromFile(evaluated.file, {
      createPreviewUrl: createPreviewUrls,
    });
    const draft = createArtworkDraft(shared, {
      image,
      title: suggested.title,
      titleSuggestedFromFilename: suggested.title.length > 0,
      titleArtistAliasRemoved: suggested.removedArtistAlias,
    });

    added.push(draft);
    nextArtworks.push(draft);
    if (!largeMaster) {
      runningBytes += file.size;
    }
  }

  return {
    batch: {
      ...batch,
      shared,
      artworks: nextArtworks,
    },
    added,
    rejected,
    duplicates,
    pendingDuplicates,
  };
}

/**
 * Replace the image on one artwork. Returns a new draft; caller must revoke
 * the previous preview URL and invalidate processing for this artwork only.
 */
export function replaceArtworkImage(
  artwork: ArtworkDraft,
  file: File,
  options?: { createPreviewUrl?: boolean },
):
  | { ok: true; artwork: ArtworkDraft; previousImage: ArtworkImage | null }
  | { ok: false; error: string } {
  const evaluated = evaluateSingleImage(file);
  if (!evaluated.ok) {
    return { ok: false, error: evaluated.error };
  }

  const suggested = suggestTitleFromFilename(evaluated.file.name);
  const image = createArtworkImageFromFile(evaluated.file, {
    createPreviewUrl: options?.createPreviewUrl ?? true,
  });

  const shouldRefreshSuggestedTitle =
    !artwork.isUntitled &&
    (artwork.titleSuggestedFromFilename || !artwork.title.trim());

  return {
    ok: true,
    previousImage: artwork.image,
    artwork: {
      ...artwork,
      image,
      title: shouldRefreshSuggestedTitle ? suggested.title : artwork.title,
      titleSuggestedFromFilename: shouldRefreshSuggestedTitle
        ? suggested.title.length > 0
        : false,
      titleArtistAliasRemoved: shouldRefreshSuggestedTitle
        ? suggested.removedArtistAlias
        : false,
    },
  };
}

export function reorderArtworks(
  artworks: readonly ArtworkDraft[],
  id: string,
  direction: -1 | 1,
): ArtworkDraft[] {
  const index = artworks.findIndex((artwork) => artwork.id === id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= artworks.length) {
    return [...artworks];
  }
  const next = [...artworks];
  const [item] = next.splice(index, 1);
  next.splice(nextIndex, 0, item);
  return next;
}

export function removeArtworkFromList(
  artworks: readonly ArtworkDraft[],
  id: string,
): { artworks: ArtworkDraft[]; removed: ArtworkDraft | null } {
  const removed = artworks.find((artwork) => artwork.id === id) ?? null;
  return {
    artworks: artworks.filter((artwork) => artwork.id !== id),
    removed,
  };
}

/** Clear processing state for a single artwork ID only. */
export function clearProcessingForArtwork<T>(
  processingByArtworkId: Record<string, T>,
  artworkId: string,
): Record<string, T> {
  if (!(artworkId in processingByArtworkId)) return processingByArtworkId;
  const next = { ...processingByArtworkId };
  delete next[artworkId];
  return next;
}

export function artworkNeedsMetadata(artwork: ArtworkDraft): boolean {
  return (
    (!artwork.isUntitled && !artwork.title.trim()) ||
    !artwork.year.trim() ||
    !artwork.medium.trim()
  );
}
