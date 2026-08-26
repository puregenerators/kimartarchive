"use client";

import { useId } from "react";

import {
  CLEAR_BATCH_CONFIRMATION_BODY,
  CLEAR_BATCH_CONFIRMATION_TITLE,
} from "@/lib/artwork/batch-reset";

const cancelButtonClass =
  "px-4 py-2 text-xs uppercase tracking-[0.12em] text-[var(--muted)] hover:text-[var(--ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]";

const confirmButtonClass =
  "border border-[var(--danger)] bg-[var(--danger)] px-4 py-2 text-xs uppercase tracking-[0.12em] text-[var(--paper)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--danger)]";

export function ClearBatchConfirmationView({
  onCancel,
  onConfirm,
}: {
  onCancel?: () => void;
  onConfirm?: () => void;
}) {
  const titleId = useId();

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--ink)]/40 p-4 sm:items-center"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md border border-[var(--danger)] bg-[var(--danger-soft)] p-5 shadow-sm"
        onClick={(event) => event.stopPropagation()}
      >
        <h2
          id={titleId}
          className="font-display text-xl text-[var(--ink)]"
        >
          {CLEAR_BATCH_CONFIRMATION_TITLE}
        </h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          {CLEAR_BATCH_CONFIRMATION_BODY}
        </p>
        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" className={cancelButtonClass} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={confirmButtonClass}
            onClick={onConfirm}
          >
            Clear batch
          </button>
        </div>
      </div>
    </div>
  );
}
