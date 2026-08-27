"use client";

import { useEffect, useId, useRef, useState } from "react";

import { SubmittingStatusDots } from "@/components/artwork/BatchSubmittingStatusView";
import { rawFilenameForCopy } from "@/lib/images/result-presentation";
import {
  dropboxFolderDisplayPath,
  dropboxFolderHomeUrl,
  LARGE_FILE_WAITING_INSTRUCTION,
  largeFileStatusLabel,
  REMOVE_INCOMPLETE_INTAKE_ACTION_LABEL,
  REMOVE_INCOMPLETE_INTAKE_CONFIRM_LABEL,
  REMOVE_INCOMPLETE_INTAKE_CONFIRM_TITLE,
  REMOVE_INCOMPLETE_INTAKE_KEEP_LABEL,
  removeIncompleteIntakeConfirmationBody,
  visibleLargeFileIntakeMessage,
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
  onStartNewBatch?: () => void;
  onDismiss?: () => Promise<void> | void;
};

const COPY_FEEDBACK_MS = 2000;

const primaryButtonClass =
  "inline-flex items-center justify-center border border-[var(--ink)] bg-[var(--ink)] px-4 py-2 text-xs uppercase tracking-[0.12em] text-[var(--paper)] transition enabled:hover:bg-[var(--ink-soft)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]";

const secondaryButtonClass =
  "inline-flex items-center justify-center border border-[var(--ink)] bg-[var(--surface-elevated)] px-4 py-2 text-xs uppercase tracking-[0.12em] text-[var(--ink)] transition enabled:hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]";

const dismissButtonClass =
  "inline-flex max-w-full items-center justify-center border border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-3 text-left text-sm leading-relaxed text-[var(--danger)] transition enabled:hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--danger)]";

export function RemoveIncompleteIntakeConfirmView({
  inventoryId,
  titleId,
  error,
  pending,
  onKeep,
  onConfirm,
  onBackdropClick,
}: {
  inventoryId: number;
  titleId: string;
  error?: string | null;
  pending?: boolean;
  onKeep: () => void;
  onConfirm: () => void;
  onBackdropClick?: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--ink)]/40 p-4 sm:items-center"
      onClick={onBackdropClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md border border-[var(--ink)] bg-[var(--surface-elevated)] p-5 shadow-sm"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={titleId} className="font-display text-xl text-[var(--ink)]">
          {REMOVE_INCOMPLETE_INTAKE_CONFIRM_TITLE}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
          {removeIncompleteIntakeConfirmationBody(inventoryId)}
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
            disabled={pending}
            onClick={onKeep}
            className="min-h-11 px-5 py-3 text-sm uppercase tracking-[0.14em] text-[var(--muted)] transition hover:text-[var(--ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)] md:min-h-0"
          >
            {REMOVE_INCOMPLETE_INTAKE_KEEP_LABEL}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onConfirm}
            className={secondaryButtonClass}
          >
            {pending ? "Removing…" : REMOVE_INCOMPLETE_INTAKE_CONFIRM_LABEL}
          </button>
        </div>
      </div>
    </div>
  );
}

function CompactCopyRow({
  value,
  copyLabel,
  ariaLabel,
}: {
  value: string;
  copyLabel: string;
  ariaLabel: string;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  async function copyValue() {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    try {
      await navigator.clipboard.writeText(rawFilenameForCopy(value));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    resetTimer.current = setTimeout(() => setCopyState("idle"), COPY_FEEDBACK_MS);
  }

  const buttonText =
    copyState === "copied"
      ? "Copied"
      : copyState === "failed"
        ? "Copy failed"
        : copyLabel;

  return (
    <div className="flex min-w-0 items-center gap-2">
      <code className="min-w-0 flex-1 break-all font-mono text-[11px] leading-relaxed text-[var(--ink)] sm:text-xs">
        {value}
      </code>
      <button
        type="button"
        onClick={() => {
          void copyValue();
        }}
        aria-label={ariaLabel}
        className="shrink-0 border border-[var(--line)] bg-[var(--surface-elevated)] px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] transition hover:text-[var(--ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
      >
        {buttonText}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {copyState === "copied"
          ? `Copied ${value}`
          : copyState === "failed"
            ? `Could not copy ${value}`
            : ""}
      </span>
    </div>
  );
}

function statusBadgeClass(status: LargeFileIntakeStatus): string {
  switch (status) {
    case "master_found":
    case "completed":
      return "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]";
    case "file_not_found":
    case "incorrect_filename":
    case "unsupported_file":
    case "local_processing_required":
    case "failed":
      return "border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)]";
    default:
      return "border-[var(--line)] bg-[var(--surface-elevated)] text-[var(--ink)]";
  }
}

function showUploadSteps(status: LargeFileIntakeStatus): boolean {
  return (
    status === "waiting_for_dropbox" ||
    status === "file_not_found" ||
    status === "incorrect_filename"
  );
}

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
  onStartNewBatch,
  onDismiss,
}: LargeMasterIntakePanelProps) {
  const dismissTitleId = useId();
  const [dismissPhase, setDismissPhase] = useState<
    "idle" | "confirm" | "pending"
  >("idle");
  const [dismissError, setDismissError] = useState<string | null>(null);
  const busy = Boolean(checking || processing || dismissPhase === "pending");
  const folderPath = dropboxFolderDisplayPath(folderName);
  const openUrl = folderWebUrl ?? dropboxFolderHomeUrl(folderName);
  const statusLabel = largeFileStatusLabel(status);
  const visibleMessage = visibleLargeFileIntakeMessage(status, message);
  const showCheck =
    status !== "master_found" &&
    status !== "processing" &&
    status !== "completed";
  const showProcess =
    (status === "master_found" && canContinueProcessing) ||
    status === "processing";
  const showFolderButton =
    status !== "processing" &&
    status !== "completed" &&
    status !== "master_found";
  const messageIsError =
    status === "file_not_found" ||
    status === "incorrect_filename" ||
    status === "unsupported_file" ||
    status === "failed";
  const showDismiss =
    Boolean(onDismiss) &&
    status !== "completed" &&
    status !== "processing";
  const confirmOpen = dismissPhase === "confirm" || dismissPhase === "pending";

  async function confirmDismiss() {
    if (!onDismiss || dismissPhase === "pending") return;
    setDismissPhase("pending");
    setDismissError(null);
    try {
      await onDismiss();
      setDismissPhase("idle");
    } catch (error) {
      setDismissPhase("confirm");
      setDismissError(
        error instanceof Error
          ? error.message
          : "Could not remove this incomplete intake.",
      );
    }
  }

  function dismissButton(wrapperClassName: string) {
    return (
      <div className={wrapperClassName}>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setDismissError(null);
            setDismissPhase("confirm");
          }}
          className={dismissButtonClass}
        >
          {REMOVE_INCOMPLETE_INTAKE_ACTION_LABEL}
        </button>
      </div>
    );
  }

  return (
    <article className="border border-[var(--line)] bg-[var(--surface)] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h3 className="font-display text-2xl text-[var(--ink)]">{title}</h3>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Inventory {inventoryId}
            {byteLengthLabel ? ` · ${byteLengthLabel}` : ""}
            {dimensionsLabel ? ` · ${dimensionsLabel}` : ""}
          </p>
        </div>
        <p
          className={`shrink-0 border px-2 py-1 text-[10px] uppercase tracking-[0.12em] ${statusBadgeClass(status)}`}
          aria-live="polite"
        >
          {statusLabel}
        </p>
      </div>

      {status === "waiting_for_dropbox" ? (
        <p className="mt-4 text-sm leading-relaxed text-[var(--ink)]">
          {LARGE_FILE_WAITING_INSTRUCTION}
        </p>
      ) : null}

      {visibleMessage ? (
        <p
          role={messageIsError ? "alert" : "status"}
          className={`mt-4 text-sm leading-relaxed ${
            messageIsError ? "text-[var(--danger)]" : "text-[var(--ink)]"
          }`}
        >
          {visibleMessage}
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

      {status === "processing" ? (
        <div className="mt-4" role="status" aria-live="polite">
          <SubmittingStatusDots artworkCount={1} />
        </div>
      ) : null}

      {showUploadSteps(status) ? (
        <ol className="mt-5 list-decimal space-y-4 pl-5 text-sm leading-relaxed text-[var(--ink)]">
          <li>
            <p className="font-medium">Open the prepared Dropbox folder</p>
            {openUrl ? (
              <p className="mt-2">
                <a
                  href={openUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={primaryButtonClass}
                >
                  Open Dropbox folder
                </a>
              </p>
            ) : (
              <p className="mt-1 text-[var(--muted)]">
                Sign in at dropbox.com, then open the prepared folder.
              </p>
            )}
          </li>
          <li>
            <p className="font-medium">Rename the master file</p>
            <div className="mt-2">
              <CompactCopyRow
                value={masterFilename}
                copyLabel="Copy filename"
                ariaLabel={`Copy filename ${masterFilename}`}
              />
            </div>
          </li>
          <li>
            <p className="font-medium">Upload the renamed file to that folder</p>
            <p className="mt-1 text-[var(--muted)]">
              Wait until Dropbox confirms the upload is complete.
            </p>
          </li>
          <li>
            <p className="font-medium">Return here and check the file</p>
            {showCheck ? (
              <p className="mt-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={onCheck}
                  className={secondaryButtonClass}
                >
                  {checking ? "Checking Dropbox…" : "Check for uploaded file"}
                </button>
              </p>
            ) : null}
          </li>
        </ol>
      ) : null}

      {showUploadSteps(status) ? (
        <details className="mt-5 text-sm text-[var(--muted)]">
          <summary className="cursor-pointer select-none text-xs text-[var(--muted)] transition hover:text-[var(--ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]">
            Having trouble? Show folder details
          </summary>
          <div className="mt-3 space-y-3 border border-[var(--line)] bg-[var(--surface-elevated)] px-3 py-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.14em]">
                Dropbox folder path
              </p>
              <div className="mt-1">
                <CompactCopyRow
                  value={folderPath}
                  copyLabel="Copy folder path"
                  ariaLabel={`Copy folder path ${folderPath}`}
                />
              </div>
            </div>
            <p className="leading-relaxed">
              On Dropbox desktop, add the renamed file to this folder and wait
              for the green synced check.
            </p>
          </div>
        </details>
      ) : null}

      {showDismiss && showUploadSteps(status)
        ? dismissButton("mt-5")
        : null}

      {showFolderButton && !showUploadSteps(status) && openUrl ? (
        <p className="mt-5">
          <a
            href={openUrl}
            target="_blank"
            rel="noreferrer"
            className={secondaryButtonClass}
          >
            Open Dropbox folder
          </a>
        </p>
      ) : null}

      {showCheck && !showUploadSteps(status) ? (
        <div className="mt-5">
          <button
            type="button"
            disabled={busy}
            onClick={onCheck}
            className={secondaryButtonClass}
          >
            {checking ? "Checking Dropbox…" : "Check for uploaded file"}
          </button>
        </div>
      ) : null}

      {showProcess ? (
        <div className="mt-5">
          <button
            type="button"
            disabled={busy}
            onClick={onContinue}
            className={primaryButtonClass}
          >
            {processing ? "Processing artwork…" : "Process artwork"}
          </button>
        </div>
      ) : null}

      {showDismiss && !showUploadSteps(status)
        ? dismissButton("mt-5")
        : null}

      {status === "completed" ? (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <a href={`/artworks/${inventoryId}`} className={primaryButtonClass}>
            View artwork
          </a>
          {onStartNewBatch ? (
            <button
              type="button"
              onClick={onStartNewBatch}
              className={secondaryButtonClass}
            >
              Start new batch
            </button>
          ) : null}
        </div>
      ) : null}

      {confirmOpen ? (
        <RemoveIncompleteIntakeConfirmView
          inventoryId={inventoryId}
          titleId={dismissTitleId}
          error={dismissError}
          pending={dismissPhase === "pending"}
          onKeep={() => setDismissPhase("idle")}
          onConfirm={() => {
            void confirmDismiss();
          }}
          onBackdropClick={() => {
            if (dismissPhase !== "pending") setDismissPhase("idle");
          }}
        />
      ) : null}
    </article>
  );
}
