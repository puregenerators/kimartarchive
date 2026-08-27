"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { DropboxDiagnostics } from "@/lib/dropbox/types";
import type { GoogleDiagnostics } from "@/lib/google/diagnostic-types";
import type { SheetTabName } from "@/lib/google/diagnostic-types";
import {
  ARCHIVE_STATUS_COPY,
  buildArchiveStatusView,
} from "@/lib/google/archive-status-presentation";
import {
  ARTWORK_INVENTORY_TAB,
  INVENTORY_CLAIMS_TAB,
} from "@/lib/google/headers";
import { FAILED_INTAKE_FOLDER_NAME } from "@/lib/google/drive-query";

export type ArchiveStatusMessage = {
  ok: boolean;
  message: string;
};

export type ArchiveStatusViewProps = {
  diagnostics: GoogleDiagnostics;
  dropbox: DropboxDiagnostics;
  pending: boolean;
  message: ArchiveStatusMessage | null;
  confirmHeadersTab: SheetTabName | null;
  confirmFailedIntake: boolean;
  confirmThumbnailColumn: boolean;
  onRefresh: () => void;
  onPrepareHeaders: (tab: SheetTabName) => void;
  onCancelHeaders: () => void;
  onConfirmHeaders: (tab: SheetTabName) => void;
  onPrepareThumbnail: () => void;
  onCancelThumbnail: () => void;
  onConfirmThumbnail: () => void;
  onPrepareFailedIntake: () => void;
  onCancelFailedIntake: () => void;
  onConfirmFailedIntake: () => void;
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

function PermissionWarning({ message }: { message: string }) {
  return (
    <p
      role="status"
      className="border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]"
    >
      {message}
    </p>
  );
}

export function ArchiveStatusView({
  diagnostics,
  dropbox,
  pending,
  message,
  confirmHeadersTab,
  confirmFailedIntake,
  confirmThumbnailColumn,
  onRefresh,
  onPrepareHeaders,
  onCancelHeaders,
  onConfirmHeaders,
  onPrepareThumbnail,
  onCancelThumbnail,
  onConfirmThumbnail,
  onPrepareFailedIntake,
  onCancelFailedIntake,
  onConfirmFailedIntake,
}: ArchiveStatusViewProps) {
  const view = buildArchiveStatusView(diagnostics, dropbox);
  const { config, sheets, drive, expectedHeaders, archiveTarget } = diagnostics;
  const sheetsHasEditor = sheets.permission?.hasEditorAccess === true;
  const driveHasEditor = drive.permission?.hasEditorAccess === true;
  const sheetsEditorBlockReason =
    "Disabled: Google Sheets must grant Editor access to the service account.";
  const driveEditorBlockReason =
    "Disabled: Google Drive must grant Editor access to the service account.";

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
          {ARCHIVE_STATUS_COPY.pageTitle}
        </h2>
        <div className="mt-4 space-y-3">
          <StatusLabel ok={view.overall.ok} label={view.overall.label} />
          <p className="text-sm text-[var(--ink)]">{view.overall.explanation}</p>
        </div>
      </section>

      <Card title={ARCHIVE_STATUS_COPY.databaseTitle}>
        <StatusLabel ok={view.database.ok} label={view.database.label} />
        {view.database.detail ? (
          <p className="text-sm text-[var(--ink)]">{view.database.detail}</p>
        ) : null}
        <p className="text-sm text-[var(--ink)]">{view.database.explanation}</p>
      </Card>

      <Card title={ARCHIVE_STATUS_COPY.filesTitle}>
        <StatusLabel ok={view.files.ok} label={view.files.label} />
        {view.files.detail ? (
          <p className="text-sm text-[var(--ink)]">{view.files.detail}</p>
        ) : null}
        <p className="text-sm text-[var(--ink)]">{view.files.explanation}</p>
        {!view.files.ok && config.storageKind === "dropbox" ? (
          <p className="text-sm">
            <Link
              href="/setup/archive"
              className="text-[var(--accent)] underline-offset-2 hover:underline"
            >
              Archive setup
            </Link>
          </p>
        ) : null}
      </Card>

      <Card title={ARCHIVE_STATUS_COPY.targetTitle}>
        <StatusLabel ok={view.target.ok} label={view.target.label} />
        <p className="text-sm text-[var(--ink)]">{view.target.explanation}</p>
      </Card>

      <div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={pending}
          className="border border-[var(--line)] bg-[var(--surface-elevated)] px-4 py-2 text-sm text-[var(--ink)] disabled:opacity-50"
        >
          {ARCHIVE_STATUS_COPY.refresh}
        </button>
      </div>

      <details className="border border-[var(--line)] bg-[var(--surface)]">
        <summary className="cursor-pointer select-none px-5 py-3 text-sm text-[var(--muted)] transition marker:text-[var(--muted)] hover:text-[var(--ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]">
          {ARCHIVE_STATUS_COPY.technicalDetails}
        </summary>
        <div className="space-y-6 border-t border-[var(--line)] px-5 py-5">
          <p className="text-xs text-[var(--muted)]">
            Checked at {new Date(diagnostics.checkedAt).toLocaleString()}
          </p>

          <div className="space-y-3">
            <h3 className="font-display text-lg text-[var(--ink)]">
              Google configuration
            </h3>
            <p className="text-sm text-[var(--muted)]">
              Storage provider:{" "}
              <code className="text-[var(--ink)]">{config.storageKind}</code>
              {config.driveRootRequired
                ? " (Drive root required)"
                : " (Drive root optional — legacy only)"}
            </p>
            <dl>
              {(
                [
                  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
                  "GOOGLE_PRIVATE_KEY",
                  "GOOGLE_SHEET_ID",
                  "GOOGLE_DRIVE_ROOT_FOLDER_ID",
                ] as const
              ).map((key) => {
                const present = config.presence[key];
                const optionalDriveRoot =
                  key === "GOOGLE_DRIVE_ROOT_FOLDER_ID" &&
                  !config.driveRootRequired;
                return (
                  <Row
                    key={key}
                    label={key}
                    value={
                      present
                        ? "Present"
                        : optionalDriveRoot
                          ? "Not set (optional)"
                          : "Missing"
                    }
                  />
                );
              })}
            </dl>
            {config.missing.length > 0 ? (
              <p className="text-sm text-[var(--danger)]">
                Missing: {config.missing.join(", ")}. See docs/GOOGLE_SETUP.md.
              </p>
            ) : (
              <p className="text-sm text-[var(--muted)]">
                Values are not shown. Credentials stay on the server.
              </p>
            )}
          </div>

          <div className="space-y-3">
            <h3 className="font-display text-lg text-[var(--ink)]">
              Archive submission target
            </h3>
            <p className="text-sm text-[var(--ink)]">{archiveTarget.message}</p>
            <dl>
              <Row
                label="Production Sheet/Drive IDs"
                value={
                  archiveTarget.productionConfigPresent ? "Present" : "Missing"
                }
              />
              <Row
                label="Test Sheet/Drive IDs"
                value={archiveTarget.testConfigPresent ? "Present" : "Missing"}
              />
            </dl>
          </div>

          <div className="space-y-3">
            <h3 className="font-display text-lg text-[var(--ink)]">
              Google Sheets
            </h3>
            {sheets.error ? (
              <p className="text-[var(--danger)]">
                {sheets.error.code}: {sheets.error.message}
              </p>
            ) : null}
            {sheets.ok ? (
              <dl>
                <Row label="Spreadsheet title" value={sheets.title ?? "—"} />
                <Row
                  label="Permission level"
                  value={sheets.permission?.label ?? "Unknown"}
                />
                <Row
                  label={ARTWORK_INVENTORY_TAB}
                  value={
                    sheets.artworkInventory?.exists
                      ? sheets.artworkInventorySummary?.label
                      : "Tab missing"
                  }
                />
                {sheets.artworkInventorySummary?.details.map((detail) => (
                  <p key={detail} className="text-xs text-[var(--muted)]">
                    {detail}
                  </p>
                ))}
                <Row
                  label={INVENTORY_CLAIMS_TAB}
                  value={
                    sheets.inventoryClaims?.exists
                      ? sheets.inventoryClaimsSummary?.label
                      : "Tab missing"
                  }
                />
                {sheets.inventoryClaimsSummary?.details.map((detail) => (
                  <p key={detail} className="text-xs text-[var(--muted)]">
                    {detail}
                  </p>
                ))}
              </dl>
            ) : null}
            {sheets.permission?.warning ? (
              <PermissionWarning message={sheets.permission.warning} />
            ) : null}

            {sheets.ok && (view.showHeaderTools || view.showThumbnailTool) ? (
              <div className="space-y-3 pt-2">
                {view.showHeaderTools
                  ? (
                      [
                        {
                          tab: ARTWORK_INVENTORY_TAB as SheetTabName,
                          canInit: sheets.artworkInventory?.canInitializeHeaders,
                          headers: expectedHeaders.artworkInventory,
                        },
                        {
                          tab: INVENTORY_CLAIMS_TAB as SheetTabName,
                          canInit: sheets.inventoryClaims?.canInitializeHeaders,
                          headers: expectedHeaders.inventoryClaims,
                        },
                      ] as const
                    )
                      .filter((item) => Boolean(item.canInit))
                      .map((item) => {
                        const canRun = Boolean(item.canInit) && sheetsHasEditor;
                        const disabledReason = !sheetsHasEditor
                          ? sheetsEditorBlockReason
                          : null;

                        return (
                          <div key={item.tab} className="border border-[var(--line)] p-3">
                            <p className="text-sm font-medium text-[var(--ink)]">
                              Initialize headers · {item.tab}
                            </p>
                            <p className="mt-1 text-xs text-[var(--muted)]">
                              Writes {item.headers.length} columns to row 1 only if
                              that row is blank. Will not overwrite existing headers.
                            </p>
                            {confirmHeadersTab === item.tab ? (
                              <div className="mt-3 space-y-2 bg-[var(--accent-soft)] p-3">
                                <p className="text-sm text-[var(--ink)]">
                                  Confirm writing these headers to blank row 1 on “
                                  {item.tab}”:
                                </p>
                                <ol className="max-h-40 list-decimal overflow-y-auto pl-5 text-xs text-[var(--ink-soft)]">
                                  {item.headers.map((header) => (
                                    <li key={header}>{header}</li>
                                  ))}
                                </ol>
                                <div className="flex flex-wrap gap-2 pt-1">
                                  <button
                                    type="button"
                                    disabled={pending || !canRun}
                                    onClick={() => onConfirmHeaders(item.tab)}
                                    className="border border-[var(--ink)] bg-[var(--ink)] px-3 py-2 text-xs uppercase tracking-[0.12em] text-[var(--paper)] disabled:opacity-40"
                                  >
                                    Confirm write headers
                                  </button>
                                  <button
                                    type="button"
                                    onClick={onCancelHeaders}
                                    className="px-3 py-2 text-xs uppercase tracking-[0.12em] text-[var(--muted)]"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                type="button"
                                disabled={pending || !canRun}
                                onClick={() => onPrepareHeaders(item.tab)}
                                className="mt-3 border border-[var(--line)] bg-[var(--surface-elevated)] px-3 py-2 text-xs uppercase tracking-[0.12em] text-[var(--ink)] disabled:opacity-40"
                              >
                                {canRun ? "Prepare header setup…" : "Unavailable"}
                              </button>
                            )}
                            {disabledReason ? (
                              <p className="mt-2 text-xs text-[var(--muted)]">
                                {disabledReason}
                              </p>
                            ) : null}
                          </div>
                        );
                      })
                  : null}
                {view.showThumbnailTool ? (
                  <div className="border border-[var(--line)] p-3">
                    <p className="text-sm font-medium text-[var(--ink)]">
                      Insert Thumbnail column · {ARTWORK_INVENTORY_TAB}
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      Adds a display-only Thumbnail column after Inventory ID.
                      Existing rows shift right and stay aligned. Does not generate
                      thumbnails for past artworks.
                    </p>
                    {confirmThumbnailColumn ? (
                      <div className="mt-3 space-y-2 bg-[var(--accent-soft)] p-3">
                        <p className="text-sm text-[var(--ink)]">
                          Confirm inserting the Thumbnail column. Intake will fail
                          closed until this schema matches.
                        </p>
                        <div className="flex flex-wrap gap-2 pt-1">
                          <button
                            type="button"
                            disabled={pending || !sheetsHasEditor}
                            onClick={onConfirmThumbnail}
                            className="border border-[var(--ink)] bg-[var(--ink)] px-3 py-2 text-xs uppercase tracking-[0.12em] text-[var(--paper)] disabled:opacity-40"
                          >
                            Confirm insert Thumbnail column
                          </button>
                          <button
                            type="button"
                            onClick={onCancelThumbnail}
                            className="px-3 py-2 text-xs uppercase tracking-[0.12em] text-[var(--muted)]"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={pending || !sheetsHasEditor}
                        onClick={onPrepareThumbnail}
                        className="mt-3 border border-[var(--line)] bg-[var(--surface-elevated)] px-3 py-2 text-xs uppercase tracking-[0.12em] text-[var(--ink)] disabled:opacity-40"
                      >
                        {sheetsHasEditor
                          ? "Prepare Thumbnail column…"
                          : "Unavailable"}
                      </button>
                    )}
                    {!sheetsHasEditor ? (
                      <p className="mt-2 text-xs text-[var(--muted)]">
                        {sheetsEditorBlockReason}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {drive.ok || drive.error ? (
            <div className="space-y-3">
              <h3 className="font-display text-lg text-[var(--ink)]">
                Google Drive (legacy)
              </h3>
              {drive.error ? (
                <p className="text-[var(--danger)]">
                  {drive.error.code}: {drive.error.message}
                </p>
              ) : null}
              {drive.ok && drive.folder ? (
                <dl>
                  <Row label="Configured folder name" value={drive.folder.name} />
                  <Row
                    label="Item is a folder"
                    value={drive.folder.isFolder ? "Yes" : "No"}
                  />
                  <Row
                    label="Permission level"
                    value={drive.permission?.label ?? "Unknown"}
                  />
                  <Row
                    label={`${FAILED_INTAKE_FOLDER_NAME} folder`}
                    value={drive.failedIntakePresent ? "Present" : "Missing"}
                  />
                  <Row
                    label="Immediate child folders"
                    value={
                      drive.childFolders.length > 0
                        ? drive.childFolders.map((f) => f.name).join(", ")
                        : "None listed"
                    }
                  />
                </dl>
              ) : null}
              {drive.permission?.warning ? (
                <PermissionWarning message={drive.permission.warning} />
              ) : null}
              {view.showFailedIntakeTool ? (
                <div className="border border-[var(--line)] p-3">
                  <p className="text-sm font-medium text-[var(--ink)]">
                    Create “{FAILED_INTAKE_FOLDER_NAME}”
                  </p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    Creates a child folder under the configured Drive root.
                    Idempotent if it already exists. Does not change permissions.
                  </p>
                  {confirmFailedIntake ? (
                    <div className="mt-3 space-y-2 bg-[var(--accent-soft)] p-3">
                      <p className="text-sm text-[var(--ink)]">
                        Confirm creating folder “{FAILED_INTAKE_FOLDER_NAME}” inside
                        the configured root folder
                        {drive.folder ? ` (“${drive.folder.name}”)` : ""}.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={pending || !driveHasEditor}
                          onClick={onConfirmFailedIntake}
                          className="border border-[var(--ink)] bg-[var(--ink)] px-3 py-2 text-xs uppercase tracking-[0.12em] text-[var(--paper)] disabled:opacity-40"
                        >
                          Confirm create folder
                        </button>
                        <button
                          type="button"
                          onClick={onCancelFailedIntake}
                          className="px-3 py-2 text-xs uppercase tracking-[0.12em] text-[var(--muted)]"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={pending || !driveHasEditor}
                      onClick={onPrepareFailedIntake}
                      className="mt-3 border border-[var(--line)] bg-[var(--surface-elevated)] px-3 py-2 text-xs uppercase tracking-[0.12em] text-[var(--ink)] disabled:opacity-40"
                    >
                      {driveHasEditor ? "Prepare folder setup…" : "Unavailable"}
                    </button>
                  )}
                  {!driveHasEditor ? (
                    <p className="mt-2 text-xs text-[var(--muted)]">
                      {driveEditorBlockReason}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-3">
            <h3 className="font-display text-lg text-[var(--ink)]">Dropbox</h3>
            <p className="text-sm text-[var(--ink)]">{dropbox.overall.explanation}</p>
            <dl>
              <Row label="Connected" value={dropbox.connected ? "Yes" : "No"} />
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
    </div>
  );
}
