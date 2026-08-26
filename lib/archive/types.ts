/**
 * Read-only artwork archive types.
 * Google Sheets remains the catalog; these records are derived per request.
 */

export type ArchiveArtwork = {
  inventoryId: number;
  title: string;
  year: string;
  medium: string;
  height: string;
  width: string;
  depth: string;
  dimensionUnit: string;
  photographer: string;
  exhibition: string;
  gallery: string;
  notes: string;
  masterFilename: string;
  /** Canonical stored shared URL from the Sheet. */
  masterFileUrl: string;
  hrFilename: string;
  hrFileUrl: string;
  webFilename: string;
  /** Canonical stored Web File URL. Never rewritten for display. */
  webFileUrl: string;
  /**
   * Derived browser-renderable image URL.
   * Null when the web preview should use a placeholder.
   */
  webFileDisplayUrl: string | null;
  artworkFolderUrl: string;
  createdAt: string;
  updatedAt: string;
};

export type ArchiveWarningCode =
  | "malformed_row"
  | "duplicate_inventory_id"
  | "missing_required_headers";

export type ArchiveWarning = {
  code: ArchiveWarningCode;
  message: string;
  sheetRowNumber?: number;
  inventoryId?: number;
};

export type ArchiveYearGroup = {
  year: string;
  artworks: ArchiveArtwork[];
};

export type InventoryTable = {
  headers: string[];
  rows: string[][];
};

export type ArchiveStats = {
  /** Non-blank data rows examined (header excluded). */
  dataRowCount: number;
  blankRowCount: number;
  displayedCount: number;
  missingPreviewCount: number;
  malformedCount: number;
  duplicateIdCount: number;
};

export type ArchiveParseResult = {
  /** Valid records (ID + title + year), including any duplicate IDs. */
  records: ArchiveArtwork[];
  warnings: ArchiveWarning[];
  blankRowCount: number;
  dataRowCount: number;
  duplicateInventoryIds: number[];
};

export type ArchiveCatalog = {
  /** Unique valid records; duplicate Inventory IDs are omitted. */
  artworks: ArchiveArtwork[];
  groups: ArchiveYearGroup[];
  warnings: ArchiveWarning[];
  duplicateInventoryIds: number[];
  stats: ArchiveStats;
};

export type ArchiveLoadSuccess = {
  ok: true;
  catalog: ArchiveCatalog;
};

export type ArchiveLoadFailure = {
  ok: false;
  message: string;
};

export type ArchiveLoadResult = ArchiveLoadSuccess | ArchiveLoadFailure;

export type ArchiveLookupResult =
  | { kind: "found"; artwork: ArchiveArtwork }
  | { kind: "not_found" }
  | { kind: "duplicate"; inventoryId: number };
