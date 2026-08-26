"use client";

import { FilenameDisplay } from "@/components/artwork/FilenameDisplay";
import { DROPBOX_ARCHIVE_ROOT_DISPLAY } from "@/lib/dropbox/types";
import {
  largeFileStatusLabel,
  type LargeFileIntakeStatus,
} from "@/lib/submission/large-file-intake-logic";

export type LargeMasterIntakePanelProps = {
  inventoryId: number;
  title: string;
  folderName: string;
  masterFilename: string;
  folderWebUrl: string | null;
  status: LargeFileIntakeStatus;
  message: string;
  byteLengthLabel?: string | null;
  dimensionsLabel?: string | null;
  checking?: boolean;
  processing?: boolean;
  canContinueProcessing: boolean;
  onCheck: () => void;
  onContinue: () => void;
};

export function LargeMasterIntakePanel({
  inventoryId,
  title,
  folderName,
  masterFilename,
  folderWebUrl,
  status,
  message,
  byteLengthLabel,
  dimensionsLabel,
  checking,
  processing,
  canContinueProcessing,
  onCheck,
  onContinue,
}: LargeMasterIntakePanelProps) {
  const busy = Boolean(checking || processing);

  return (
    <article className="border border-[var(--line)] bg-[var(--surface)] p-4 sm:p-5">
      <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]">
        Large master via Dropbox · Inventory {inventoryId}
      </p>
      <h3 className="mt-1 font-display text-2xl text-[var(--ink)]">{title}</h3>
      <p className="mt-2 text-sm text-[var(--muted)]" aria-live="polite">
        Status:{" "}
        <span className="text-[var(--ink)]">{largeFileStatusLabel(status)}</span>
      </p>
      {message ? <p className="mt-2 text-sm text-[var(--ink)]">{message}</p> : null}
      {byteLengthLabel || dimensionsLabel ? (
        <p className="mt-1 text-xs text-[var(--muted)]">
          {[byteLengthLabel, dimensionsLabel].filter(Boolean).join(" · ")}
        </p>
      ) : null}

      {status === "local_processing_required" ? (
        <div
          role="status"
          className="mt-4 border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]"
        >
          <p className="font-medium">Local processing required</p>
          <p className="mt-1">
            Manual Dropbox upload bypasses the 150 MB transfer limit, not the
            hosted 2 GB processing limit. This master will not be decoded on
            Vercel.
          </p>
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
            Destination folder
          </p>
          <div className="mt-1">
            <FilenameDisplay filename={folderName} label="destination folder" />
          </div>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Under {DROPBOX_ARCHIVE_ROOT_DISPLAY}
          </p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
            Expected filename
          </p>
          <div className="mt-1">
            <FilenameDisplay
              filename={masterFilename}
              label="expected master filename"
            />
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-2 text-sm text-[var(--muted)] leading-relaxed">
        <p>
          Upload the original master through Dropbox desktop or dropbox.com.
          Rename it to the expected filename. Do not put it in a different
          folder.
        </p>
        <p>
          Desktop: open Apps / Kim Art Archive / {folderName}, copy the file in,
          wait for the green synced check, then return here.
        </p>
        {folderWebUrl ? (
          <p>
            <a
              href={folderWebUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--ink)] underline underline-offset-2 hover:text-[var(--accent)]"
            >
              Open destination folder on dropbox.com
            </a>
          </p>
        ) : (
          <p>
            Sign in at dropbox.com, open Apps / Kim Art Archive, then open{" "}
            {folderName}.
          </p>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-[var(--line)] pt-4">
        <button
          type="button"
          disabled={busy || status === "completed" || status === "processing"}
          onClick={onCheck}
          className="border border-[var(--ink)] bg-[var(--surface-elevated)] px-4 py-2 text-xs uppercase tracking-[0.12em] text-[var(--ink)] transition enabled:hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          {checking ? "Checking…" : "Check for master"}
        </button>
        <button
          type="button"
          disabled={!canContinueProcessing || busy || status === "completed"}
          onClick={onContinue}
          className="border border-[var(--ink)] bg-[var(--ink)] px-4 py-2 text-xs uppercase tracking-[0.12em] text-[var(--paper)] transition enabled:hover:bg-[var(--ink-soft)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          {processing
            ? "Processing…"
            : status === "completed"
              ? "Completed"
              : "Continue processing"}
        </button>
      </div>
    </article>
  );
}
