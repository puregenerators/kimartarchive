"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import {
  ARCHIVE_SETUP_COPY,
  ARCHIVE_SETUP_DESTINATIONS,
  buildArchiveSetupView,
} from "@/lib/archive/setup-presentation";
import type { DropboxDiagnostics } from "@/lib/dropbox/types";
import type { GoogleDiagnostics } from "@/lib/google/diagnostic-types";

type UploadTestStepKey =
  | "folderCreated"
  | "uploadSucceeded"
  | "metadataVerified"
  | "sharedLinkCreated"
  | "downloadVerified"
  | "fileDeleted"
  | "folderDeleted";

export type UploadTestUiResult = {
  success: boolean;
  message: string;
  failedOperationLabel: string | null;
  folderCreated: boolean;
  uploadSucceeded: boolean;
  metadataVerified: boolean;
  sharedLinkCreated: boolean;
  downloadVerified: boolean;
  fileDeleted: boolean;
  folderDeleted: boolean;
};

export type ArchiveSetupMessage = {
  ok: boolean;
  message: string;
};

export type ArchiveSetupViewProps = {
  google: GoogleDiagnostics;
  dropbox: DropboxDiagnostics;
  pending: boolean;
  message: ArchiveSetupMessage | null;
  confirmDisconnect: boolean;
  uploadTestPending: boolean;
  uploadTestResult: UploadTestUiResult | null;
  onRefresh: () => void;
  onDisconnectClick: () => void;
  onConfirmDisconnect: () => void;
  onCancelDisconnect: () => void;
  onRunDiagnostics: () => void;
  onRunUploadTest: () => void;
};

function StatusLabel({ ok, label }: { ok: boolean; label: string }) {
  return (
    <p
      className={[
        "text-base font-medium",
        ok ? "text-[var(--accent)]" : "text-[var(--danger)]",
      ].join(" ")}
    >
      {label}
    </p>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border border-[var(--line)] bg-[var(--surface)] p-5">
      <h2 className="font-display text-xl text-[var(--ink)]">{title}</h2>
      <div className="mt-4 space-y-3 text-sm text-[var(--ink-soft)]">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-[var(--line)] py-2 sm:flex-row sm:justify-between sm:gap-4">
      <dt className="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
        {label}
      </dt>
      <dd className="text-sm text-[var(--ink)] sm:text-right">{value}</dd>
    </div>
  );
}

function SettingsLinkCard({
  href,
  title,
  description,
  cta,
  external,
}: {
  href: string;
  title: string;
  description: string;
  cta: string;
  external?: boolean;
}) {
  const className =
    "block border border-[var(--line)] bg-[var(--surface)] p-5 transition hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]";

  const body = (
    <>
      <h3 className="font-display text-lg text-[var(--ink)]">{title}</h3>
      <p className="mt-2 text-sm text-[var(--muted)] leading-relaxed">
        {description}
      </p>
      <p className="mt-3 text-sm text-[var(--accent)]">{cta}</p>
    </>
  );

  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={className}
      >
        {body}
      </a>
    );
  }

  return (
    <Link href={href} className={className}>
      {body}
    </Link>
  );
}

function SecondaryButton({
  href,
  children,
  disabled,
  onClick,
}: {
  href?: string;
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const className =
    "inline-flex border border-[var(--line)] bg-[var(--surface-elevated)] px-4 py-2 text-xs uppercase tracking-[0.12em] text-[var(--ink)] disabled:opacity-40";

  if (href && !disabled) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }

  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function ArchiveSetupView({
  google,
  dropbox,
  pending,
  message,
  confirmDisconnect,
  uploadTestPending,
  uploadTestResult,
  onRefresh,
  onDisconnectClick,
  onConfirmDisconnect,
  onCancelDisconnect,
  onRunDiagnostics,
  onRunUploadTest,
}: ArchiveSetupViewProps) {
  const view = buildArchiveSetupView(google, dropbox);

  return (
    <div className="space-y-6">
      {message ? (
        <div
          role="status"
          className={[
            "border px-4 py-3 text-sm",
            message.ok
              ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--ink)]"
              : "border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)]",
          ].join(" ")}
        >
          {message.message}
        </div>
      ) : null}

      <section className="border border-[var(--line)] bg-[var(--surface)] p-5">
        <h2 className="font-display text-xl text-[var(--ink)]">
          {ARCHIVE_SETUP_COPY.statusTitle}
        </h2>
        <div className="mt-4 space-y-3">
          <StatusLabel ok={view.overall.ok} label={view.overall.label} />
          <p className="text-sm text-[var(--ink)]">{view.overall.explanation}</p>
          <div>
            <button
              type="button"
              onClick={onRefresh}
              disabled={pending}
              className="border border-[var(--line)] bg-[var(--surface-elevated)] px-4 py-2 text-sm text-[var(--ink)] disabled:opacity-50"
            >
              {ARCHIVE_SETUP_COPY.refresh}
            </button>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-xl text-[var(--ink)]">
          {ARCHIVE_SETUP_COPY.settingsTitle}
        </h2>
        <div className="space-y-3">
          <SettingsLinkCard
            href={ARCHIVE_SETUP_DESTINATIONS.archiveSettings}
            title={ARCHIVE_SETUP_COPY.archiveSettingsTitle}
            description={ARCHIVE_SETUP_COPY.archiveSettingsDescription}
            cta={ARCHIVE_SETUP_COPY.archiveSettingsCta}
            external
          />
          <SettingsLinkCard
            href={ARCHIVE_SETUP_DESTINATIONS.databaseSettings}
            title={ARCHIVE_SETUP_COPY.databaseSettingsTitle}
            description={ARCHIVE_SETUP_COPY.databaseSettingsDescription}
            cta={ARCHIVE_SETUP_COPY.databaseSettingsCta}
          />
        </div>
      </section>

      <Card title={ARCHIVE_SETUP_COPY.databaseTitle}>
        <StatusLabel ok={view.database.ok} label={view.database.label} />
        {view.database.detail ? (
          <p className="text-sm text-[var(--ink)]">{view.database.detail}</p>
        ) : null}
        <p className="text-sm text-[var(--ink)]">{view.database.explanation}</p>
      </Card>

      <Card title={ARCHIVE_SETUP_COPY.filesTitle}>
        <StatusLabel ok={view.files.ok} label={view.files.label} />
        {view.files.detail ? (
          <p className="text-sm text-[var(--ink)]">{view.files.detail}</p>
        ) : null}
        {view.files.savingTo ? (
          <p className="text-sm text-[var(--ink)]">{view.files.savingTo}</p>
        ) : null}
        <p className="text-sm text-[var(--ink)]">{view.files.explanation}</p>
        {!view.files.ok && view.dropboxEnvReady ? (
          <div className="pt-1">
            <Link
              href={ARCHIVE_SETUP_DESTINATIONS.dropboxConnect}
              className={
                view.dropboxConnected
                  ? "inline-flex border border-[var(--line)] bg-[var(--surface-elevated)] px-4 py-2 text-xs uppercase tracking-[0.12em] text-[var(--ink)]"
                  : "inline-flex border border-[var(--ink)] bg-[var(--ink)] px-4 py-2 text-xs uppercase tracking-[0.12em] text-[var(--paper)]"
              }
            >
              {view.dropboxConnected
                ? ARCHIVE_SETUP_COPY.reconnect
                : ARCHIVE_SETUP_COPY.connectDropbox}
            </Link>
          </div>
        ) : null}
      </Card>

      <Card title={ARCHIVE_SETUP_COPY.connectionCheckTitle}>
        <StatusLabel
          ok={view.connectionCheck.ok}
          label={view.connectionCheck.label}
        />
        <p className="text-sm text-[var(--ink)]">
          {view.connectionCheck.explanation}
        </p>
      </Card>

      <details className="border border-[var(--line)] bg-[var(--surface)]">
        <summary className="cursor-pointer select-none px-5 py-3 text-sm text-[var(--muted)] transition marker:text-[var(--muted)] hover:text-[var(--ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]">
          {ARCHIVE_SETUP_COPY.technicalDetails}
        </summary>
        <div className="space-y-6 border-t border-[var(--line)] px-5 py-5">
          <p className="text-xs text-[var(--muted)]">
            Checked at {new Date(dropbox.checkedAt).toLocaleString()}
          </p>

          <div className="space-y-3">
            <h3 className="font-display text-lg text-[var(--ink)]">
              Artwork database
            </h3>
            {google.sheets.ok ? (
              <dl>
                <Row
                  label="Spreadsheet title"
                  value={google.sheets.title ?? "—"}
                />
              </dl>
            ) : (
              <p className="text-sm text-[var(--danger)]">
                {google.sheets.error
                  ? google.sheets.error.message
                  : "Google Sheets is not reachable."}
              </p>
            )}
          </div>

          <div className="space-y-3">
            <h3 className="font-display text-lg text-[var(--ink)]">Dropbox</h3>
            <p className="text-sm text-[var(--ink)]">
              {dropbox.overall.explanation}
            </p>
            <dl>
              <Row
                label="Connected"
                value={dropbox.connected ? "Yes" : "No"}
              />
              <Row
                label="Account"
                value={
                  dropbox.account
                    ? `${dropbox.account.displayName} · ${dropbox.account.email}`
                    : "—"
                }
              />
              <Row
                label="Archive folder"
                value={dropbox.archiveFolder.displayPath}
              />
            </dl>
            <div className="flex flex-wrap gap-2 pt-1">
              {!view.dropboxConnected ? (
                <SecondaryButton
                  href={ARCHIVE_SETUP_DESTINATIONS.dropboxConnect}
                  disabled={!view.dropboxEnvReady || pending}
                >
                  {ARCHIVE_SETUP_COPY.connectDropbox}
                </SecondaryButton>
              ) : (
                <>
                  <SecondaryButton
                    href={ARCHIVE_SETUP_DESTINATIONS.dropboxConnect}
                    disabled={!view.dropboxEnvReady || pending}
                  >
                    {ARCHIVE_SETUP_COPY.reconnect}
                  </SecondaryButton>
                  <SecondaryButton
                    disabled={pending}
                    onClick={onDisconnectClick}
                  >
                    {ARCHIVE_SETUP_COPY.disconnect}
                  </SecondaryButton>
                </>
              )}
              <SecondaryButton disabled={pending} onClick={onRunDiagnostics}>
                Run diagnostics
              </SecondaryButton>
              <SecondaryButton
                disabled={!view.dropboxConnected || pending || uploadTestPending}
                onClick={onRunUploadTest}
              >
                {uploadTestPending
                  ? "Running upload test…"
                  : "Run Dropbox upload test"}
              </SecondaryButton>
            </div>

            {uploadTestResult ? (
              <div
                className={[
                  "space-y-2 border px-3 py-3",
                  uploadTestResult.success
                    ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                    : "border-[var(--danger)] bg-[var(--danger-soft)]",
                ].join(" ")}
              >
                <p className="text-sm text-[var(--ink)]">
                  {uploadTestResult.success
                    ? "Dropbox upload integration test passed."
                    : uploadTestResult.message}
                </p>
                <ul className="space-y-1 text-sm text-[var(--ink)]">
                  {(
                    [
                      ["folderCreated", "Folder created"],
                      ["uploadSucceeded", "File uploaded"],
                      ["metadataVerified", "Metadata verified"],
                      ["sharedLinkCreated", "Shared link created"],
                      ["downloadVerified", "Download verified"],
                      ["fileDeleted", "File deleted"],
                      ["folderDeleted", "Folder deleted"],
                    ] as const satisfies ReadonlyArray<
                      readonly [UploadTestStepKey, string]
                    >
                  ).map(([key, label]) => {
                    const ok = uploadTestResult[key];
                    const failedHere =
                      !uploadTestResult.success &&
                      uploadTestResult.failedOperationLabel === label;
                    return (
                      <li key={key} className="flex items-center gap-2">
                        <span aria-hidden="true">
                          {ok ? "✓" : failedHere ? "✗" : "·"}
                        </span>
                        <span
                          className={
                            ok
                              ? "text-[var(--ink)]"
                              : failedHere
                                ? "text-[var(--danger)]"
                                : "text-[var(--muted)]"
                          }
                        >
                          {label}
                          {failedHere ? " — failed" : ""}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            {confirmDisconnect ? (
              <div className="space-y-2 bg-[var(--danger-soft)] p-3">
                <p className="text-sm text-[var(--danger)]">
                  Remove the local Dropbox refresh token? You will need to Connect
                  again before uploads can use Dropbox.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={onConfirmDisconnect}
                    className="border border-[var(--ink)] bg-[var(--ink)] px-4 py-2 text-xs uppercase tracking-[0.12em] text-[var(--paper)] disabled:opacity-40"
                  >
                    Confirm disconnect
                  </button>
                  <SecondaryButton onClick={onCancelDisconnect}>
                    Cancel
                  </SecondaryButton>
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-3">
            <h3 className="font-display text-lg text-[var(--ink)]">
              Connection checks
            </h3>
            <ul className="space-y-2">
              {dropbox.steps.map((step) => (
                <li
                  key={step.id}
                  className="flex flex-col gap-1 border-b border-[var(--line)] py-2 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div>
                    <p className="text-sm text-[var(--ink)]">{step.label}</p>
                    <p className="text-xs text-[var(--muted)]">{step.message}</p>
                  </div>
                  <span
                    className={[
                      "inline-flex items-center px-2 py-0.5 text-[11px] uppercase tracking-[0.12em]",
                      step.ok
                        ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                        : "bg-[var(--danger-soft)] text-[var(--danger)]",
                    ].join(" ")}
                  >
                    {step.ok ? "Pass" : "Fail"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </details>

      {view.readyForIntake ? (
        <div className="pt-4 sm:pt-8">
          <Link
            href={ARCHIVE_SETUP_DESTINATIONS.intake}
            className="inline-flex border border-[var(--ink)] bg-[var(--ink)] px-6 py-3 text-sm uppercase tracking-[0.14em] text-[var(--paper)] transition hover:bg-[var(--ink-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            {ARCHIVE_SETUP_COPY.continue}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
