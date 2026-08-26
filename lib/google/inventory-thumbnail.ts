/**
 * Google Sheets IMAGE() formula and Artwork Inventory thumbnail display.
 * The Dropbox URL lives only inside this formula — not in a metadata column.
 */

import {
  ARTWORK_INVENTORY_THUMBNAIL_COLUMN_INDEX,
  ARTWORK_INVENTORY_THUMBNAIL_HEADER,
} from "@/lib/google/headers";

/** IMAGE() mode 1: fit the image in the cell, preserving aspect ratio. */
export const SHEETS_IMAGE_FIT_CELL_MODE = 1 as const;

export const INVENTORY_THUMBNAIL_COLUMN_WIDTH_PX = 120;
export const INVENTORY_ARTWORK_ROW_HEIGHT_PX = 108;

/** Column letter for the Thumbnail column (B). */
export function artworkInventoryThumbnailColumnLetter(): string {
  return columnIndexToLetter(ARTWORK_INVENTORY_THUMBNAIL_COLUMN_INDEX);
}

export function columnIndexToLetter(index: number): string {
  let remaining = index;
  let letter = "";
  do {
    letter = String.fromCharCode(65 + (remaining % 26)) + letter;
    remaining = Math.floor(remaining / 26) - 1;
  } while (remaining >= 0);
  return letter;
}

export function escapeSheetsFormulaString(value: string): string {
  return value.replace(/"/g, '""');
}

/**
 * Build `=IMAGE("url", 1)` so Google Sheets fetches the image itself
 * and keeps the artwork's natural proportions inside the cell.
 */
export function buildSheetsImageFormula(directImageUrl: string): string {
  const trimmed = directImageUrl.trim();
  return `=IMAGE("${escapeSheetsFormulaString(trimmed)}", ${SHEETS_IMAGE_FIT_CELL_MODE})`;
}

export function isSheetsImageFormula(value: string): boolean {
  return /^\s*=IMAGE\(/i.test(value);
}

/**
 * Parse the 1-based row number from a Sheets values.append updatedRange
 * such as `'Artwork Inventory'!A12:V12`.
 */
export function parseAppendedRowNumber(
  updatedRange: string | null | undefined,
): number | null {
  if (!updatedRange) return null;
  const match = /![A-Z]+\d+:[A-Z]+(\d+)$/i.exec(updatedRange.trim());
  if (match) {
    const row = Number(match[1]);
    return Number.isInteger(row) && row > 0 ? row : null;
  }
  const startOnly = /![A-Z]+(\d+)$/i.exec(updatedRange.trim());
  if (!startOnly) return null;
  const row = Number(startOnly[1]);
  return Number.isInteger(row) && row > 0 ? row : null;
}

export type InventoryDisplayFormatRequest = {
  updateDimensionProperties?: {
    range: {
      sheetId: number;
      dimension: "COLUMNS" | "ROWS";
      startIndex: number;
      endIndex: number;
    };
    properties: { pixelSize: number };
    fields: "pixelSize";
  };
  repeatCell?: {
    range: {
      sheetId: number;
      startRowIndex: number;
      startColumnIndex: number;
      endColumnIndex: number;
    };
    cell: {
      userEnteredFormat: {
        horizontalAlignment: "CENTER" | "LEFT";
        verticalAlignment: "MIDDLE";
      };
    };
    fields: string;
  };
};

/**
 * Column width + thumbnail alignment. Safe to re-apply (idempotent sizing).
 * Does not change metadata column widths or unused empty rows.
 */
export function buildInventoryThumbnailColumnFormatRequests(
  sheetId: number,
): InventoryDisplayFormatRequest[] {
  const columnIndex = ARTWORK_INVENTORY_THUMBNAIL_COLUMN_INDEX;
  return [
    {
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: "COLUMNS",
          startIndex: columnIndex,
          endIndex: columnIndex + 1,
        },
        properties: { pixelSize: INVENTORY_THUMBNAIL_COLUMN_WIDTH_PX },
        fields: "pixelSize",
      },
    },
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          startColumnIndex: columnIndex,
          endColumnIndex: columnIndex + 1,
        },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE",
          },
        },
        fields:
          "userEnteredFormat.horizontalAlignment,userEnteredFormat.verticalAlignment",
      },
    },
  ];
}

export function buildInventoryArtworkRowHeightRequest(
  sheetId: number,
  rowNumber: number,
): InventoryDisplayFormatRequest {
  return {
    updateDimensionProperties: {
      range: {
        sheetId,
        dimension: "ROWS",
        startIndex: rowNumber - 1,
        endIndex: rowNumber,
      },
      properties: { pixelSize: INVENTORY_ARTWORK_ROW_HEIGHT_PX },
      fields: "pixelSize",
    },
  };
}

export function buildInventoryArtworkRowHeightRequests(
  sheetId: number,
  rowNumbers: readonly number[],
): InventoryDisplayFormatRequest[] {
  return rowNumbers
    .filter((rowNumber) => Number.isInteger(rowNumber) && rowNumber >= 2)
    .map((rowNumber) =>
      buildInventoryArtworkRowHeightRequest(sheetId, rowNumber),
    );
}

export { ARTWORK_INVENTORY_THUMBNAIL_HEADER };
