import { sanitizeTitleForFilename } from "@/lib/artwork/filenames";
import { resolveArtworkTitle } from "@/lib/artwork/untitled";
import type {
  ArtworkSubmissionInput,
  ClaimStatus,
  ClaimedArtwork,
  ResolvedArtworkMetadata,
} from "@/lib/submission/types";

/** First permanent inventory ID when the claims sheet has no rows. */
export const FIRST_INVENTORY_ID = 1000;

/**
 * Derive the next inventory ID from every existing claim Inventory ID,
 * regardless of Claimed / Processing / Completed / Failed status.
 * Failed submissions leave permanent gaps; IDs are never reused.
 */
export function nextInventoryIdFromExisting(
  existingInventoryIds: readonly number[],
): number {
  let highest = FIRST_INVENTORY_ID - 1;
  for (const id of existingInventoryIds) {
    if (Number.isInteger(id) && id > highest) {
      highest = id;
    }
  }
  return highest + 1;
}

/**
 * Allocate `count` sequential inventory IDs starting from the next available.
 */
export function allocateInventoryIds(
  existingInventoryIds: readonly number[],
  count: number,
): number[] {
  if (count < 0 || !Number.isInteger(count)) {
    throw new Error("count must be a non-negative integer");
  }
  const start = nextInventoryIdFromExisting(existingInventoryIds);
  return Array.from({ length: count }, (_, index) => start + index);
}

export function createClaimId(): string {
  return crypto.randomUUID();
}

export function isoNow(date: Date = new Date()): string {
  return date.toISOString();
}

/**
 * Build claim rows in exact Inventory Claims header order:
 * Claim ID | Inventory ID | Status | Created At | Completed At
 */
export function buildClaimRows(
  inventoryIds: readonly number[],
  options?: {
    createdAt?: string;
    status?: ClaimStatus;
    createClaimId?: () => string;
  },
): { rows: string[][]; claims: ClaimedArtwork[]; clientOrders?: number[] } {
  const createdAt = options?.createdAt ?? isoNow();
  const status = options?.status ?? "Claimed";
  const makeId = options?.createClaimId ?? createClaimId;

  const claims: ClaimedArtwork[] = [];
  const rows: string[][] = [];

  for (let index = 0; index < inventoryIds.length; index += 1) {
    const inventoryId = inventoryIds[index]!;
    const claimId = makeId();
    claims.push({
      clientArtworkId: "",
      order: index,
      claimId,
      inventoryId,
      claimStatus: status,
    });
    rows.push([
      claimId,
      String(inventoryId),
      status,
      createdAt,
      "", // Completed At blank until Completed
    ]);
  }

  return { rows, claims };
}

/**
 * Bind allocated claims to artwork client IDs in batch order.
 */
export function bindClaimsToArtworks(
  claims: ClaimedArtwork[],
  artworks: readonly { clientArtworkId: string; order: number }[],
): ClaimedArtwork[] {
  if (claims.length !== artworks.length) {
    throw new Error("Claim count must match artwork count");
  }
  const ordered = [...artworks].sort((a, b) => a.order - b.order);
  return claims.map((claim, index) => ({
    ...claim,
    clientArtworkId: ordered[index]!.clientArtworkId,
    order: ordered[index]!.order,
  }));
}

/**
 * Parse Inventory ID cells from claim sheet data rows (skip header).
 * Non-numeric / blank cells are ignored.
 */
export function parseInventoryIdsFromClaimRows(
  dataRows: readonly (readonly string[])[],
  inventoryIdColumnIndex = 1,
): number[] {
  const ids: number[] = [];
  for (const row of dataRows) {
    const raw = row[inventoryIdColumnIndex];
    if (raw == null || String(raw).trim() === "") continue;
    const n = Number(String(raw).trim());
    if (Number.isInteger(n) && n > 0) {
      ids.push(n);
    }
  }
  return ids;
}

/**
 * Resolve shared batch defaults with per-artwork overrides.
 * Override values take precedence when non-blank.
 */
export function resolveArtworkMetadata(
  artwork: ArtworkSubmissionInput,
  shared: {
    exhibition: string;
    gallery: string;
    photographer: string;
  },
): ResolvedArtworkMetadata {
  const pick = (override: string, fallback: string) =>
    override.trim() ? override.trim() : fallback.trim();

  return {
    title: resolveArtworkTitle(artwork),
    year: artwork.year.trim(),
    medium: artwork.medium.trim(),
    height: artwork.height.trim(),
    width: artwork.width.trim(),
    depth: artwork.depth.trim(),
    dimensionUnit: artwork.dimensionUnit.trim(),
    notes: artwork.notes.trim(),
    exhibition: pick(artwork.overrides.exhibition, shared.exhibition),
    gallery: pick(artwork.overrides.gallery, shared.gallery),
    photographer: pick(artwork.overrides.photographer, shared.photographer),
  };
}

/**
 * Artwork folder name under the configured Drive root (no year subfolder):
 * YYYY_KO_INVENTORYID_SanitizedTitle
 */
export function buildArtworkFolderName(params: {
  year: string | number;
  inventoryId: number;
  title: string;
}): string {
  const year = String(params.year).trim();
  const sanitized = sanitizeTitleForFilename(params.title);
  return `${year}_KO_${params.inventoryId}_${sanitized}`;
}

export function sheetCompatibleNumber(value: string): string | number {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return trimmed;
  return n;
}
