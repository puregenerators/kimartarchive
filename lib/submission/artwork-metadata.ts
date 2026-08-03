/**
 * Portable per-artwork metadata file — archival backup beside image files.
 * Google Sheets remains the primary inventory database; this file travels
 * with the folder for future migration / rebuild / DAM import.
 *
 * Filename is Inventory-ID based (`{inventoryId}_metadata.json`) so the
 * record remains identifiable if copied outside its artwork folder.
 */

import { buildArtworkMetadataFilename } from "@/lib/artwork/filenames";
import type { DriveResourceRef, ResolvedArtworkMetadata } from "@/lib/submission/types";

export const ARTWORK_METADATA_MIME_TYPE = "application/json";
export const ARTWORK_METADATA_SCHEMA_VERSION = 1 as const;

export { buildArtworkMetadataFilename };

export type ArtworkMetadataFileRef = {
  filename: string;
  url: string;
};

/**
 * Portable archive metadata record (schemaVersion 1).
 * Optional / blank fields are JSON null, never empty strings.
 */
export type PortableArtworkMetadata = {
  schemaVersion: typeof ARTWORK_METADATA_SCHEMA_VERSION;
  inventoryId: number;
  title: string;
  year: number | null;
  medium: string | null;
  dimensions: {
    height: number | null;
    width: number | null;
    depth: number | null;
    unit: string | null;
  };
  photographer: string | null;
  exhibition: string | null;
  galleryVenue: string | null;
  notes: string | null;
  files: {
    master: ArtworkMetadataFileRef;
    highResolution: ArtworkMetadataFileRef;
    web: ArtworkMetadataFileRef;
    /** Self-reference: Inventory-ID-based metadata filename. */
    metadata: {
      filename: string;
    };
    folderUrl: string;
  };
  createdAt: string;
  updatedAt: string;
};

function nullIfBlank(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseOptionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function parseYear(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d{4}$/.test(trimmed)) return null;
  return Number(trimmed);
}

export function buildPortableArtworkMetadata(params: {
  inventoryId: number;
  metadata: ResolvedArtworkMetadata;
  master: DriveResourceRef;
  hr: DriveResourceRef;
  web: DriveResourceRef;
  folder: DriveResourceRef;
  /** Planned Inventory-ID-based metadata filename. */
  metadataFilename: string;
  createdAt: string;
  updatedAt?: string;
}): PortableArtworkMetadata {
  const { metadata } = params;
  const updatedAt = params.updatedAt ?? params.createdAt;

  return {
    schemaVersion: ARTWORK_METADATA_SCHEMA_VERSION,
    inventoryId: params.inventoryId,
    title: metadata.title.trim(),
    year: parseYear(metadata.year),
    medium: nullIfBlank(metadata.medium),
    dimensions: {
      height: parseOptionalNumber(metadata.height),
      width: parseOptionalNumber(metadata.width),
      depth: parseOptionalNumber(metadata.depth),
      unit: nullIfBlank(metadata.dimensionUnit),
    },
    photographer: nullIfBlank(metadata.photographer),
    exhibition: nullIfBlank(metadata.exhibition),
    galleryVenue: nullIfBlank(metadata.gallery),
    notes: nullIfBlank(metadata.notes),
    files: {
      master: {
        filename: params.master.name,
        url: params.master.webViewLink,
      },
      highResolution: {
        filename: params.hr.name,
        url: params.hr.webViewLink,
      },
      web: {
        filename: params.web.name,
        url: params.web.webViewLink,
      },
      metadata: {
        filename: params.metadataFilename,
      },
      folderUrl: params.folder.webViewLink,
    },
    createdAt: params.createdAt,
    updatedAt,
  };
}

/** Human-readable UTF-8 JSON for the portable metadata file. */
export function serializePortableArtworkMetadata(
  metadata: PortableArtworkMetadata,
): string {
  return JSON.stringify(metadata, null, 2);
}

export function portableArtworkMetadataBuffer(
  metadata: PortableArtworkMetadata,
): Buffer {
  return Buffer.from(serializePortableArtworkMetadata(metadata), "utf8");
}
