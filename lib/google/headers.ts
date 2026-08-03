export const ARTWORK_INVENTORY_TAB = "Artwork Inventory";
export const INVENTORY_CLAIMS_TAB = "Inventory Claims";

export const ARTWORK_INVENTORY_HEADERS = [
  "Inventory ID",
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

export const INVENTORY_CLAIMS_HEADERS = [
  "Claim ID",
  "Inventory ID",
  "Status",
  "Created At",
  "Completed At",
] as const;

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
