export const ARTWORK_INVENTORY_TAB = "Artwork Inventory";
export const INVENTORY_CLAIMS_TAB = "Inventory Claims";

export const ARTWORK_INVENTORY_THUMBNAIL_HEADER = "Thumbnail" as const;

/**
 * Columns after Inventory ID, excluding the Thumbnail display column.
 * Shared so the live schema and the pre-Thumbnail schema stay aligned.
 */
const ARTWORK_INVENTORY_HEADERS_AFTER_TITLE = [
  "Title",
  "Year",
  "Medium",
  "Height",
  "Width",
  "Depth",
  "Dimension Unit",
  "Photographer",
  "Exhibition",
  "Gallery / Venue",
  "Notes",
  "Master Filename",
  "Master File URL",
  "High Resolution Filename",
  "High Resolution File URL",
  "Web Filename",
  "Web File URL",
  "Artwork Folder URL",
  "Created At",
  "Updated At",
] as const;

/**
 * Live Artwork Inventory schema immediately before the Thumbnail column
 * was added (21 columns). Used by the Thumbnail insert migration.
 */
export const ARTWORK_INVENTORY_HEADERS_BEFORE_THUMBNAIL = [
  "Inventory ID",
  ...ARTWORK_INVENTORY_HEADERS_AFTER_TITLE,
] as const;

export const ARTWORK_INVENTORY_HEADERS = [
  "Inventory ID",
  ARTWORK_INVENTORY_THUMBNAIL_HEADER,
  ...ARTWORK_INVENTORY_HEADERS_AFTER_TITLE,
] as const;

export const INVENTORY_CLAIMS_HEADERS = [
  "Claim ID",
  "Inventory ID",
  "Status",
  "Created At",
  "Completed At",
] as const;

export type ArtworkInventoryHeader =
  (typeof ARTWORK_INVENTORY_HEADERS)[number];

/** 0-based index of a live Artwork Inventory header. */
export function artworkInventoryColumnIndex(
  header: ArtworkInventoryHeader,
): number {
  return ARTWORK_INVENTORY_HEADERS.indexOf(header);
}

export const ARTWORK_INVENTORY_THUMBNAIL_COLUMN_INDEX =
  artworkInventoryColumnIndex(ARTWORK_INVENTORY_THUMBNAIL_HEADER);

export type HeaderStatusKind =
  | "missing_tab"
  | "blank"
  | "match"
  | "mismatch";

export type HeaderComparison = {
  kind: HeaderStatusKind;
  expected: readonly string[];
  actual: string[];
  missingHeaders: string[];
  unexpectedHeaders: string[];
  orderMismatch: boolean;
};

export function isBlankHeaderRow(row: string[] | null | undefined): boolean {
  if (!row || row.length === 0) return true;
  return row.every((cell) => !String(cell ?? "").trim());
}

export function normalizeHeaderRow(row: string[] | null | undefined): string[] {
  if (!row) return [];
  // Trim trailing empty cells that Sheets often returns
  const cells = row.map((cell) => String(cell ?? "").trim());
  let end = cells.length;
  while (end > 0 && cells[end - 1] === "") {
    end -= 1;
  }
  return cells.slice(0, end);
}

export function headersEqual(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((header, index) => header === expected[index])
  );
}

export function compareHeaders(
  actualRaw: string[] | null | undefined,
  expected: readonly string[],
): HeaderComparison {
  if (isBlankHeaderRow(actualRaw)) {
    return {
      kind: "blank",
      expected: [...expected],
      actual: [],
      missingHeaders: [...expected],
      unexpectedHeaders: [],
      orderMismatch: false,
    };
  }

  const actual = normalizeHeaderRow(actualRaw);
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);

  const missingHeaders = expected.filter((h) => !actualSet.has(h));
  const unexpectedHeaders = actual.filter((h) => !expectedSet.has(h));

  const orderMismatch =
    missingHeaders.length === 0 &&
    unexpectedHeaders.length === 0 &&
    (actual.length !== expected.length ||
      actual.some((header, index) => header !== expected[index]));

  const match =
    missingHeaders.length === 0 &&
    unexpectedHeaders.length === 0 &&
    !orderMismatch &&
    actual.length === expected.length;

  return {
    kind: match ? "match" : "mismatch",
    expected: [...expected],
    actual,
    missingHeaders,
    unexpectedHeaders,
    orderMismatch,
  };
}
