"use client";

import { useId } from "react";

import {
  ARCHIVE_DELETE_CONFIRMATION_BODY,
  archiveDeleteConfirmationTitle,
  type ArchiveDeleteUiPhase,
} from "@/lib/archive/delete-logic";

const overflowButtonClass =
  "inline-flex h-11 w-11 items-center justify-center text-[var(--muted)] transition hover:text-[var(--ink)] focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]";

const menuItemClass =
  "flex min-h-11 w-full items-center px-4 text-left text-sm text-[var(--danger)] transition hover:bg-[var(--danger-soft)] focus-visible:bg-[var(--danger-soft)] focus-visible:outline-none";

const cancelButtonClass =
  "min-h-11 px-5 py-3 text-sm uppercase tracking-[0.14em] text-[var(--muted)] transition hover:text-[var(--ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)] md:min-h-0";

const destroyButtonClass =
  "min-h-11 border border-[var(--danger)] bg-[var(--danger)] px-5 py-3 text-sm uppercase tracking-[0.14em] text-[var(--paper)] transition enabled:hover:bg-[var(--danger)] enabled:hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--danger)] md:min-h-0";

export function ArchiveDeleteControlView({
  title,
  phase = "idle",
  error = null,
  variant = "card",
  onToggleMenu,
  onSelectDelete,
  onCancel,
  onConfirmDelete,
}: {
  title: string;
  phase?: ArchiveDeleteUiPhase;
  error?: string | null;
  variant?: "card" | "detail";
  onToggleMenu?: () => void;
  onSelectDelete?: () => void;
  onCancel?: () => void;
  onConfirmDelete?: () => void;
}) {
  const titleId = useId();
  const menuId = useId();
  const menuOpen = phase === "menu";
  const confirmOpen = phase === "confirm" || phase === "pending";
  const pending = phase === "pending";
  const confirmTitle = archiveDeleteConfirmationTitle(title);

  return (
    <div className="relative">
      <button
        type="button"
        className={[
          overflowButtonClass,
          variant === "card"
            ? menuOpen || confirmOpen
              ? "bg-[var(--paper)]/80 opacity-100 md:bg-[var(--paper)]/80"
              : "bg-[var(--paper)]/80 opacity-80 md:bg-transparent md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
            : "opacity-70 hover:opacity-100",
        ].join(" ")}
        aria-label="Artwork actions"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? menuId : undefined}
        onClick={onToggleMenu}
      >
        <span aria-hidden="true" className="text-base leading-none tracking-widest">
          •••
        </span>
      </button>

      {menuOpen ? (
        <div
          id={menuId}
          role="menu"
          className="absolute right-0 z-20 mt-1 min-w-[10rem] border border-[var(--line)] bg-[var(--surface-elevated)] shadow-sm"
        >
          <button
            type="button"
            role="menuitem"
            className={menuItemClass}
            onClick={onSelectDelete}
          >
            Delete
          </button>
        </div>
      ) : null}

      {confirmOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--ink)]/40 p-4 sm:items-center"
          onClick={onCancel}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="w-full max-w-md border border-[var(--ink)] bg-[var(--surface-elevated)] p-5 shadow-sm"
            onClick={(event) => event.stopPropagation()}
          >
            <h2
              id={titleId}
              className="font-display text-xl text-[var(--ink)]"
            >
              {confirmTitle}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
              {ARCHIVE_DELETE_CONFIRMATION_BODY}
            </p>
            {error ? (
              <p
                role="alert"
                className="mt-4 border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]"
              >
                {error}
              </p>
            ) : null}
            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                className={cancelButtonClass}
                onClick={onCancel}
                disabled={pending}
              >
                Cancel
              </button>
              <button
                type="button"
                className={destroyButtonClass}
                onClick={onConfirmDelete}
                disabled={pending}
              >
                {pending ? "Deleting…" : "Delete artwork"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
