/**
 * Structured audit logging for batch submission.
 * Never log private keys, tokens, image bytes, or raw multipart bodies.
 */

export type SubmissionAuditEvent = {
  event: string;
  submissionAttemptId: string;
  clientArtworkId?: string;
  inventoryId?: number | null;
  claimId?: string | null;
  stage?: string;
  /** Last successfully completed stage when reporting a failure. */
  lastCompletedStage?: string;
  /** Operation that failed (e.g. upload_master). */
  failedOperation?: string | null;
  /** Next intended operation when useful for operators. */
  nextOperation?: string | null;
  resourceIds?: Record<string, string | undefined | null>;
  errorCode?: string;
  /** Normalized Google / submission reason when available. */
  normalizedErrorCode?: string;
  googleHttpStatus?: number;
  googleReason?: string;
  outcome?: string;
  archiveTarget?: string;
  detail?: string;
};

export function logSubmissionEvent(event: SubmissionAuditEvent): void {
  const payload = {
    scope: "artwork-submission",
    ts: new Date().toISOString(),
    ...event,
  };
  // Single-line JSON for easy grepping; no secrets by construction.
  console.info(JSON.stringify(payload));
}
