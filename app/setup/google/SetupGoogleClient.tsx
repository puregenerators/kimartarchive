"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import {
  createFailedIntakeFolderAction,
  initializeSheetHeadersAction,
  type SetupActionResult,
} from "@/app/setup/google/actions";
import type { GoogleDiagnostics } from "@/lib/google/diagnostic-types";
import type { SheetTabName } from "@/lib/google/diagnostic-types";
import {
  ARTWORK_INVENTORY_TAB,
  INVENTORY_CLAIMS_TAB,
} from "@/lib/google/headers";
import { FAILED_INTAKE_FOLDER_NAME } from "@/lib/google/drive-query";

type SetupGoogleClientProps = {
  initialDiagnostics: GoogleDiagnostics;
};

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={[
        "inline-flex items-center px-2 py-0.5 text-[11px] uppercase tracking-[0.12em]",
        ok
          ? "bg-[var(--accent-soft)] text-[var(--accent)]"
          : "bg-[var(--danger-soft)] text-[var(--danger)]",
      ].join(" ")}
    >
      {label}
    </span>
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

export function SetupGoogleClient({ initialDiagnostics }: SetupGoogleClientProps) {
  const router = useRouter();
  const diagnostics = initialDiagnostics;
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<SetupActionResult | null>(null);
  const [confirmHeadersTab, setConfirmHeadersTab] = useState<SheetTabName | null>(
    null,
  );
  const [confirmFailedIntake, setConfirmFailedIntake] = useState(false);

  function refresh() {
    startTransition(() => {
      router.refresh();
      setMessage(null);
    });
  }

  function runInitialize(tab: SheetTabName) {
    startTransition(async () => {
      const result = await initializeSheetHeadersAction(
        tab,
        `INIT_HEADERS:${tab}`,
      );
      setMessage(result);
      setConfirmHeadersTab(null);
      router.refresh();
    });
  }

  function runCreateFailedIntake() {
    startTransition(async () => {
      const result = await createFailedIntakeFolderAction(
        `CREATE_FOLDER:${FAILED_INTAKE_FOLDER_NAME}`,
      );
      setMessage(result);
      setConfirmFailedIntake(false);
      router.refresh();
    });
  }

  const { overall, config, sheets, drive, expectedHeaders, archiveTarget } =
    diagnostics;
  const sheetsHasEditor = sheets.permission?.hasEditorAccess === true;
  const driveHasEditor = drive.permission?.hasEditorAccess === true;
  const sheetsEditorBlockReason =
    "Disabled: Google Sheets must grant Editor access to the service account.";
  const driveEditorBlockReason =
    "Disabled: Google Drive must grant Editor access to the service account.";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-[var(--muted)]">
          Checked at {new Date(diagnostics.checkedAt).toLocaleString()}
        </p>
        <button
          type="button"
          onClick={refresh}
          disabled={pending}
          className="border border-[var(--line)] bg-[var(--surface-elevated)] px-4 py-2 text-xs uppercase tracking-[0.12em] text-[var(--ink)] disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

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

      <Card title="Overall Status">
        <StatusPill ok={overall.ready} label={overall.label} />
        <p className="text-sm text-[var(--ink)]">{overall.explanation}</p>
      </Card>

      <Card title="Archive submission target">
        <StatusPill
          ok={archiveTarget.ready && archiveTarget.target !== "invalid"}
          label={
            archiveTarget.target === "test"
              ? "TEST"
              : archiveTarget.target === "production"
                ? "Production"
                : "Invalid"
          }
        />
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
        <p className="text-sm text-[var(--muted)]">
          IDs are never shown here. Set{" "}
          <code className="text-[var(--ink)]">ARTWORK_SUBMISSION_TARGET</code>{" "}
          to <code className="text-[var(--ink)]">test</code> or{" "}
          <code className="text-[var(--ink)]">production</code>. Test mode never
          falls back to production resources.
        </p>
      </Card>

      <Card title="Google configuration">
        <StatusPill
          ok={config.ready}
          label={config.ready ? "Ready" : "Incomplete"}
        />
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
              key === "GOOGLE_DRIVE_ROOT_FOLDER_ID" && !config.driveRootRequired;
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
      </Card>

      <Card title="Google Sheets">
        <StatusPill
          ok={sheets.complete}
          label={
            sheets.complete
              ? "Ready"
              : sheets.ok
                ? "Incomplete"
                : "Not connected"
          }
        />
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

        {sheets.ok ? (
          <div className="space-y-3 pt-2">
            {(
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
            ).map((item) => {
              const canRun = Boolean(item.canInit) && sheetsHasEditor;
              const disabledReason = !sheetsHasEditor
                ? sheetsEditorBlockReason
                : !item.canInit
                  ? "Unavailable until the header row is blank and the tab exists."
                  : null;

              return (
                <div key={item.tab} className="border border-[var(--line)] p-3">
                  <p className="text-sm font-medium text-[var(--ink)]">
                    Initialize headers · {item.tab}
                  </p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    Writes {item.headers.length} columns to row 1 only if that row
                    is blank. Will not overwrite existing headers.
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
                          onClick={() => runInitialize(item.tab)}
                          className="border border-[var(--ink)] bg-[var(--ink)] px-3 py-2 text-xs uppercase tracking-[0.12em] text-[var(--paper)] disabled:opacity-40"
                        >
                          Confirm write headers
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmHeadersTab(null)}
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
                      onClick={() => setConfirmHeadersTab(item.tab)}
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
            })}
          </div>
        ) : null}
      </Card>

      <Card title="Google Drive">
        <StatusPill
          ok={drive.complete}
          label={
            drive.complete
              ? "Ready"
              : drive.ok
                ? "Incomplete"
                : "Not connected"
          }
        />
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

        {drive.ok ? (
          <div className="border border-[var(--line)] p-3">
            <p className="text-sm font-medium text-[var(--ink)]">
              Create “{FAILED_INTAKE_FOLDER_NAME}”
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Creates a child folder under the configured Drive root. Idempotent
              if it already exists. Does not change permissions.
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
                    disabled={
                      pending || drive.failedIntakePresent || !driveHasEditor
                    }
                    onClick={runCreateFailedIntake}
                    className="border border-[var(--ink)] bg-[var(--ink)] px-3 py-2 text-xs uppercase tracking-[0.12em] text-[var(--paper)] disabled:opacity-40"
                  >
                    Confirm create folder
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmFailedIntake(false)}
                    className="px-3 py-2 text-xs uppercase tracking-[0.12em] text-[var(--muted)]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={
                  pending || drive.failedIntakePresent || !driveHasEditor
                }
                onClick={() => setConfirmFailedIntake(true)}
                className="mt-3 border border-[var(--line)] bg-[var(--surface-elevated)] px-3 py-2 text-xs uppercase tracking-[0.12em] text-[var(--ink)] disabled:opacity-40"
              >
                {drive.failedIntakePresent
                  ? "Already present"
                  : driveHasEditor
                    ? "Prepare folder setup…"
                    : "Unavailable"}
              </button>
            )}
            {!driveHasEditor ? (
              <p className="mt-2 text-xs text-[var(--muted)]">
                {driveEditorBlockReason}
              </p>
            ) : drive.failedIntakePresent ? (
              <p className="mt-2 text-xs text-[var(--muted)]">
                Folder already exists. No action needed.
              </p>
            ) : null}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
