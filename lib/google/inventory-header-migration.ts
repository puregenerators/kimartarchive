/**
 * One-time migration: remove Location from Artwork Inventory.
 * Also documents the earlier Series / Edition / Status removal.
 * Pure planning helpers — callers apply deleteDimension via the Sheets API.
 */

import {
  ARTWORK_INVENTORY_HEADERS,
  ARTWORK_INVENTORY_HEADERS_BEFORE_THUMBNAIL,
  ARTWORK_INVENTORY_THUMBNAIL_COLUMN_INDEX,
  headersEqual,
  normalizeHeaderRow,
} from "@/lib/google/headers";

/**
 * Pre–Series/Edition/Status removal header row (25 columns).
 * Kept for historical projection tests; live Sheet is past this state.
 */
export const LEGACY_ARTWORK_INVENTORY_HEADERS = [
  "Inventory ID",
  "Title",
  "Year",
  "Medium",
  "Height",
  "Width",
  "Depth",
  "Dimension Unit",
  "Series",
  "Edition",
  "Status",
  "Photographer",
  "Location",
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
 * Schema after Series / Edition / Status removal, before Location removal (22 columns).
 * This is the expected live header row immediately prior to this migration.
 */
export const ARTWORK_INVENTORY_HEADERS_WITH_LOCATION = [
  "Inventory ID",
  "Title",
  "Year",
  "Medium",
  "Height",
  "Width",
  "Depth",
  "Dimension Unit",
  "Photographer",
  "Location",
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

/** Location column index in ARTWORK_INVENTORY_HEADERS_WITH_LOCATION (0-based). */
export const LOCATION_COLUMN_INDEX = 9;

export const REMOVED_LOCATION_COLUMN_NAME = "Location" as const;

/** @deprecated Prefer LOCATION_COLUMN_INDEX — Series/Edition/Status already removed live. */
export const REMOVED_INVENTORY_COLUMN_INDICES = [8, 9, 10] as const;
/** @deprecated Prefer REMOVED_LOCATION_COLUMN_NAME. */
export const REMOVED_INVENTORY_COLUMN_NAMES = [
  "Series",
  "Edition",
  "Status",
] as const;

export type RemovedColumnValue = {
  columnIndex: number;
  columnName: string;
  rowNumber: number;
  value: string;
};

export type InventoryHeaderMigrationPlan =
  | {
      ok: true;
      alreadyMigrated: boolean;
      /** 0-based column indices to delete, highest first (safe for sequential deletes). */
      deleteColumnIndicesDescending: number[];
      expectedAfter: readonly string[];
    }
  | {
      ok: false;
      reason:
        | "header_mismatch"
        | "removed_columns_have_values"
        | "unexpected_state";
      message: string;
      valuesInRemovedColumns?: RemovedColumnValue[];
      actualHeaders?: string[];
    };

export type ThumbnailColumnInsertPlan =
  | {
      ok: true;
      alreadyMigrated: boolean;
      /** 0-based column index at which to insert Thumbnail. */
      insertColumnIndex: number;
      expectedAfter: readonly string[];
    }
  | {
      ok: false;
      reason: "header_mismatch";
      message: string;
      actualHeaders?: string[];
    };

/**
 * Scan data rows for non-blank Location cells (index in the with-Location schema).
 */
export function findValuesInLocationColumn(
  dataRows: readonly (readonly string[])[],
  columnIndex: number = LOCATION_COLUMN_INDEX,
): RemovedColumnValue[] {
  const found: RemovedColumnValue[] = [];
  for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex += 1) {
    const row = dataRows[rowIndex] ?? [];
    const value = String(row[columnIndex] ?? "").trim();
    if (value) {
      found.push({
        columnIndex,
        columnName: REMOVED_LOCATION_COLUMN_NAME,
        rowNumber: rowIndex + 2, // sheet row (header is 1)
        value,
      });
    }
  }
  return found;
}

/**
 * Scan data rows for non-blank Series / Edition / Status cells (legacy indices).
 * @deprecated Live Sheet no longer has these columns.
 */
export function findValuesInRemovedInventoryColumns(
  dataRows: readonly (readonly string[])[],
): RemovedColumnValue[] {
  const found: RemovedColumnValue[] = [];
  for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex += 1) {
    const row = dataRows[rowIndex] ?? [];
    for (let i = 0; i < REMOVED_INVENTORY_COLUMN_INDICES.length; i += 1) {
      const columnIndex = REMOVED_INVENTORY_COLUMN_INDICES[i]!;
      const columnName = REMOVED_INVENTORY_COLUMN_NAMES[i]!;
      const value = String(row[columnIndex] ?? "").trim();
      if (value) {
        found.push({
          columnIndex,
          columnName,
          rowNumber: rowIndex + 2,
          value,
        });
      }
    }
  }
  return found;
}

/**
 * Project a with-Location row into the 21-column schema by dropping Location.
 * Used in tests to prove Photographer and later columns stay aligned.
 * Thumbnail is added by a later insert, not by this projection.
 */
export function projectInventoryRowDroppingLocation(
  rowWithLocation: readonly string[],
): string[] {
  return rowWithLocation.filter((_, index) => index !== LOCATION_COLUMN_INDEX);
}

/**
 * Project a legacy 25-col row into the current schema by dropping
 * Series, Edition, Status, and Location.
 */
export function projectLegacyInventoryRowToCurrent(
  legacyRow: readonly string[],
): string[] {
  const withoutSeriesEditionStatus = legacyRow.filter(
    (_, index) =>
      !(REMOVED_INVENTORY_COLUMN_INDICES as readonly number[]).includes(index),
  );
  return projectInventoryRowDroppingLocation(withoutSeriesEditionStatus);
}

/**
 * Plan removal of Location from Artwork Inventory.
 * Accepts the 22-column with-Location schema.
 * Location-already-gone is true for both the 21-column pre-Thumbnail schema
 * and the live schema with Thumbnail.
 * Does not mutate Sheets — caller applies deleteDimension when ok && !alreadyMigrated.
 */
export function planArtworkInventoryHeaderMigration(params: {
  headerRow: string[] | null | undefined;
  dataRows?: readonly (readonly string[])[];
}): InventoryHeaderMigrationPlan {
  const actual = normalizeHeaderRow(params.headerRow);

  if (headersEqual(actual, ARTWORK_INVENTORY_HEADERS)) {
    return {
      ok: true,
      alreadyMigrated: true,
      deleteColumnIndicesDescending: [],
      expectedAfter: ARTWORK_INVENTORY_HEADERS,
    };
  }

  if (headersEqual(actual, ARTWORK_INVENTORY_HEADERS_BEFORE_THUMBNAIL)) {
    return {
      ok: true,
      alreadyMigrated: true,
      deleteColumnIndicesDescending: [],
      expectedAfter: ARTWORK_INVENTORY_HEADERS_BEFORE_THUMBNAIL,
    };
  }

  if (!headersEqual(actual, ARTWORK_INVENTORY_HEADERS_WITH_LOCATION)) {
    return {
      ok: false,
      reason: "header_mismatch",
      message:
        "Artwork Inventory headers do not match the expected schema with Location or the new schema without Location.",
      actualHeaders: actual,
    };
  }

  if (actual[LOCATION_COLUMN_INDEX] !== REMOVED_LOCATION_COLUMN_NAME) {
    return {
      ok: false,
      reason: "unexpected_state",
      message: `Expected “${REMOVED_LOCATION_COLUMN_NAME}” at column index ${LOCATION_COLUMN_INDEX}.`,
      actualHeaders: actual,
    };
  }

  const values = findValuesInLocationColumn(params.dataRows ?? []);
  if (values.length > 0) {
    return {
      ok: false,
      reason: "removed_columns_have_values",
      message:
        "Location contains values. Stop before deleting that column.",
      valuesInRemovedColumns: values,
      actualHeaders: actual,
    };
  }

  return {
    ok: true,
    alreadyMigrated: false,
    deleteColumnIndicesDescending: [LOCATION_COLUMN_INDEX],
    expectedAfter: ARTWORK_INVENTORY_HEADERS_BEFORE_THUMBNAIL,
  };
}

/**
 * Plan insertion of the Thumbnail display column after Inventory ID.
 * Existing Title and later columns shift right; data cells in the new column
 * stay blank (no backfill).
 */
export function planArtworkInventoryThumbnailColumnInsert(params: {
  headerRow: string[] | null | undefined;
}): ThumbnailColumnInsertPlan {
  const actual = normalizeHeaderRow(params.headerRow);

  if (headersEqual(actual, ARTWORK_INVENTORY_HEADERS)) {
    return {
      ok: true,
      alreadyMigrated: true,
      insertColumnIndex: ARTWORK_INVENTORY_THUMBNAIL_COLUMN_INDEX,
      expectedAfter: ARTWORK_INVENTORY_HEADERS,
    };
  }

  if (!headersEqual(actual, ARTWORK_INVENTORY_HEADERS_BEFORE_THUMBNAIL)) {
    return {
      ok: false,
      reason: "header_mismatch",
      message:
        "Artwork Inventory headers do not match the 21-column schema before Thumbnail or the live schema with Thumbnail.",
      actualHeaders: actual,
    };
  }

  return {
    ok: true,
    alreadyMigrated: false,
    insertColumnIndex: ARTWORK_INVENTORY_THUMBNAIL_COLUMN_INDEX,
    expectedAfter: ARTWORK_INVENTORY_HEADERS,
  };
}

export function canInsertArtworkInventoryThumbnailColumn(
  headerRow: string[] | null | undefined,
): boolean {
  const plan = planArtworkInventoryThumbnailColumnInsert({ headerRow });
  return plan.ok && !plan.alreadyMigrated;
}
