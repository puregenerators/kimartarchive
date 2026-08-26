import { parseInventoryId } from "@/lib/archive/records";
import type { ArchiveArtwork, InventoryTable } from "@/lib/archive/types";

/** This archive delete action never removes stored image files. */
export const ARCHIVE_DELETE_TOUCHES_STORED_FILES = false;

export const ARCHIVE_DELETE_CONFIRMATION_BODY =
  "This will remove this artwork from the archive. This action cannot be undone.";

export const ARCHIVE_DELETE_FAILED_MESSAGE =
  "The artwork could not be deleted.";

export const ARCHIVE_DELETE_NOT_FOUND_MESSAGE =
  "This artwork could not be found in the archive.";

export const ARCHIVE_DELETE_DUPLICATE_MESSAGE =
  "This inventory ID appears more than once, so it cannot be deleted from the archive.";

export const ARCHIVE_DELETE_INVALID_ID_MESSAGE =
  "That inventory ID is not valid.";

export type ArchiveDeleteUiPhase = "idle" | "menu" | "confirm" | "pending";

export type ArchiveDeleteUiEvent =
  | "toggle-menu"
  | "select-delete"
  | "cancel"
  | "confirm-delete"
  | "success"
  | "failure"
  | "dismiss-menu";

export type ArtworkInventoryDeletePlan =
  | {
      ok: true;
      inventoryId: number;
      title: string;
      sheetRowNumber: number;
      filesDeleted: false;
    }
  | {
      ok: false;
      code:
        | "invalid_inventory_id"
        | "not_found"
        | "duplicate_inventory_id"
        | "missing_inventory_id_column";
      message: string;
    };

export type DeleteArtworkRecordResult =
  | {
      ok: true;
      inventoryId: number;
      title: string;
      sheetRowNumber: number;
      filesDeleted: false;
      message: string;
    }
  | {
      ok: false;
      code: string;
      message: string;
      filesDeleted: false;
      causeDetail?: string;
    };

export type InventoryTableReader = () => Promise<InventoryTable>;

export function parseDeleteInventoryId(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isInteger(raw)) {
    return parseInventoryId(String(raw));
  }
  if (typeof raw === "string") {
    return parseInventoryId(raw);
  }
  return null;
}

export function archiveDeleteConfirmationTitle(title: string): string {
  return `Delete “${title}”?`;
}

export function archiveDeleteSuccessMessage(title: string): string {
  return `Deleted “${title}”.`;
}

export function nextRouteAfterArchiveDelete(params: {
  source: "list" | "detail";
  ok: boolean;
}): "/artworks" | null {
  if (!params.ok) return null;
  return params.source === "detail" ? "/artworks" : null;
}

/**
 * UI transitions for the delete control.
 * There is no "deleted" phase — a click never removes the artwork.
 */
export function reduceArchiveDeleteUi(
  phase: ArchiveDeleteUiPhase,
  event: ArchiveDeleteUiEvent,
): ArchiveDeleteUiPhase {
  switch (event) {
    case "toggle-menu":
      if (phase === "idle") return "menu";
      if (phase === "menu") return "idle";
      return phase;
    case "dismiss-menu":
      return phase === "menu" ? "idle" : phase;
    case "select-delete":
      if (phase === "menu" || phase === "idle") return "confirm";
      return phase;
    case "cancel":
      if (phase === "confirm" || phase === "menu" || phase === "pending") {
        return "idle";
      }
      return phase;
    case "confirm-delete":
      return phase === "confirm" ? "pending" : phase;
    case "success":
      return phase === "pending" ? "idle" : phase;
    case "failure":
      return phase === "pending" ? "confirm" : phase;
    default:
      return phase;
  }
}

export function applySuccessfulArchiveDelete(
  artworks: readonly ArchiveArtwork[],
  inventoryId: number,
): ArchiveArtwork[] {
  return artworks.filter((artwork) => artwork.inventoryId !== inventoryId);
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

function isBlankDataRow(row: readonly string[]): boolean {
  return row.every((cell) => !String(cell ?? "").trim());
}

/**
 * Locate the Artwork Inventory sheet row for a numeric Inventory ID.
 * Refuses to choose when the ID is missing or duplicated.
 * Does not describe or schedule any file/storage deletion.
 */
export function planArtworkInventoryRowDelete(params: {
  table: InventoryTable;
  inventoryId: number;
}): ArtworkInventoryDeletePlan {
  const inventoryId = parseDeleteInventoryId(params.inventoryId);
  if (inventoryId == null) {
    return {
      ok: false,
      code: "invalid_inventory_id",
      message: ARCHIVE_DELETE_INVALID_ID_MESSAGE,
    };
  }

  const indexMap = headerIndexMap(params.table.headers);
  if (!indexMap.has("Inventory ID")) {
    return {
      ok: false,
      code: "missing_inventory_id_column",
      message: ARCHIVE_DELETE_FAILED_MESSAGE,
    };
  }

  const matches: { sheetRowNumber: number; title: string }[] = [];
  params.table.rows.forEach((row, index) => {
    if (isBlankDataRow(row)) return;
    const rowId = parseInventoryId(cellAt(row, indexMap, "Inventory ID"));
    if (rowId !== inventoryId) return;
    matches.push({
      sheetRowNumber: index + 2,
      title: cellAt(row, indexMap, "Title") || `Inventory ID ${inventoryId}`,
    });
  });

  if (matches.length === 0) {
    return {
      ok: false,
      code: "not_found",
      message: ARCHIVE_DELETE_NOT_FOUND_MESSAGE,
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      code: "duplicate_inventory_id",
      message: ARCHIVE_DELETE_DUPLICATE_MESSAGE,
    };
  }

  const match = matches[0]!;
  return {
    ok: true,
    inventoryId,
    title: match.title,
    sheetRowNumber: match.sheetRowNumber,
    filesDeleted: ARCHIVE_DELETE_TOUCHES_STORED_FILES,
  };
}

export function archiveDeleteFailureLog(input: {
  inventoryId: number;
  sheetRowNumber?: number;
  code: string;
  message: string;
  causeDetail?: string;
}) {
  return {
    operation: "deleteArtwork" as const,
    inventoryId: input.inventoryId,
    ...(input.sheetRowNumber != null
      ? { sheetRowNumber: input.sheetRowNumber }
      : {}),
    code: input.code,
    message: input.message,
    filesDeleted: ARCHIVE_DELETE_TOUCHES_STORED_FILES,
    ...(input.causeDetail ? { causeDetail: input.causeDetail } : {}),
  };
}

/**
 * Delete the archive catalog row only. Callers must not pass a file deleter —
 * stored master/HR/web files stay untouched.
 */
export async function deleteArtworkArchiveRecordWithDeps(params: {
  inventoryId: number;
  readTable: InventoryTableReader;
  deleteSheetRow: (sheetRowNumber: number) => Promise<void>;
}): Promise<DeleteArtworkRecordResult> {
  const inventoryId = parseDeleteInventoryId(params.inventoryId);
  if (inventoryId == null) {
    return {
      ok: false,
      code: "invalid_inventory_id",
      message: ARCHIVE_DELETE_INVALID_ID_MESSAGE,
      filesDeleted: ARCHIVE_DELETE_TOUCHES_STORED_FILES,
    };
  }

  try {
    const table = await params.readTable();
    const plan = planArtworkInventoryRowDelete({ table, inventoryId });
    if (!plan.ok) {
      return {
        ok: false,
        code: plan.code,
        message: plan.message,
        filesDeleted: ARCHIVE_DELETE_TOUCHES_STORED_FILES,
      };
    }

    await params.deleteSheetRow(plan.sheetRowNumber);

    return {
      ok: true,
      inventoryId: plan.inventoryId,
      title: plan.title,
      sheetRowNumber: plan.sheetRowNumber,
      filesDeleted: ARCHIVE_DELETE_TOUCHES_STORED_FILES,
      message: archiveDeleteSuccessMessage(plan.title),
    };
  } catch (error) {
    return {
      ok: false,
      code: "delete_failed",
      message: ARCHIVE_DELETE_FAILED_MESSAGE,
      filesDeleted: ARCHIVE_DELETE_TOUCHES_STORED_FILES,
      causeDetail: error instanceof Error ? error.message : undefined,
    };
  }
}
