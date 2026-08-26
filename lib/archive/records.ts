import { webFileDisplayUrlFromCanonical } from "@/lib/archive/dropbox-display-url";
import type {
  ArchiveArtwork,
  ArchiveCatalog,
  ArchiveLookupResult,
  ArchiveParseResult,
  ArchiveWarning,
  ArchiveYearGroup,
  InventoryTable,
} from "@/lib/archive/types";

export const REQUIRED_ARCHIVE_HEADERS = [
  "Inventory ID",
  "Title",
  "Year",
] as const;

export function parseInventoryId(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value <= 0) return null;
  return value;
}

export function parseInventoryIdParam(raw: string): number | null {
  return parseInventoryId(raw);
}

export function isValidArchiveYear(raw: string): boolean {
  return /^\d{4}$/.test(raw.trim());
}

function isBlankDataRow(row: readonly string[]): boolean {
  return row.every((cell) => !String(cell ?? "").trim());
}

function headerIndexMap(headers: readonly string[]): Map<string, number> {
  const map = new Map<string, number>();
  headers.forEach((header, index) => {
    const name = String(header ?? "").trim();
    if (name && !map.has(name)) {
      map.set(name, index);
    }
  });
  return map;
}

function cellAt(
  row: readonly string[],
  indexMap: Map<string, number>,
  header: string,
): string {
  const index = indexMap.get(header);
  if (index == null) return "";
  return String(row[index] ?? "").trim();
}

function missingRequiredHeaders(indexMap: Map<string, number>): string[] {
  return REQUIRED_ARCHIVE_HEADERS.filter((header) => !indexMap.has(header));
}

function mapRowToArtwork(
  row: readonly string[],
  indexMap: Map<string, number>,
):
  | { ok: true; artwork: ArchiveArtwork }
  | { ok: false; reason: string; inventoryId?: number } {
  const inventoryRaw = cellAt(row, indexMap, "Inventory ID");
  const title = cellAt(row, indexMap, "Title");
  const year = cellAt(row, indexMap, "Year");
  const inventoryId = parseInventoryId(inventoryRaw);

  if (inventoryId == null && !title && !isValidArchiveYear(year)) {
    return { ok: false, reason: "missing Inventory ID, title, and year" };
  }
  if (inventoryId == null) {
    return { ok: false, reason: "missing or invalid Inventory ID" };
  }
  if (!title) {
    return { ok: false, reason: "missing title", inventoryId };
  }
  if (!isValidArchiveYear(year)) {
    return { ok: false, reason: "missing or invalid year", inventoryId };
  }

  const webFileUrl = cellAt(row, indexMap, "Web File URL");

  return {
    ok: true,
    artwork: {
      inventoryId,
      title,
      year: year.trim(),
      medium: cellAt(row, indexMap, "Medium"),
      height: cellAt(row, indexMap, "Height"),
      width: cellAt(row, indexMap, "Width"),
      depth: cellAt(row, indexMap, "Depth"),
      dimensionUnit: cellAt(row, indexMap, "Dimension Unit"),
      photographer: cellAt(row, indexMap, "Photographer"),
      exhibition: cellAt(row, indexMap, "Exhibition"),
      gallery: cellAt(row, indexMap, "Gallery / Venue"),
      notes: cellAt(row, indexMap, "Notes"),
      masterFilename: cellAt(row, indexMap, "Master Filename"),
      masterFileUrl: cellAt(row, indexMap, "Master File URL"),
      hrFilename: cellAt(row, indexMap, "High Resolution Filename"),
      hrFileUrl: cellAt(row, indexMap, "High Resolution File URL"),
      webFilename: cellAt(row, indexMap, "Web Filename"),
      webFileUrl,
      webFileDisplayUrl: webFileUrl
        ? webFileDisplayUrlFromCanonical(webFileUrl)
        : null,
      artworkFolderUrl: cellAt(row, indexMap, "Artwork Folder URL"),
      createdAt: cellAt(row, indexMap, "Created At"),
      updatedAt: cellAt(row, indexMap, "Updated At"),
    },
  };
}

export function parseArtworkInventoryRecords(
  table: InventoryTable,
): ArchiveParseResult {
  const indexMap = headerIndexMap(table.headers);
  const missing = missingRequiredHeaders(indexMap);
  const warnings: ArchiveWarning[] = [];

  if (missing.length > 0) {
    return {
      records: [],
      warnings: [
        {
          code: "missing_required_headers",
          message: `Artwork Inventory is missing required columns: ${missing.join(", ")}.`,
        },
      ],
      blankRowCount: 0,
      dataRowCount: 0,
      duplicateInventoryIds: [],
    };
  }

  const records: ArchiveArtwork[] = [];
  let blankRowCount = 0;
  let dataRowCount = 0;

  table.rows.forEach((row, index) => {
    const sheetRowNumber = index + 2;
    try {
      if (isBlankDataRow(row)) {
        blankRowCount += 1;
        return;
      }
      dataRowCount += 1;
      const mapped = mapRowToArtwork(row, indexMap);
      if (!mapped.ok) {
        warnings.push({
          code: "malformed_row",
          message: `Row ${sheetRowNumber} was skipped (${mapped.reason}).`,
          sheetRowNumber,
          inventoryId: mapped.inventoryId,
        });
        return;
      }
      records.push(mapped.artwork);
    } catch {
      dataRowCount += 1;
      warnings.push({
        code: "malformed_row",
        message: `Row ${sheetRowNumber} was skipped because it could not be read.`,
        sheetRowNumber,
      });
    }
  });

  const counts = new Map<number, number>();
  for (const record of records) {
    counts.set(record.inventoryId, (counts.get(record.inventoryId) ?? 0) + 1);
  }
  const duplicateInventoryIds = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id)
    .sort((a, b) => a - b);

  for (const inventoryId of duplicateInventoryIds) {
    warnings.push({
      code: "duplicate_inventory_id",
      message: `Inventory ID ${inventoryId} appears more than once and was omitted from the archive.`,
      inventoryId,
    });
  }

  return {
    records,
    warnings,
    blankRowCount,
    dataRowCount,
    duplicateInventoryIds,
  };
}

export function displayedArchiveArtworks(
  parsed: ArchiveParseResult,
): ArchiveArtwork[] {
  const duplicates = new Set(parsed.duplicateInventoryIds);
  return parsed.records.filter(
    (artwork) => !duplicates.has(artwork.inventoryId),
  );
}

export function groupArtworksByYear(
  artworks: readonly ArchiveArtwork[],
): ArchiveYearGroup[] {
  const byYear = new Map<string, ArchiveArtwork[]>();
  for (const artwork of artworks) {
    const list = byYear.get(artwork.year) ?? [];
    list.push(artwork);
    byYear.set(artwork.year, list);
  }

  const years = [...byYear.keys()].sort((a, b) => Number(b) - Number(a));
  return years.map((year) => ({
    year,
    artworks: (byYear.get(year) ?? [])
      .slice()
      .sort((a, b) => a.inventoryId - b.inventoryId),
  }));
}

export function searchArchiveArtworks(
  artworks: readonly ArchiveArtwork[],
  query: string,
): readonly ArchiveArtwork[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return artworks;

  return artworks.filter((artwork) => {
    const haystacks = [
      artwork.title,
      String(artwork.inventoryId),
      artwork.year,
      artwork.medium,
      artwork.exhibition,
      artwork.gallery,
    ];
    return haystacks.some((value) => value.toLowerCase().includes(needle));
  });
}

export function filterArchiveArtworks(
  artworks: readonly ArchiveArtwork[],
  filters: { year?: string; medium?: string },
): readonly ArchiveArtwork[] {
  const year = filters.year?.trim() ?? "";
  const medium = filters.medium?.trim() ?? "";
  if (!year && !medium) return artworks;
  return artworks.filter((artwork) => {
    if (year && artwork.year !== year) return false;
    if (medium && artwork.medium !== medium) return false;
    return true;
  });
}

export function findArtworkByInventoryId(
  records: readonly ArchiveArtwork[],
  inventoryId: number,
): ArchiveLookupResult {
  if (!Number.isInteger(inventoryId) || inventoryId <= 0) {
    return { kind: "not_found" };
  }
  const matches = records.filter(
    (artwork) => artwork.inventoryId === inventoryId,
  );
  if (matches.length === 0) return { kind: "not_found" };
  if (matches.length > 1) {
    return { kind: "duplicate", inventoryId };
  }
  return { kind: "found", artwork: matches[0]! };
}

export function lookupCatalogArtwork(
  catalog: ArchiveCatalog,
  inventoryId: number,
): ArchiveLookupResult {
  if (catalog.duplicateInventoryIds.includes(inventoryId)) {
    return { kind: "duplicate", inventoryId };
  }
  return findArtworkByInventoryId(catalog.artworks, inventoryId);
}

export function buildArchiveCatalog(table: InventoryTable): ArchiveCatalog {
  const parsed = parseArtworkInventoryRecords(table);
  const artworks = displayedArchiveArtworks(parsed);
  const groups = groupArtworksByYear(artworks);
  const missingPreviewCount = artworks.filter(
    (artwork) => !artwork.webFileDisplayUrl,
  ).length;
  const malformedCount = parsed.warnings.filter(
    (warning) => warning.code === "malformed_row",
  ).length;

  return {
    artworks,
    groups,
    warnings: parsed.warnings,
    duplicateInventoryIds: parsed.duplicateInventoryIds,
    stats: {
      dataRowCount: parsed.dataRowCount,
      blankRowCount: parsed.blankRowCount,
      displayedCount: artworks.length,
      missingPreviewCount,
      malformedCount,
      duplicateIdCount: parsed.duplicateInventoryIds.length,
    },
  };
}

export type { ArchiveParseResult };
