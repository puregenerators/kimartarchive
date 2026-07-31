import type { DropboxDiagnosticStep } from "@/lib/dropbox/types";

export function buildArchiveOverallStatus(input: {
  googleSheetsReady: boolean;
  dropboxReady: boolean;
}): {
  ready: boolean;
  label: "Ready" | "Incomplete";
  explanation: string;
  googleSheets: "Connected" | "Not connected";
  dropbox: "Connected" | "Not connected";
  archiveFolderReady: boolean;
} {
  const googleSheets = input.googleSheetsReady
    ? "Connected"
    : "Not connected";
  const dropbox = input.dropboxReady ? "Connected" : "Not connected";
  const ready = input.googleSheetsReady && input.dropboxReady;

  return {
    ready,
    label: ready ? "Ready" : "Incomplete",
    explanation: ready
      ? "Google Sheets and Dropbox are both ready for this archive."
      : [
          !input.googleSheetsReady ? "Google Sheets is not ready" : null,
          !input.dropboxReady ? "Dropbox is not ready" : null,
        ]
          .filter(Boolean)
          .join(". ") + ".",
    googleSheets,
    dropbox,
    archiveFolderReady: input.dropboxReady,
  };
}

export function summarizeDiagnosticSteps(steps: DropboxDiagnosticStep[]): {
  passed: number;
  failed: number;
  allPassed: boolean;
} {
  const passed = steps.filter((s) => s.ok).length;
  const failed = steps.length - passed;
  return {
    passed,
    failed,
    allPassed: steps.length > 0 && failed === 0,
  };
}

export function connectionStatusFromFlags(input: {
  hasRefreshToken: boolean;
  envReady: boolean;
}): "connected" | "not_connected" | "misconfigured" {
  if (!input.envReady) return "misconfigured";
  if (!input.hasRefreshToken) return "not_connected";
  return "connected";
}
