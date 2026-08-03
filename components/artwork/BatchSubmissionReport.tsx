"use client";

import { formatFileSize } from "@/lib/artwork/validation";
import type { BatchSubmissionResult } from "@/lib/submission/types";

type BatchSubmissionReportProps = {
  result: Extract<BatchSubmissionResult, { ok: true }>;
  onStartNewBatch: () => void;
};

const STAGE_LABELS: Record<string, string> = {
  pending: "Pending",
  claimed: "Claimed",
  processing: "Processing",
  folder_created: "Creating Dropbox folder",
  master_uploaded: "Uploading Master",
  derivatives_generated: "Generating derivatives",
  hr_uploaded: "Uploading High Resolution",
  web_uploaded: "Uploading Web",
  metadata_uploaded: "Writing metadata file",
  sheet_row_appended: "Writing Inventory",
  completed: "Complete",
  failed: "Failed",
  reconciliation_required: "Reconciliation required",
};

const OPERATION_LABELS: Record<string, string> = {
  mark_claim_processing: "Marking claim Processing",
  create_folder: "Creating Dropbox folder",
  upload_master: "Uploading Master",
  generate_derivatives: "Generating derivatives",
  upload_hr: "Uploading High Resolution",
  upload_web: "Uploading Web",
  upload_metadata: "Uploading metadata file",
  append_inventory_row: "Writing Inventory",
  mark_claim_completed: "Complete",
};

function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage.replace(/_/g, " ");
}

function operationLabel(operation: string): string {
  return OPERATION_LABELS[operation] ?? operation.replace(/_/g, " ");
}

export function BatchSubmissionReport({
  result,
  onStartNewBatch,
}: BatchSubmissionReportProps) {
  const successes = result.artworks.filter((a) => a.ok);
  const failures = result.artworks.filter((a) => !a.ok);

  return (
    <div className="animate-fade-in">
      <header className="max-w-2xl">
        <p className="text-xs uppercase tracking-[0.22em] text-[var(--accent)]">
          Kim Artwork Archive
        </p>
        <h1 className="mt-3 font-display text-4xl tracking-tight text-[var(--ink)] sm:text-5xl">
          Submission complete
        </h1>
        <p className="mt-4 text-[var(--muted)] leading-relaxed">
          Permanent files (including Inventory-ID metadata) are in Dropbox. The
          inventory database is in Google Sheets. This app does not retain the
          archive after delivery.
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
            <dd className="text-sm text-[var(--ink)]">{result.total}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
              Completed
            </dt>
            <dd className="text-sm text-[var(--ink)]">{result.completed}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
              Failed
            </dt>
            <dd className="text-sm text-[var(--ink)]">{result.failed}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
              Reconciliation required
            </dt>
            <dd className="text-sm text-[var(--ink)]">
              {result.reconciliationRequired}
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
            <article
              key={artwork.clientArtworkId}
              className="border border-[var(--line)] bg-[var(--surface)] p-4"
            >
              <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
                Inventory {artwork.inventoryId}
                {artwork.stage === "reconciliation_required"
                  ? " · Reconciliation required"
                  : ""}
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
            </article>
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
          <p className="text-sm text-[var(--muted)]">
            Failed inventory IDs remain consumed. Inspect Failed Intake, then
            start a new batch for any work that needs resubmission. Do not
            automatically retry.
          </p>
          {failures.map((artwork) => (
            <article
              key={artwork.clientArtworkId}
              className="border border-[var(--danger)] bg-[var(--danger-soft)] p-4"
            >
              <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--danger)]">
                {artwork.inventoryId != null
                  ? `Inventory ${artwork.inventoryId}`
                  : "No inventory ID"}
                {artwork.failedOperation
                  ? ` · Failed during ${operationLabel(artwork.failedOperation)}`
                  : ` · Failed at ${stageLabel(artwork.stage)}`}
              </p>
              <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
                Last completed: {stageLabel(artwork.lastCompletedStage)}
              </p>
              <h3 className="mt-1 font-display text-2xl text-[var(--ink)]">
                {artwork.title}
              </h3>
              <p className="mt-2 text-sm text-[var(--ink)]">{artwork.message}</p>
              <p className="mt-2 text-sm text-[var(--muted)]">
                Folder moved to Failed Intake:{" "}
                {artwork.cleanup.folderMovedToFailedIntake === null
                  ? "not applicable"
                  : artwork.cleanup.folderMovedToFailedIntake
                    ? "yes"
                    : "no"}
              </p>
              {artwork.cleanup.cleanupWarnings.map((warning) => (
                <p key={warning} className="mt-1 text-sm text-[var(--danger)]">
                  Cleanup warning: {warning}
                </p>
              ))}
              {artwork.reconciliationWarnings.map((warning) => (
                <p key={warning.code} className="mt-1 text-sm text-[var(--danger)]">
                  Reconciliation: {warning.message}
                </p>
              ))}
            </article>
          ))}
        </section>
      ) : null}

      <div className="mt-10 flex flex-col gap-3 border-t border-[var(--line)] pt-6 sm:flex-row sm:flex-wrap sm:justify-end">
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
        <button
          type="button"
          onClick={onStartNewBatch}
          className="border border-[var(--ink)] bg-[var(--ink)] px-6 py-3 text-sm uppercase tracking-[0.14em] text-[var(--paper)] transition hover:bg-[var(--ink-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          Start New Batch
        </button>
      </div>
    </div>
  );
}

export function formatBatchSourceSize(bytes: number): string {
  return formatFileSize(bytes);
}
