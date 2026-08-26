import type { ArtworkDraft } from "@/lib/artwork/types";

/** Canonical archived title for works explicitly marked as having no known title. */
export const UNTITLED_TITLE = "Untitled";

export function isUntitledArtwork(artwork: { isUntitled?: boolean }): boolean {
  return artwork.isUntitled === true;
}

/**
 * Title that will be archived, shown in review, and used in filenames.
 * Blank titles are not converted to Untitled unless `isUntitled` is true.
 */
export function resolveArtworkTitle(artwork: {
  title: string;
  isUntitled?: boolean;
}): string {
  if (isUntitledArtwork(artwork)) return UNTITLED_TITLE;
  return artwork.title.trim();
}

/** Non-empty title that would be replaced by a batch Untitled apply. */
export function artworkHasTitleToOverwrite(artwork: ArtworkDraft): boolean {
  return !isUntitledArtwork(artwork) && artwork.title.trim().length > 0;
}

/**
 * Mark or unmark an artwork as untitled.
 * The typed/suggested `title` is preserved so unchecking can restore it.
 */
export function setArtworkUntitled(
  artwork: ArtworkDraft,
  isUntitled: boolean,
): ArtworkDraft {
  if (artwork.isUntitled === isUntitled) return artwork;
  return { ...artwork, isUntitled };
}

export function applyUntitledToSelectedArtworks(
  artworks: readonly ArtworkDraft[],
  selectedIds: readonly string[],
  options?: { overwriteTitled?: boolean },
): {
  artworks: ArtworkDraft[];
  blocked: ArtworkDraft[];
} {
  const selected = new Set(selectedIds);
  const blocked = artworks.filter(
    (artwork) => selected.has(artwork.id) && artworkHasTitleToOverwrite(artwork),
  );

  if (blocked.length > 0 && options?.overwriteTitled !== true) {
    return { artworks: [...artworks], blocked: [...blocked] };
  }

  return {
    artworks: artworks.map((artwork) =>
      selected.has(artwork.id) ? setArtworkUntitled(artwork, true) : artwork,
    ),
    blocked: [],
  };
}
