/**
 * Read-only archive presentation helpers.
 * Keep visual catalog logic out of Sheet parsing.
 */

import { formatArchiveDimensions } from "@/lib/archive/dimensions";
import type { ArchiveArtwork } from "@/lib/archive/types";

/** Years shown before collapsing the rest into More. */
export const YEAR_NAV_PRIMARY_COUNT = 5;

export function uniqueYearsDescending(
  artworks: readonly Pick<ArchiveArtwork, "year">[],
): string[] {
  return [...new Set(artworks.map((artwork) => artwork.year))].sort(
    (a, b) => Number(b) - Number(a),
  );
}

export function splitYearNavigation(
  years: readonly string[],
  primaryCount: number = YEAR_NAV_PRIMARY_COUNT,
): { primary: string[]; more: string[] } {
  if (years.length <= primaryCount) {
    return { primary: [...years], more: [] };
  }
  return {
    primary: years.slice(0, primaryCount),
    more: years.slice(primaryCount),
  };
}

export function yearSectionId(year: string): string {
  return `year-${year}`;
}

export function formatYearArtworkCount(count: number): string {
  return count === 1 ? "1 artwork" : `${count} artworks`;
}

export function artworkPreviewAlt(artwork: {
  title: string;
  inventoryId: number;
}): string {
  return `${artwork.title}, ${artwork.inventoryId}`;
}

export function formatInventoryId(inventoryId: number): string {
  return String(inventoryId);
}

export type ArchiveFileLink = {
  href: string;
  label: string;
};

/**
 * Detail-page file actions. Hrefs are the canonical stored URLs from the Sheet.
 */
export function archiveFileLinks(artwork: ArchiveArtwork): ArchiveFileLink[] {
  const links: Array<{ href: string; label: string } | null> = [
    artwork.artworkFolderUrl
      ? { href: artwork.artworkFolderUrl, label: "View image folder in Dropbox" }
      : null,
    artwork.masterFileUrl
      ? { href: artwork.masterFileUrl, label: "Master TIFF" }
      : null,
    artwork.hrFileUrl
      ? { href: artwork.hrFileUrl, label: "High Resolution JPG" }
      : null,
    artwork.webFileUrl ? { href: artwork.webFileUrl, label: "Web JPG" } : null,
  ];
  return links.filter((item): item is ArchiveFileLink => item != null);
}

/** Unlabeled facts shown under the detail image. Empty values omitted. */
export function archivePrimaryFacts(artwork: ArchiveArtwork): string[] {
  return [artwork.year, artwork.medium, formatArchiveDimensions(artwork)].filter(
    (value) => value.length > 0,
  );
}

export type ArchiveLabeledField = {
  label: string;
  value: string;
};

/** Labeled editorial fields. Blank values omitted entirely. */
export function archiveLabeledFields(
  artwork: ArchiveArtwork,
): ArchiveLabeledField[] {
  return (
    [
      { label: "Exhibition", value: artwork.exhibition },
      { label: "Gallery / Venue", value: artwork.gallery },
      { label: "Photographer", value: artwork.photographer },
      { label: "Notes", value: artwork.notes },
    ] satisfies ArchiveLabeledField[]
  ).filter((field) => field.value.length > 0);
}

/**
 * Future collection / ownership fields. Empty until Artwork Management exists.
 * The detail page must not render Collection Information while this is empty.
 */
export function archiveCollectionFields(): ArchiveLabeledField[] {
  return [];
}
