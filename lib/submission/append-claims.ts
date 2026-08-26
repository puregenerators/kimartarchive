import type { ClaimedArtwork } from "@/lib/submission/types";

/**
 * After appending claim rows, re-read and detect inventory IDs that appear
 * more than once (two Vercel instances allocating the same next ID).
 */
export function duplicateInventoryIds(
  existingInventoryIds: readonly number[],
): number[] {
  const counts = new Map<number, number>();
  for (const id of existingInventoryIds) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id)
    .sort((a, b) => a - b);
}

export type ClaimSheetDataRow = {
  rowIndex: number;
  claimId: string;
  inventoryId: number;
  status: string;
  createdAt: string;
  completedAt: string;
  cells: string[];
};

export function parseClaimSheetDataRows(
  dataRows: readonly (readonly string[])[],
): ClaimSheetDataRow[] {
  const parsed: ClaimSheetDataRow[] = [];
  for (let index = 0; index < dataRows.length; index += 1) {
    const cells = [...(dataRows[index] ?? [])].map((cell) => String(cell ?? ""));
    const inventoryId = Number(String(cells[1] ?? "").trim());
    if (!Number.isInteger(inventoryId) || inventoryId <= 0) continue;
    parsed.push({
      rowIndex: index,
      claimId: String(cells[0] ?? "").trim(),
      inventoryId,
      status: String(cells[2] ?? "").trim(),
      createdAt: String(cells[3] ?? ""),
      completedAt: String(cells[4] ?? ""),
      cells,
    });
  }
  return parsed;
}

export function findClaimRowByClaimId(
  dataRows: readonly (readonly string[])[],
  claimId: string,
): ClaimSheetDataRow | null {
  const matches = parseClaimSheetDataRows(dataRows).filter(
    (row) => row.claimId === claimId,
  );
  if (matches.length !== 1) return null;
  return matches[0]!;
}

/**
 * Keep the earliest row for a duplicated inventory ID. Later rows are
 * reassigned to max(existing)+1, +2, … so each claim still has a unique ID.
 */
export function repairDuplicateClaimInventoryIds(params: {
  dataRows: string[][];
  ourClaimIds: ReadonlySet<string>;
}): {
  updates: { rowIndex: number; claimId: string; from: number; to: number }[];
  nextByClaimId: Map<string, number>;
} {
  const parsed = parseClaimSheetDataRows(params.dataRows);
  const allIds = parsed.map((row) => row.inventoryId);
  let nextId = allIds.reduce((max, id) => (id > max ? id : max), 999) + 1;
  const seen = new Map<number, ClaimSheetDataRow>();
  const updates: {
    rowIndex: number;
    claimId: string;
    from: number;
    to: number;
  }[] = [];

  for (const row of parsed) {
    const first = seen.get(row.inventoryId);
    if (!first) {
      seen.set(row.inventoryId, row);
      continue;
    }
    const from = row.inventoryId;
    const to = nextId;
    nextId += 1;
    updates.push({
      rowIndex: row.rowIndex,
      claimId: row.claimId,
      from,
      to,
    });
    row.inventoryId = to;
    row.cells[1] = String(to);
    params.dataRows[row.rowIndex]![1] = String(to);
  }

  const nextByClaimId = new Map<string, number>();
  for (const row of parseClaimSheetDataRows(params.dataRows)) {
    if (params.ourClaimIds.has(row.claimId)) {
      nextByClaimId.set(row.claimId, row.inventoryId);
    }
  }

  return { updates, nextByClaimId };
}

export function applyRepairedInventoryIds(
  claims: ClaimedArtwork[],
  nextByClaimId: ReadonlyMap<string, number>,
): ClaimedArtwork[] {
  return claims.map((claim) => {
    const next = nextByClaimId.get(claim.claimId);
    if (next == null || next === claim.inventoryId) return claim;
    return { ...claim, inventoryId: next };
  });
}

export function inventoryIdsAreUnique(
  existingInventoryIds: readonly number[],
): boolean {
  return duplicateInventoryIds(existingInventoryIds).length === 0;
}
