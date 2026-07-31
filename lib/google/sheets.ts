import "server-only";

import { createSheetsClient, getGoogleEnvSafe } from "@/lib/google/auth";
import { GoogleIntegrationError, mapGoogleApiError } from "@/lib/google/errors";
import {
  ARTWORK_INVENTORY_HEADERS,
  ARTWORK_INVENTORY_TAB,
  INVENTORY_CLAIMS_HEADERS,
  INVENTORY_CLAIMS_TAB,
  compareHeaders,
  isBlankHeaderRow,
  normalizeHeaderRow,
} from "@/lib/google/headers";
import type { SheetTabName, TabHeaderStatus } from "@/lib/google/diagnostic-types";
import { decideHeaderInitialization } from "@/lib/google/setup-logic";

export type { SheetTabName, TabHeaderStatus };

export type SpreadsheetAccessResult = {
  spreadsheetId: string;
  title: string;
  sheetTitles: string[];
};

function quoteSheetRange(tab: string, a1: string): string {
  const escaped = tab.replace(/'/g, "''");
  return `'${escaped}'!${a1}`;
}

export async function verifySpreadsheetAccess(
  spreadsheetId = getGoogleEnvSafe().sheetId,
): Promise<SpreadsheetAccessResult> {
  const sheets = createSheetsClient();
  try {
    const response = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "spreadsheetId,properties.title,sheets.properties.title",
    });

    const title = response.data.properties?.title ?? "(untitled)";
    const sheetTitles =
      response.data.sheets
        ?.map((sheet) => sheet.properties?.title)
        .filter((value): value is string => Boolean(value)) ?? [];

    return {
      spreadsheetId: response.data.spreadsheetId ?? spreadsheetId,
      title,
      sheetTitles,
    };
  } catch (error) {
    throw mapGoogleApiError(error, "sheets");
  }
}

export async function getSpreadsheetMetadata(
  spreadsheetId = getGoogleEnvSafe().sheetId,
) {
  return verifySpreadsheetAccess(spreadsheetId);
}

export function tabExists(
  sheetTitles: string[],
  tab: SheetTabName,
): boolean {
  return sheetTitles.includes(tab);
}

export async function readFirstRow(
  tab: SheetTabName,
  spreadsheetId = getGoogleEnvSafe().sheetId,
): Promise<string[]> {
  const sheets = createSheetsClient();
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: quoteSheetRange(tab, "1:1"),
      majorDimension: "ROWS",
    });
    const row = response.data.values?.[0] ?? [];
    return row.map((cell) => String(cell ?? ""));
  } catch (error) {
    throw mapGoogleApiError(error, "sheets");
  }
}

export async function getTabHeaderStatus(
  tab: SheetTabName,
  expected: readonly string[],
  spreadsheetId = getGoogleEnvSafe().sheetId,
): Promise<TabHeaderStatus> {
  const meta = await getSpreadsheetMetadata(spreadsheetId);
  if (!tabExists(meta.sheetTitles, tab)) {
    return {
      tab,
      exists: false,
      comparison: { kind: "missing_tab" },
      canInitializeHeaders: false,
    };
  }

  const firstRow = await readFirstRow(tab, spreadsheetId);
  const comparison = compareHeaders(firstRow, expected);
  const decision = decideHeaderInitialization(comparison);

  return {
    tab,
    exists: true,
    comparison,
    canInitializeHeaders: decision.action === "write_headers",
  };
}

export async function getRequiredTabsHeaderStatus(
  spreadsheetId = getGoogleEnvSafe().sheetId,
) {
  const [artworkInventory, inventoryClaims] = await Promise.all([
    getTabHeaderStatus(
      ARTWORK_INVENTORY_TAB,
      ARTWORK_INVENTORY_HEADERS,
      spreadsheetId,
    ),
    getTabHeaderStatus(
      INVENTORY_CLAIMS_TAB,
      INVENTORY_CLAIMS_HEADERS,
      spreadsheetId,
    ),
  ]);

  return { artworkInventory, inventoryClaims };
}

export type InitializeHeadersResult =
  | {
      ok: true;
      tab: SheetTabName;
      action: "wrote_headers" | "already_matched";
      headersWritten: readonly string[];
    }
  | {
      ok: false;
      tab: SheetTabName;
      code: string;
      message: string;
    };

/**
 * Write expected headers only when row 1 is blank.
 * Refuses to overwrite non-empty mismatched headers. Idempotent when already matching.
 */
export async function initializeBlankHeaders(
  tab: SheetTabName,
  spreadsheetId = getGoogleEnvSafe().sheetId,
): Promise<InitializeHeadersResult> {
  const expected =
    tab === ARTWORK_INVENTORY_TAB
      ? ARTWORK_INVENTORY_HEADERS
      : INVENTORY_CLAIMS_HEADERS;

  const status = await getTabHeaderStatus(tab, expected, spreadsheetId);
  const decision = decideHeaderInitialization(status.comparison);

  if (decision.action === "refuse") {
    return {
      ok: false,
      tab,
      code:
        decision.reason === "tab_missing"
          ? "SHEET_TAB_MISSING"
          : "HEADER_REFUSED",
      message: decision.detail,
    };
  }

  if (decision.action === "noop") {
    return {
      ok: true,
      tab,
      action: "already_matched",
      headersWritten: expected,
    };
  }

  // Re-check blank immediately before write (idempotent / race-safe enough for setup)
  const current = await readFirstRow(tab, spreadsheetId);
  if (!isBlankHeaderRow(current)) {
    const comparison = compareHeaders(current, expected);
    if (comparison.kind === "match") {
      return {
        ok: true,
        tab,
        action: "already_matched",
        headersWritten: expected,
      };
    }
    return {
      ok: false,
      tab,
      code: "HEADER_REFUSED",
      message:
        "Header row is no longer blank. Refusing to overwrite existing headers.",
    };
  }

  const sheets = createSheetsClient();
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: quoteSheetRange(tab, "1:1"),
      valueInputOption: "RAW",
      requestBody: {
        values: [[...expected]],
      },
    });

    return {
      ok: true,
      tab,
      action: "wrote_headers",
      headersWritten: expected,
    };
  } catch (error) {
    throw mapGoogleApiError(error, "sheets");
  }
}

export function describeHeaderStatus(
  status: TabHeaderStatus,
): {
  label: string;
  details: string[];
} {
  if (!status.exists || status.comparison.kind === "missing_tab") {
    return {
      label: "Tab missing",
      details: [
        `Create a tab named “${status.tab}” in the spreadsheet, then refresh.`,
      ],
    };
  }

  const comparison = status.comparison;
  if (comparison.kind === "blank") {
    return {
      label: "Header row blank",
      details: [
        "Row 1 is empty. You can initialize the expected headers from this page.",
      ],
    };
  }

  if (comparison.kind === "match") {
    return {
      label: "Headers match",
      details: [`${comparison.actual.length} columns in expected order.`],
    };
  }

  const details: string[] = [];
  if (comparison.missingHeaders.length > 0) {
    details.push(`Missing: ${comparison.missingHeaders.join(", ")}`);
  }
  if (comparison.unexpectedHeaders.length > 0) {
    details.push(`Unexpected: ${comparison.unexpectedHeaders.join(", ")}`);
  }
  if (comparison.orderMismatch) {
    details.push("Column order does not match the expected schema.");
  }
  details.push("Non-empty mismatched headers will not be auto-repaired.");
  return { label: "Headers mismatch", details };
}

export function assertTabExistsOrThrow(
  exists: boolean,
  tab: SheetTabName,
): void {
  if (!exists) {
    throw new GoogleIntegrationError({
      code: "SHEET_TAB_MISSING",
      message: `Required sheet tab “${tab}” is missing.`,
    });
  }
}

export { normalizeHeaderRow, isBlankHeaderRow };

/**
 * Read all data rows from Inventory Claims (excluding the header).
 * Returns raw cell arrays for claim-status updates and ID allocation.
 */
export async function readInventoryClaimRows(
  spreadsheetId = getGoogleEnvSafe().sheetId,
): Promise<string[][]> {
  const sheets = createSheetsClient();
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: quoteSheetRange(INVENTORY_CLAIMS_TAB, "A2:E"),
      majorDimension: "ROWS",
    });
    return (
      response.data.values?.map((row) =>
        row.map((cell) => String(cell ?? "")),
      ) ?? []
    );
  } catch (error) {
    throw mapGoogleApiError(error, "sheets");
  }
}

/**
 * Append claim rows in one batch. Rows must already be in header order.
 * Do not blindly retry — caller decides reconciliation on ambiguity.
 */
export async function appendInventoryClaimRows(
  rows: string[][],
  spreadsheetId = getGoogleEnvSafe().sheetId,
): Promise<void> {
  if (rows.length === 0) return;
  const sheets = createSheetsClient();
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: quoteSheetRange(INVENTORY_CLAIMS_TAB, "A:E"),
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: rows },
    });
  } catch (error) {
    throw mapGoogleApiError(error, "sheets");
  }
}

/**
 * Update Status (and optionally Completed At) for a claim identified by Claim ID.
 * Scans the Claim ID column; refuses to update if Claim ID is missing/ambiguous.
 */
export async function updateInventoryClaimStatus(params: {
  claimId: string;
  status: string;
  completedAt?: string;
  spreadsheetId?: string;
}): Promise<{ updated: true; rowNumber: number } | { updated: false; reason: string }> {
  const spreadsheetId = params.spreadsheetId ?? getGoogleEnvSafe().sheetId;
  const sheets = createSheetsClient();

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: quoteSheetRange(INVENTORY_CLAIMS_TAB, "A2:E"),
      majorDimension: "ROWS",
    });

    const values = response.data.values ?? [];
    const matches: number[] = [];
    for (let index = 0; index < values.length; index += 1) {
      const claimId = String(values[index]?.[0] ?? "");
      if (claimId === params.claimId) {
        matches.push(index);
      }
    }

    if (matches.length === 0) {
      return { updated: false, reason: "claim_not_found" };
    }
    if (matches.length > 1) {
      return { updated: false, reason: "claim_id_ambiguous" };
    }

    const rowIndex = matches[0]!;
    const rowNumber = rowIndex + 2; // header is row 1
    const existing = values[rowIndex] ?? [];
    const nextRow = [
      String(existing[0] ?? params.claimId),
      String(existing[1] ?? ""),
      params.status,
      String(existing[3] ?? ""),
      params.completedAt !== undefined
        ? params.completedAt
        : String(existing[4] ?? ""),
    ];

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: quoteSheetRange(INVENTORY_CLAIMS_TAB, `A${rowNumber}:E${rowNumber}`),
      valueInputOption: "RAW",
      requestBody: { values: [nextRow] },
    });

    return { updated: true, rowNumber };
  } catch (error) {
    throw mapGoogleApiError(error, "sheets");
  }
}

/**
 * Append one complete Artwork Inventory row. Never append partial rows.
 * Do not blindly retry — prefer reconciliation warnings over duplicates.
 */
export async function appendArtworkInventoryRow(
  row: string[],
  spreadsheetId = getGoogleEnvSafe().sheetId,
): Promise<void> {
  if (row.length !== ARTWORK_INVENTORY_HEADERS.length) {
    throw new GoogleIntegrationError({
      code: "UNKNOWN",
      message: `Artwork Inventory row must have ${ARTWORK_INVENTORY_HEADERS.length} columns.`,
    });
  }

  const sheets = createSheetsClient();
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: quoteSheetRange(ARTWORK_INVENTORY_TAB, "A:Z"),
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });
  } catch (error) {
    throw mapGoogleApiError(error, "sheets");
  }
}

export function spreadsheetBrowserUrl(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}
