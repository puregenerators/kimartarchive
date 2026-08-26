import type { DropboxFilesOps } from "@/lib/dropbox/files-ops";
import {
  DROPBOX_ALLOCATION_LOCK_FOLDER,
  DROPBOX_ALLOCATION_LOCK_PATH,
  DROPBOX_ALLOCATION_LOCK_STALE_MS,
} from "@/lib/dropbox/types";

export const ALLOCATION_LOCK_CONTENTS_PREFIX = "kimartarchive-allocation-lock";

export type AllocationLockHolder = {
  holderId: string;
  createdAtMs: number;
};

export function buildAllocationLockContents(
  holder: AllocationLockHolder,
): string {
  return JSON.stringify({
    kind: ALLOCATION_LOCK_CONTENTS_PREFIX,
    holderId: holder.holderId,
    createdAtMs: holder.createdAtMs,
  });
}

export function parseAllocationLockContents(
  raw: string,
): AllocationLockHolder | null {
  try {
    const parsed = JSON.parse(raw) as {
      kind?: string;
      holderId?: string;
      createdAtMs?: number;
    };
    if (parsed.kind !== ALLOCATION_LOCK_CONTENTS_PREFIX) return null;
    if (!parsed.holderId || typeof parsed.createdAtMs !== "number") return null;
    return { holderId: parsed.holderId, createdAtMs: parsed.createdAtMs };
  } catch {
    return null;
  }
}

export function isAllocationLockStale(params: {
  createdAtMs: number;
  nowMs: number;
  staleMs?: number;
}): boolean {
  const staleMs = params.staleMs ?? DROPBOX_ALLOCATION_LOCK_STALE_MS;
  return params.nowMs - params.createdAtMs >= staleMs;
}

function isConflictError(error: unknown): boolean {
  const parts: string[] = [];
  if (error instanceof Error) parts.push(error.message);
  if (error && typeof error === "object") {
    if ("safeMessage" in error) {
      parts.push(String((error as { safeMessage?: string }).safeMessage ?? ""));
    }
    if ("errorTag" in error) {
      parts.push(String((error as { errorTag?: string }).errorTag ?? ""));
    }
    if ("errorSummary" in error) {
      parts.push(String((error as { errorSummary?: string }).errorSummary ?? ""));
    }
  }
  const lower = parts.join(" ").toLowerCase();
  return (
    lower.includes("conflict") ||
    lower.includes("path/conflict") ||
    lower.includes("already exists")
  );
}

async function ensureLockFolder(ops: DropboxFilesOps): Promise<void> {
  const exists = await ops.pathExists(DROPBOX_ALLOCATION_LOCK_FOLDER);
  if (exists) return;
  try {
    await ops.createFolder(DROPBOX_ALLOCATION_LOCK_FOLDER);
  } catch (error) {
    if (!isConflictError(error)) throw error;
  }
}

async function stealStaleLock(
  ops: DropboxFilesOps,
  nowMs: number,
): Promise<boolean> {
  try {
    const meta = await ops.getMetadata(DROPBOX_ALLOCATION_LOCK_PATH);
    const modifiedMs = meta.clientModified
      ? Date.parse(meta.clientModified)
      : NaN;
    const createdAtMs = Number.isFinite(modifiedMs) ? modifiedMs : 0;
    if (!isAllocationLockStale({ createdAtMs, nowMs })) {
      return false;
    }
    await ops.deleteFile(DROPBOX_ALLOCATION_LOCK_PATH);
    return true;
  } catch {
    return false;
  }
}

/**
 * Acquire a Dropbox mode=add lock so two Vercel isolates cannot allocate
 * the same next inventory ID. Releases in a finally block.
 */
export async function withDropboxAllocationLock<T>(params: {
  ops: DropboxFilesOps;
  holderId?: string;
  nowMs?: number;
  attempts?: number;
  sleepMs?: number;
  run: () => Promise<T>;
}): Promise<T> {
  const holderId = params.holderId ?? crypto.randomUUID();
  const attempts = params.attempts ?? 8;
  const sleepMs = params.sleepMs ?? 250;
  let acquired = false;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const nowMs = params.nowMs ?? Date.now();
    await ensureLockFolder(params.ops);
    try {
      await params.ops.uploadBuffer(
        DROPBOX_ALLOCATION_LOCK_PATH,
        buildAllocationLockContents({ holderId, createdAtMs: nowMs }),
        { mode: "add" },
      );
      acquired = true;
      break;
    } catch (error) {
      if (!isConflictError(error)) throw error;
      const stolen = await stealStaleLock(params.ops, nowMs);
      if (stolen) continue;
      await new Promise((resolve) => setTimeout(resolve, sleepMs));
    }
  }

  if (!acquired) {
    throw new Error(
      "Could not acquire the inventory allocation lock. Retry in a moment.",
    );
  }

  try {
    return await params.run();
  } finally {
    try {
      await params.ops.deleteFile(DROPBOX_ALLOCATION_LOCK_PATH);
    } catch {
      // Lock expiry / steal covers leftover files.
    }
  }
}
