/**
 * In-process duplicate submission-attempt protection.
 *
 * The client generates one stable attempt ID immediately before confirmation.
 * The server rejects reuse of the same ID within a local TTL.
 *
 * Limitations:
 * - Lives in process memory only (local-only app).
 * - Restarting the app clears this protection.
 * - Not a database-backed idempotency system.
 */

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

type AttemptRecord = {
  startedAt: number;
  expiresAt: number;
};

const attempts = new Map<string, AttemptRecord>();

export function clearSubmissionAttemptGuardForTests(): void {
  attempts.clear();
}

function pruneExpired(now: number): void {
  for (const [id, record] of attempts) {
    if (record.expiresAt <= now) {
      attempts.delete(id);
    }
  }
}

/**
 * Try to register a submission attempt ID.
 * Returns false if the ID was already used and has not expired.
 */
export function registerSubmissionAttempt(
  attemptId: string,
  options?: { now?: number; ttlMs?: number },
): { ok: true } | { ok: false; reason: "duplicate" | "invalid_id" } {
  const id = attemptId?.trim() ?? "";
  if (!id || id.length < 8) {
    return { ok: false, reason: "invalid_id" };
  }

  const now = options?.now ?? Date.now();
  const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
  pruneExpired(now);

  const existing = attempts.get(id);
  if (existing && existing.expiresAt > now) {
    return { ok: false, reason: "duplicate" };
  }

  attempts.set(id, {
    startedAt: now,
    expiresAt: now + ttlMs,
  });
  return { ok: true };
}

export function hasActiveSubmissionAttempt(
  attemptId: string,
  now = Date.now(),
): boolean {
  pruneExpired(now);
  const existing = attempts.get(attemptId.trim());
  return Boolean(existing && existing.expiresAt > now);
}
