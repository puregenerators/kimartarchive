import {
  ARTWORK_INVENTORY_HEADERS,
  type ArtworkInventoryHeader,
} from "@/lib/google/headers";
import { sheetCompatibleNumber } from "@/lib/submission/claim-logic";
import type { ResolvedArtworkMetadata } from "@/lib/submission/types";

/** Provider-neutral file/folder URLs written into Artwork Inventory columns. */
export type InventoryRowFileLinks = {
  masterFilename: string;
  masterFileUrl: string;
  hrFilename: string;
  hrFileUrl: string;
  webFilename: string;
  webFileUrl: string;
  artworkFolderUrl: string;
};

/** @deprecated Use InventoryRowFileLinks — kept as an alias for call-site clarity. */
export type InventoryRowDriveLinks = InventoryRowFileLinks;

/**
 * Build one Artwork Inventory row in exact expected header order.
 * Blank optional values remain blank. Never relies on object key iteration.
 * Drive and Dropbox both write into the same neutral URL columns.
 * Thumbnail is a display formula only — not filename/URL metadata.
 */
export function buildArtworkInventoryRow(params: {
  inventoryId: number;
  metadata: ResolvedArtworkMetadata;
  links: InventoryRowFileLinks;
  thumbnailFormula: string;
  createdAt: string;
  updatedAt?: string;
}): string[] {
  const { inventoryId, metadata, links } = params;
  const updatedAt = params.updatedAt ?? params.createdAt;

  const byHeader: Record<ArtworkInventoryHeader, string | number> = {
    "Inventory ID": inventoryId,
    Thumbnail: params.thumbnailFormula,
    Title: metadata.title,
    Year: metadata.year,
    Medium: metadata.medium,
    Height: sheetCompatibleNumber(metadata.height),
    Width: sheetCompatibleNumber(metadata.width),
    Depth: sheetCompatibleNumber(metadata.depth),
    "Dimension Unit": metadata.dimensionUnit,
    Photographer: metadata.photographer,
    Exhibition: metadata.exhibition,
    "Gallery / Venue": metadata.gallery,
    Notes: metadata.notes,
    "Master Filename": links.masterFilename,
    "Master File URL": links.masterFileUrl,
    "High Resolution Filename": links.hrFilename,
    "High Resolution File URL": links.hrFileUrl,
    "Web Filename": links.webFilename,
    "Web File URL": links.webFileUrl,
    "Artwork Folder URL": links.artworkFolderUrl,
    "Created At": params.createdAt,
    "Updated At": updatedAt,
  };

  return ARTWORK_INVENTORY_HEADERS.map((header) => {
    const value = byHeader[header];
    return value == null ? "" : String(value);
  });
}

export function assertInventoryRowHeaderOrder(row: string[]): void {
  if (row.length !== ARTWORK_INVENTORY_HEADERS.length) {
    throw new Error(
      `Inventory row length ${row.length} !== ${ARTWORK_INVENTORY_HEADERS.length}`,
    );
  }
}
