"use client";

import { useEffect, useId, useRef } from "react";

import {
  focusWithoutScrolling,
  isModalDismissKey,
  lockBackgroundScroll,
  MODAL_FOCUSABLE_SELECTOR,
  trapTabKey,
} from "@/lib/artwork/modal-focus";
import {
  APPLY_SHARED_DETAILS_TITLE,
  APPLY_SHARED_OVERWRITE_WARNING,
  applySharedDetailsBody,
  type PopulatedSharedApplyField,
} from "@/lib/artwork/types";

const cancelButtonClass =
  "px-4 py-2 text-xs uppercase tracking-[0.12em] text-[var(--muted)] hover:text-[var(--ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]";

const confirmButtonClass =
  "border border-[var(--ink)] bg-[var(--ink)] px-4 py-2 text-xs uppercase tracking-[0.12em] text-[var(--paper)] disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]";

export function ApplySharedDetailsConfirmationView({
  artworkCount,
  fields,
  wouldOverwrite,
  onConfirm,
  onCancel,
}: {
  artworkCount: number;
  fields: readonly PopulatedSharedApplyField[];
  wouldOverwrite: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const unlock = lockBackgroundScroll(document.body.style);
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    focusWithoutScrolling(headingRef.current);
    return () => {
      unlock();
      focusWithoutScrolling(trigger);
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isModalDismissKey(event.key)) {
        event.preventDefault();
        onCancel?.();
        return;
      }

      const root = dialogRef.current;
      if (!root) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR),
      );
      const active =
        document.activeElement instanceof HTMLElement &&
        root.contains(document.activeElement)
          ? document.activeElement
          : null;
      trapTabKey(event, focusables, active);
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--ink)]/40 p-4"
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-lg border border-[var(--line)] bg-[var(--surface-elevated)] p-5 shadow-sm"
        onClick={(event) => event.stopPropagation()}
      >
        <h2
          ref={headingRef}
          id={titleId}
          tabIndex={-1}
          className="font-display text-xl text-[var(--ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          {APPLY_SHARED_DETAILS_TITLE}
        </h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          {applySharedDetailsBody(artworkCount)}
        </p>
        {fields.length > 0 ? (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[var(--ink)]">
            {fields.map((field) => (
              <li key={field.key}>
                {field.label}: {field.value}
              </li>
            ))}
          </ul>
        ) : null}
        {wouldOverwrite ? (
          <p className="mt-3 text-sm text-[var(--muted)]">
            {APPLY_SHARED_OVERWRITE_WARNING}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={fields.length === 0}
            onClick={onConfirm}
            className={confirmButtonClass}
          >
            Apply to all artworks
          </button>
          <button type="button" onClick={onCancel} className={cancelButtonClass}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
