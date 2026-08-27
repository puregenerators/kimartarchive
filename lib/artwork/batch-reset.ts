import type { AppendFilesRejection, DuplicateMatch } from "@/lib/artwork/batch-files";
import {
  createEmptyBatch,
  type BatchDraft,
  type BatchValidationResult,
} from "@/lib/artwork/types";

/**
 * Intake batch lives in React memory only. Clearing it must not write or read
 * localStorage / sessionStorage, and must not touch submitted archive data.
 */
export const BATCH_SESSION_STORAGE_KEY: null = null;

/** Clear Batch / Start New Batch never delete Dropbox, Sheets, or inventory claims. */
export const CLEAR_BATCH_TOUCHES_ARCHIVE = false;

export const CLEAR_BATCH_CONFIRMATION_TITLE = "Clear this batch?";

export const CLEAR_BATCH_CONFIRMATION_BODY =
  "This will remove all artworks and entered information from the current batch. This cannot be undone.";

export type ClearBatchUiPhase = "idle" | "confirm";

export type ClearBatchUiEvent = "request-clear" | "cancel" | "confirm";

export type BatchIntakeDuplicatePrompt = {
  duplicates: DuplicateMatch[];
  pending: File[];
};

export type BatchIntakeSessionState = {
  batch: BatchDraft;
  mode: "edit" | "review";
  errors: BatchValidationResult;
  applyOpen: boolean;
  applyNotice: string | null;
  clearPhase: ClearBatchUiPhase;
  uploadNotice: string | null;
  uploadRejects: AppendFilesRejection[];
  duplicatePrompt: BatchIntakeDuplicatePrompt | null;
};

/**
 * Canonical empty intake session. Used by Clear Batch (after confirm) and
 * Start New Batch. Shared-field defaults come from {@link createEmptyBatch}.
 */
export function createInitialBatchSessionState(): BatchIntakeSessionState {
  return {
    batch: createEmptyBatch(),
    mode: "edit",
    errors: { artworks: {} },
    applyOpen: false,
    applyNotice: null,
    clearPhase: "idle",
    uploadNotice: null,
    uploadRejects: [],
    duplicatePrompt: null,
  };
}

/** Alias so Clear Batch and Start New Batch share one definition of "fresh batch". */
export const createFreshIntakeBatch = createInitialBatchSessionState;

export function reduceClearBatchUi(
  phase: ClearBatchUiPhase,
  event: ClearBatchUiEvent,
): ClearBatchUiPhase {
  switch (event) {
    case "request-clear":
      return "confirm";
    case "cancel":
      return "idle";
    case "confirm":
      return phase === "confirm" ? "idle" : phase;
    default:
      return phase;
  }
}

/**
 * Apply a Clear Batch UI event to session state.
 * `confirm` replaces the session with a fresh batch only when confirmation is open.
 * Cancel and opening the dialog never mutate drafts, files, or errors.
 */
export function applyClearBatchEvent(
  session: BatchIntakeSessionState,
  event: ClearBatchUiEvent,
): BatchIntakeSessionState {
  if (event === "confirm") {
    if (session.clearPhase !== "confirm") return session;
    return createInitialBatchSessionState();
  }
  const clearPhase = reduceClearBatchUi(session.clearPhase, event);
  if (clearPhase === session.clearPhase) return session;
  return { ...session, clearPhase };
}
