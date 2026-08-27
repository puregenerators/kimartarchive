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
