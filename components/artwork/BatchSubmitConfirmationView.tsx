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
  SUBMIT_CONFIRM_BACK_LABEL,
  SUBMIT_CONFIRM_DELIVERY,
  SUBMIT_CONFIRM_KEEP_OPEN,
  submitConfirmActionLabel,
  submitConfirmHeading,
  submitConfirmLargeFileNote,
  submitConfirmSizeLabel,
  submitFailureDetail,
  type SubmitFailureInfo,
} from "@/lib/artwork/submit-confirm";

const backButtonClass =
  "px-5 py-3 text-sm text-[var(--muted)] transition hover:text-[var(--ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]";

const confirmButtonClass =
  "border border-[var(--ink)] bg-[var(--ink)] px-6 py-3 text-sm text-[var(--paper)] transition hover:bg-[var(--ink-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]";

export function BatchSubmitConfirmationView({
  artworkCount,
  sourceBytes,
  largeFileCount,
  onConfirm,
  onBack,
}: {
  artworkCount: number;
  sourceBytes: number;
  largeFileCount: number;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const restoreFocusRef = useRef(true);
  const startedRef = useRef(false);

  useEffect(() => {
    const unlock = lockBackgroundScroll(document.body.style);
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    focusWithoutScrolling(headingRef.current);
    return () => {
      unlock();
      if (restoreFocusRef.current) {
        focusWithoutScrolling(trigger);
      }
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isModalDismissKey(event.key)) {
        event.preventDefault();
        if (!startedRef.current) onBack();
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
  }, [onBack]);

  const largeFileNote = submitConfirmLargeFileNote({
    artworkCount,
    largeFileCount,
  });

  function handleBack() {
    if (startedRef.current) return;
    onBack();
  }

  function handleConfirm() {
    if (startedRef.current) return;
    startedRef.current = true;
    restoreFocusRef.current = false;
    onConfirm();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--ink)]/40 p-4"
      onClick={handleBack}
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
          {submitConfirmHeading(artworkCount)}
        </h2>
        <p className="mt-2 text-sm font-medium text-[var(--ink)]">
          {submitConfirmSizeLabel(sourceBytes)}
        </p>
        <p className="mt-4 text-sm text-[var(--muted)] leading-relaxed">
          {SUBMIT_CONFIRM_DELIVERY}
        </p>
        {largeFileNote ? (
          <p className="mt-3 text-sm text-[var(--muted)] leading-relaxed">
            {largeFileNote}
          </p>
        ) : null}
        <p className="mt-3 text-sm text-[var(--muted)] leading-relaxed">
          {SUBMIT_CONFIRM_KEEP_OPEN}
        </p>
        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={handleBack} className={backButtonClass}>
            {SUBMIT_CONFIRM_BACK_LABEL}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className={confirmButtonClass}
          >
            {submitConfirmActionLabel(artworkCount)}
          </button>
        </div>
      </div>
    </div>
  );
}

export function BatchSubmitFailureView({
  failure,
}: {
  failure: SubmitFailureInfo;
}) {
  const detail = submitFailureDetail(failure);

  return (
    <div
      role="alert"
      className="mt-4 border border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]"
    >
      <p className="font-medium">Submission failed</p>
      {detail ? <p className="mt-1">{detail}</p> : null}
      <p className="mt-1">{failure.message}</p>
    </div>
  );
}
