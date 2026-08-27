"use client";

import type { ReactNode } from "react";

import { BatchStepHeading } from "@/components/artwork/BatchStepHeading";
import { formatFileSize } from "@/lib/artwork/validation";
import {
  failedArtworkProgressLines,
  failedDuringLabel,
  partitionBatchArtworkResults,
  submissionReportHeading,
  submissionReportLead,
  summarizeBatchArtworkResults,
} from "@/lib/submission/batch-results";
import type {
  ArtworkSubmissionFailure,
  ArtworkSubmissionSuccess,
  BatchSubmissionResult,
} from "@/lib/submission/types";

type BatchSubmissionReportProps = {
  result: Extract<BatchSubmissionResult, { ok: true }>;
  onStartNewBatch: () => void;
};

function ResultCard({
  children,
  accent = "default",
}: {
  children: ReactNode;
  accent?: "default" | "danger" | "attention";
}) {
  const border =
    accent === "danger"
      ? "border-[var(--danger)]"
      : accent === "attention"
        ? "border-[var(--accent)]"
        : "border-[var(--line)]";
  return (
    <article className={`border ${border} bg-[var(--surface)] p-4`}>
      {children}
    </article>
  );
}

function SuccessArtworkCard({ artwork }: { artwork: ArtworkSubmissionSuccess }) {
  return (
    <ResultCard>
      <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
        Inventory {artwork.inventoryId}
      </p>
      <h3 className="mt-1 font-display text-2xl text-[var(--ink)]">
        {artwork.title}
      </h3>
      <ul className="mt-3 space-y-1 text-sm">
        {artwork.driveFolder ? (
          <li>
            <a
              href={artwork.driveFolder.webViewLink}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--accent)] underline-offset-2 hover:underline"
            >
              Dropbox folder
            </a>
          </li>
        ) : null}
        {artwork.master ? (
          <li>
            <a
              href={artwork.master.webViewLink}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--accent)] underline-offset-2 hover:underline"
            >
              Master
            </a>
          </li>
        ) : null}
        {artwork.hr ? (
          <li>
            <a
              href={artwork.hr.webViewLink}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--accent)] underline-offset-2 hover:underline"
            >
              High resolution
            </a>
          </li>
        ) : null}
        {artwork.web ? (
          <li>
            <a
              href={artwork.web.webViewLink}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--accent)] underline-offset-2 hover:underline"
            >
              Web
            </a>
          </li>
        ) : null}
        <li className="text-[var(--ink)]">Inventory row recorded</li>
      </ul>
    </ResultCard>
  );
}

function FailedArtworkCard({ artwork }: { artwork: ArtworkSubmissionFailure }) {
  return (
    <ResultCard accent="danger">
      <h3 className="font-display text-2xl text-[var(--ink)]">{artwork.title}</h3>
      {artwork.inventoryId != null ? (
        <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
          Inventory {artwork.inventoryId}
        </p>
      ) : null}
      <ul className="mt-3 space-y-1 text-sm text-[var(--ink)]">
        <li>Failed during: {failedDuringLabel(artwork.failedOperation, artwork.stage)}</li>
        {failedArtworkProgressLines(artwork).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-[var(--ink)]">{artwork.message}</p>
    </ResultCard>
  );
}

function ReconciliationArtworkCard({
  artwork,
}: {
  artwork: ArtworkSubmissionSuccess;
}) {
  return (
    <ResultCard accent="attention">
      <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--accent)]">
        Inventory {artwork.inventoryId} · Reconciliation required
      </p>
      <h3 className="mt-1 font-display text-2xl text-[var(--ink)]">
        {artwork.title}
      </h3>
      <ul className="mt-3 space-y-1 text-sm">
        {artwork.driveFolder ? (
          <li>
            <a
              href={artwork.driveFolder.webViewLink}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--accent)] underline-offset-2 hover:underline"
            >
              Dropbox folder
            </a>
          </li>
        ) : null}
        {artwork.master ? (
          <li>
            <a
              href={artwork.master.webViewLink}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--accent)] underline-offset-2 hover:underline"
            >
              Master
            </a>
          </li>
        ) : null}
        {artwork.hr ? (
          <li>
            <a
              href={artwork.hr.webViewLink}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--accent)] underline-offset-2 hover:underline"
            >
              High resolution
            </a>
          </li>
        ) : null}
        {artwork.web ? (
          <li>
            <a
              href={artwork.web.webViewLink}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--accent)] underline-offset-2 hover:underline"
            >
              Web
            </a>
          </li>
        ) : null}
        <li className="text-[var(--ink)]">
          {artwork.sheetRowWritten
            ? "Inventory row recorded"
            : "Inventory row not recorded"}
        </li>
      </ul>
      {artwork.reconciliationWarnings.length > 0 ? (
        <div
          role="status"
          className="mt-3 border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-2 text-sm"
        >
          {artwork.reconciliationWarnings.map((warning) => (
            <p key={warning.code}>{warning.message}</p>
          ))}
        </div>
      ) : null}
    </ResultCard>
  );
}

export function BatchSubmissionReport({
  result,
  onStartNewBatch,
}: BatchSubmissionReportProps) {
  const summary = summarizeBatchArtworkResults(result.artworks);
  const { successes, failures, reconciliations } = partitionBatchArtworkResults(
    result.artworks,
  );
  const heading = submissionReportHeading(summary);
  const lead = submissionReportLead(summary);

  return (
    <div className="animate-fade-in">
      <header>
        <p className="text-xs uppercase tracking-[0.22em] text-[var(--accent)]">
          Kim Artwork Archive
        </p>
        <div className="mt-3 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <BatchStepHeading>{heading}</BatchStepHeading>
          <button
            type="button"
            onClick={onStartNewBatch}
            className="shrink-0 border border-[var(--ink)] bg-[var(--ink)] px-6 py-3 text-sm uppercase tracking-[0.14em] text-[var(--paper)] transition hover:bg-[var(--ink-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            Start New Batch
          </button>
        </div>
        <p className="mt-4 max-w-2xl text-[var(--muted)] leading-relaxed">
          {lead}
        </p>
      </header>

      {result.archiveTarget === "test" ? (
        <div
          role="status"
          className="mt-6 border-2 border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]"
        >
          <p className="font-medium uppercase tracking-[0.14em]">
            Test archive
          </p>
          <p className="mt-1">
            This batch was written to the TEST Sheet and Dropbox App Folder, not
            production.
          </p>
        </div>
      ) : null}

      <section
        className="mt-8 border border-[var(--line)] bg-[var(--surface)] px-4 py-4"
        aria-labelledby="batch-summary-heading"
      >
        <h2
          id="batch-summary-heading"
          className="font-display text-xl text-[var(--ink)]"
        >
          Batch summary
        </h2>
        <dl className="mt-3 grid gap-2 sm:grid-cols-2">
          <div>
            <dt className="text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
              Total artworks
            </dt>
            <dd className="text-sm text-[var(--ink)]">{summary.total}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
              Completed
            </dt>
            <dd className="text-sm text-[var(--ink)]">{summary.completed}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
              Failed
            </dt>
            <dd className="text-sm text-[var(--ink)]">{summary.failed}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
              Reconciliation required
            </dt>
            <dd className="text-sm text-[var(--ink)]">
              {summary.reconciliationRequired}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
              Submission-attempt ID
            </dt>
            <dd className="break-all font-mono text-xs text-[var(--ink)]">
              {result.submissionAttemptId}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
              Completed at
            </dt>
            <dd className="text-sm text-[var(--ink)]">
              {new Date(result.completedAt).toLocaleString()}
            </dd>
          </div>
        </dl>
      </section>

      {successes.length > 0 ? (
        <section className="mt-10 space-y-4" aria-labelledby="success-heading">
          <h2
            id="success-heading"
            className="font-display text-xl text-[var(--ink)]"
          >
            Successful artworks
          </h2>
          {successes.map((artwork) => (
            <SuccessArtworkCard
              key={artwork.clientArtworkId}
              artwork={artwork}
            />
          ))}
        </section>
      ) : null}

      {failures.length > 0 ? (
        <section className="mt-10 space-y-4" aria-labelledby="failed-heading">
          <h2
            id="failed-heading"
            className="font-display text-xl text-[var(--ink)]"
          >
            Failed artworks
          </h2>
          {failures.map((artwork) => (
            <FailedArtworkCard
              key={artwork.clientArtworkId}
              artwork={artwork}
            />
          ))}
        </section>
      ) : null}

      {reconciliations.length > 0 ? (
        <section
          className="mt-10 space-y-4"
          aria-labelledby="reconciliation-heading"
        >
          <h2
            id="reconciliation-heading"
            className="font-display text-xl text-[var(--ink)]"
          >
            Reconciliation required
          </h2>
          {reconciliations.map((artwork) => (
            <ReconciliationArtworkCard
              key={artwork.clientArtworkId}
              artwork={artwork}
            />
          ))}
        </section>
      ) : null}

      {result.sheetUrl || result.driveRootUrl ? (
        <div className="mt-10 flex flex-col gap-3 border-t border-[var(--line)] pt-6 sm:flex-row sm:flex-wrap sm:justify-center">
          {result.sheetUrl ? (
            <a
              href={result.sheetUrl}
              target="_blank"
              rel="noreferrer"
              className="border border-[var(--line)] bg-[var(--surface-elevated)] px-5 py-3 text-center text-sm uppercase tracking-[0.14em] text-[var(--ink)] transition hover:bg-[var(--surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              Open Google Sheet
            </a>
          ) : null}
          {result.driveRootUrl ? (
            <a
              href={result.driveRootUrl}
              target="_blank"
              rel="noreferrer"
              className="border border-[var(--line)] bg-[var(--surface-elevated)] px-5 py-3 text-center text-sm uppercase tracking-[0.14em] text-[var(--ink)] transition hover:bg-[var(--surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              Open Dropbox Archive
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function formatBatchSourceSize(bytes: number): string {
  return formatFileSize(bytes);
}
