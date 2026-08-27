"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import {
  disconnectDropboxAction,
  type DropboxSetupActionResult,
} from "@/app/setup/archive/actions";
import type { DropboxDiagnostics } from "@/lib/dropbox/types";
import type { GoogleDiagnostics } from "@/lib/google/diagnostic-types";
import { LocalImageProcessingTest } from "@/app/setup/archive/LocalImageProcessingTest";

type UploadTestStepKey =
  | "folderCreated"
  | "uploadSucceeded"
  | "metadataVerified"
  | "sharedLinkCreated"
  | "downloadVerified"
  | "fileDeleted"
  | "folderDeleted";

type UploadTestUiResult = {
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

const FAILED_OPERATION_LABELS: Record<string, string> = {
  create_folder: "Folder created",
  upload: "File uploaded",
  verify_metadata: "Metadata verified",
  create_shared_link: "Shared link created",
  download: "Download verified",
  delete_file: "File deleted",
  delete_folder: "Folder deleted",
};

type ArchiveSetupClientProps = {
  google: GoogleDiagnostics;
  dropbox: DropboxDiagnostics;
  flash: {
    kind: "success" | "error" | null;
    message: string | null;
  };
  overall: {
    ready: boolean;
    label: "Ready" | "Incomplete";
    explanation: string;
    googleSheets: "Connected" | "Not connected";
    dropbox: "Connected" | "Not connected";
    archiveFolderReady: boolean;
  };
  localProcessingAvailable: boolean;
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

function ActionButton({
  href,
  children,
  primary,
  disabled,
  onClick,
}: {
  href?: string;
  children: ReactNode;
  primary?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const className = [
    "inline-flex px-4 py-2 text-xs uppercase tracking-[0.12em] disabled:opacity-40",
    primary
      ? "border border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]"
      : "border border-[var(--line)] bg-[var(--surface-elevated)] text-[var(--ink)]",
  ].join(" ");

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

export function ArchiveSetupClient({
  google,
  dropbox,
  flash,
  overall,
  localProcessingAvailable,
}: ArchiveSetupClientProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<DropboxSetupActionResult | null>(() => {
    if (flash.kind === "success") {
      return { ok: true, message: flash.message ?? "Done." };
    }
    if (flash.kind === "error") {
      return {
        ok: false,
        code: "OAUTH",
        message: flash.message ?? "Dropbox connection failed.",
      };
    }
    return null;
  });
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [uploadTestPending, setUploadTestPending] = useState(false);
  const [uploadTestResult, setUploadTestResult] =
    useState<UploadTestUiResult | null>(null);

  const sheetsReady = google.sheets.complete;
  const dropboxConnected = dropbox.connected;
  const dropboxReady = dropbox.overall.ready;

  function refresh() {
    startTransition(() => {
      router.refresh();
      setMessage(null);
    });
  }

  function runDisconnect() {
    startTransition(async () => {
      const result = await disconnectDropboxAction();
      setMessage(result);
      setConfirmDisconnect(false);
      router.refresh();
    });
  }

  function runDiagnostics() {
    startTransition(() => {
      router.refresh();
      setMessage({
        ok: true,
        message: "Diagnostics refreshed.",
      });
    });
  }

  async function runUploadTest() {
    setUploadTestPending(true);
    setUploadTestResult(null);
    setMessage(null);
    try {
      const response = await fetch("/api/dropbox/test-upload", {
        method: "POST",
      });
      const data = (await response.json()) as {
        success?: boolean;
        message?: string;
        failedOperation?: string;
        folderCreated?: boolean;
        uploadSucceeded?: boolean;
        metadataVerified?: boolean;
        sharedLinkCreated?: boolean;
        downloadVerified?: boolean;
        fileDeleted?: boolean;
        folderDeleted?: boolean;
        error?: { message?: string };
      };

      const failedOperationLabel = data.failedOperation
        ? (FAILED_OPERATION_LABELS[data.failedOperation] ?? data.failedOperation)
        : null;

      setUploadTestResult({
        success: Boolean(data.success),
        message:
          data.message ??
          data.error?.message ??
          (data.success
            ? "Dropbox upload integration test passed."
            : "Dropbox upload test failed."),
        failedOperationLabel,
        folderCreated: Boolean(data.folderCreated),
        uploadSucceeded: Boolean(data.uploadSucceeded),
        metadataVerified: Boolean(data.metadataVerified),
        sharedLinkCreated: Boolean(data.sharedLinkCreated),
        downloadVerified: Boolean(data.downloadVerified),
        fileDeleted: Boolean(data.fileDeleted),
        folderDeleted: Boolean(data.folderDeleted),
      });
    } catch {
      setUploadTestResult({
        success: false,
        message: "Could not reach the Dropbox upload test endpoint.",
        failedOperationLabel: "Folder created",
        folderCreated: false,
        uploadSucceeded: false,
        metadataVerified: false,
        sharedLinkCreated: false,
        downloadVerified: false,
        fileDeleted: false,
        folderDeleted: false,
      });
    } finally {
      setUploadTestPending(false);
    }
  }

  return (
    <div>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-[var(--muted)]">
            Checked at {new Date(dropbox.checkedAt).toLocaleString()}
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
          <dl>
            <Row
              label="Google Sheets"
              value={
                <StatusPill
                  ok={overall.googleSheets === "Connected"}
                  label={overall.googleSheets}
                />
              }
            />
            <Row
              label="Dropbox"
              value={
                <StatusPill
                  ok={overall.dropbox === "Connected"}
                  label={overall.dropbox}
                />
              }
            />
            <Row
              label="Archive Folder Ready"
              value={
                <StatusPill
                  ok={overall.archiveFolderReady}
                  label={overall.archiveFolderReady ? "Ready" : "Not ready"}
                />
              }
            />
          </dl>
          <p className="text-xs text-[var(--muted)]">
            Status is green only when both Google Sheets and Dropbox pass.
          </p>
        </Card>

        <Card title="Google Sheets">
          <StatusPill
            ok={sheetsReady}
            label={sheetsReady ? "Connected" : "Not connected"}
          />
          {google.sheets.ok ? (
            <dl>
              <Row label="Spreadsheet title" value={google.sheets.title ?? "—"} />
              <Row
                label="Permission"
                value={google.sheets.permission?.label ?? "Unknown"}
              />
            </dl>
          ) : (
            <p className="text-[var(--danger)]">
              {google.sheets.error
                ? `${google.sheets.error.code}: ${google.sheets.error.message}`
                : "Google Sheets is not reachable."}
            </p>
          )}
          <p className="text-xs text-[var(--muted)]">
            Google Sheets stores permanent artwork metadata. File binaries will
            live in Dropbox.{" "}
            <Link
              href="/setup/google"
              className="text-[var(--accent)] underline-offset-2 hover:underline"
            >
              Open Google sheet tools
            </Link>
          </p>
        </Card>

        <Card title="Dropbox">
          <StatusPill
            ok={dropboxReady}
            label={
              dropboxReady
                ? "Ready"
                : dropboxConnected
                  ? "Incomplete"
                  : "Not connected"
            }
          />

          <dl>
            <Row
              label="Connected"
              value={dropboxConnected ? "Yes" : "No"}
            />
            <Row
              label="Account"
              value={
                dropbox.account
                  ? `${dropbox.account.displayName} · ${dropbox.account.email}`
                  : "—"
              }
            />
            {dropbox.account ? (
              <Row
                label="Dropbox account ID"
                value={dropbox.account.accountId}
              />
            ) : null}
            <Row
              label="Archive folder"
              value={dropbox.archiveFolder.displayPath}
            />
            <Row
              label="Permission test"
              value={
                dropbox.archiveFolder.accessible
                  ? "App Folder writable"
                  : dropboxConnected
                    ? "Failed — run diagnostics"
                    : "Not run"
              }
            />
          </dl>

          {!dropbox.env.ready ? (
            <p className="text-sm text-[var(--danger)]">
              Missing env: {dropbox.env.missing.join(", ")}. See
              docs/DROPBOX_SETUP.md.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2 pt-2">
            {!dropboxConnected ? (
              <ActionButton
                href="/api/auth/dropbox/connect"
                primary
                disabled={!dropbox.env.ready || pending}
              >
                Connect Dropbox
              </ActionButton>
            ) : (
              <>
                <ActionButton
                  href="/api/auth/dropbox/connect"
                  disabled={!dropbox.env.ready || pending}
                >
                  Reconnect
                </ActionButton>
                <ActionButton
                  disabled={pending}
                  onClick={() => setConfirmDisconnect(true)}
                >
                  Disconnect
                </ActionButton>
              </>
            )}
            <ActionButton disabled={pending} onClick={runDiagnostics}>
              Run Diagnostics
            </ActionButton>
            <ActionButton
              disabled={!dropboxConnected || pending || uploadTestPending}
              onClick={runUploadTest}
            >
              {uploadTestPending
                ? "Running Upload Test…"
                : "Run Dropbox Upload Test"}
            </ActionButton>
          </div>

          {uploadTestResult ? (
            <div
              className={[
                "mt-3 space-y-2 border px-3 py-3",
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
                  ] as const satisfies ReadonlyArray<readonly [UploadTestStepKey, string]>
                ).map(([key, label]) => {
                  const ok = uploadTestResult[key];
                  const failedHere =
                    !uploadTestResult.success &&
                    uploadTestResult.failedOperationLabel === label;
                  return (
                    <li key={key} className="flex items-center gap-2">
                      <span aria-hidden="true">{ok ? "✓" : failedHere ? "✗" : "·"}</span>
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
              {!uploadTestResult.success ? (
                <p className="text-xs text-[var(--danger)]">
                  Failed operation: {uploadTestResult.failedOperationLabel}
                </p>
              ) : null}
            </div>
          ) : null}

          {confirmDisconnect ? (
            <div className="space-y-2 bg-[var(--danger-soft)] p-3">
              <p className="text-sm text-[var(--danger)]">
                Remove the local Dropbox refresh token? You will need to Connect
                again before uploads can use Dropbox.
              </p>
              <div className="flex flex-wrap gap-2">
                <ActionButton primary disabled={pending} onClick={runDisconnect}>
                  Confirm disconnect
                </ActionButton>
                <ActionButton onClick={() => setConfirmDisconnect(false)}>
                  Cancel
                </ActionButton>
              </div>
            </div>
          ) : null}

          {!dropboxConnected && dropbox.env.ready ? (
            <p className="rounded border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-3 text-sm text-[var(--ink)]">
              Dropbox is not connected. Authorize once with{" "}
              <strong className="font-medium">Connect Dropbox</strong> — the app
              stores a refresh token locally and reconnects automatically.
            </p>
          ) : null}
        </Card>

        <Card title="Diagnostics">
          <StatusPill
            ok={dropbox.overall.ready}
            label={dropbox.overall.label}
          />
          <p className="text-sm text-[var(--ink)]">{dropbox.overall.explanation}</p>
          <ul className="space-y-2">
            {dropbox.steps.map((s) => (
              <li
                key={s.id}
                className="flex flex-col gap-1 border-b border-[var(--line)] py-2 sm:flex-row sm:items-start sm:justify-between"
              >
                <div>
                  <p className="text-sm text-[var(--ink)]">{s.label}</p>
                  <p className="text-xs text-[var(--muted)]">{s.message}</p>
                </div>
                <StatusPill ok={s.ok} label={s.ok ? "Pass" : "Fail"} />
              </li>
            ))}
          </ul>
          <p className="text-xs text-[var(--muted)]">
            Probes use a temporary{" "}
            <code className="text-[var(--ink)]">.kimartarchive-diagnostics</code>{" "}
            folder inside the App Folder. Artwork paths are not modified.
          </p>
        </Card>
      </div>

      <div className="mt-6">
        <LocalImageProcessingTest available={localProcessingAvailable} />
      </div>

      {overall.ready ? (
        <div className="mt-8 sm:mt-10">
          <Link
            href="/new-artwork"
            className="inline-flex border border-[var(--ink)] bg-[var(--ink)] px-6 py-3 text-sm uppercase tracking-[0.14em] text-[var(--paper)] transition hover:bg-[var(--ink-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            Continue to Artwork Intake →
          </Link>
        </div>
      ) : null}
    </div>
  );
}
