import { artworkInventoryColumnIndex } from "@/lib/google/headers";

const INVENTORY_ID_COLUMN = artworkInventoryColumnIndex("Inventory ID");

/**
 * True when Artwork Inventory already has a data row for this inventory ID.
 * Used so retries never append a duplicate Sheet row.
 */
export function artworkInventoryHasRow(
  dataRows: readonly (readonly string[])[],
  inventoryId: number,
  inventoryIdColumnIndex = INVENTORY_ID_COLUMN,
): boolean {
  const wanted = String(inventoryId);
  for (const row of dataRows) {
    const cell = String(row[inventoryIdColumnIndex] ?? "").trim();
    if (cell === wanted) return true;
  }
  return false;
}
