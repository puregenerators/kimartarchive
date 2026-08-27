/**
 * User-facing copy for the Archive setup page.
 * Translates existing Google/Dropbox diagnostics; does not change checks.
 */

import {
  ARCHIVE_STATUS_COPY,
  buildArchiveStatusView,
  type StatusSectionView,
} from "@/lib/google/archive-status-presentation";
import type { GoogleDiagnostics } from "@/lib/google/diagnostic-types";
import {
  DROPBOX_ARCHIVE_ROOT_WEB_URL,
  type DropboxDiagnosticStepId,
  type DropboxDiagnostics,
} from "@/lib/dropbox/types";

export const ARCHIVE_SETUP_COPY = {
  pageTitle: "Archive setup",
  intro:
    "Check that the artwork database and file storage are connected and ready for new artwork submissions.",
  statusTitle: "Archive status",
  working: "Everything is working",
  workingExplanation:
    "The artwork database and Dropbox are connected and ready for new artwork submissions.",
  attention: "Needs attention",
  connected: "Connected",
  refresh: "Refresh status",
  settingsTitle: "Settings & connections",
  archiveSettingsTitle: "Archive settings",
  archiveSettingsDescription:
    "Manage Dropbox folders, file storage, and archive configuration.",
  archiveSettingsCta: "View settings →",
  databaseSettingsTitle: "Artwork database",
  databaseSettingsDescription:
    "Check the Google Sheet used to store artwork information.",
  databaseSettingsCta: "View database settings →",
  databaseTitle: "Artwork database",
  databaseHealthyExplanation: "Artwork information will be saved here.",
  filesTitle: "Artwork files",
  filesProviderDropbox: "Dropbox",
  filesHealthyExplanation:
    "Original files, high-resolution images, web images, and thumbnails will be stored here.",
  folderDisplayName: "Kim Osgood Archive",
  connectionCheckTitle: "Connection check",
  connectionPassed: "Everything passed",
  connectionPassedExplanation:
    "Dropbox and the artwork database are responding normally.",
  dropboxAttention: "Dropbox needs attention",
  databaseAttention: "The artwork database needs attention",
  connectDropbox: "Connect Dropbox",
  reconnect: "Reconnect",
  disconnect: "Disconnect",
  continue: "Continue to artwork intake →",
  technicalDetails: "Technical details",
} as const;

export const ARCHIVE_SETUP_DESTINATIONS = {
  archiveSettings: DROPBOX_ARCHIVE_ROOT_WEB_URL,
  databaseSettings: "/setup/google",
  intake: "/new-artwork",
  dropboxConnect: "/api/auth/dropbox/connect",
} as const;

const DROPBOX_STEP_FAILURES: Record<
  DropboxDiagnosticStepId,
  { label: string; explanation: string }
> = {
  refresh_token_exists: {
    label: ARCHIVE_SETUP_COPY.dropboxAttention,
    explanation:
      "Dropbox is not connected, so artwork files cannot be saved yet. Connect Dropbox and try again.",
  },
  access_token_refresh: {
    label: ARCHIVE_SETUP_COPY.dropboxAttention,
    explanation:
      "The archive could not refresh the Dropbox connection. Reconnect Dropbox and try again.",
  },
  account_lookup: {
    label: ARCHIVE_SETUP_COPY.dropboxAttention,
    explanation:
      "The archive could not reach the Dropbox account. Reconnect Dropbox and try again.",
  },
  archive_folder_exists: {
    label: ARCHIVE_SETUP_COPY.dropboxAttention,
    explanation:
      "The archive could not open the Dropbox folder. Reconnect Dropbox and try again.",
  },
  create_folder: {
    label: ARCHIVE_SETUP_COPY.dropboxAttention,
    explanation:
      "The archive could not create a test folder in Dropbox. Reconnect Dropbox and try again.",
  },
  upload_temp_file: {
    label: ARCHIVE_SETUP_COPY.dropboxAttention,
    explanation:
      "The archive could not create a test file in Dropbox. Reconnect Dropbox and try again.",
  },
  delete_temp_file: {
    label: ARCHIVE_SETUP_COPY.dropboxAttention,
    explanation:
      "The archive could not clean up a test file in Dropbox. Reconnect Dropbox and try again.",
  },
};

export type ArchiveSetupViewModel = {
  overall: StatusSectionView;
  database: StatusSectionView;
  files: StatusSectionView & { savingTo?: string };
  connectionCheck: StatusSectionView;
  readyForIntake: boolean;
  dropboxConnected: boolean;
  dropboxEnvReady: boolean;
};

function connectionCheck(
  google: GoogleDiagnostics,
  dropbox: DropboxDiagnostics,
  database: StatusSectionView,
): StatusSectionView {
  const sheetsReachable = google.sheets.ok;
  const dropboxPassed = dropbox.overall.ready;

  if (dropboxPassed && sheetsReachable) {
    return {
      ok: true,
      label: ARCHIVE_SETUP_COPY.connectionPassed,
      explanation: ARCHIVE_SETUP_COPY.connectionPassedExplanation,
    };
  }

  const failedStep = dropbox.steps.find((step) => !step.ok);
  if (failedStep) {
    return {
      ok: false,
      ...DROPBOX_STEP_FAILURES[failedStep.id],
    };
  }

  if (!sheetsReachable) {
    return {
      ok: false,
      label: ARCHIVE_SETUP_COPY.databaseAttention,
      explanation: database.explanation,
    };
  }

  return {
    ok: false,
    label: ARCHIVE_SETUP_COPY.dropboxAttention,
    explanation: ARCHIVE_STATUS_COPY.filesDropboxIncomplete,
  };
}

export function savingToLabel(accessible: boolean): string | undefined {
  if (!accessible) return undefined;
  return `Saving to: ${ARCHIVE_SETUP_COPY.folderDisplayName}`;
}

export function buildArchiveSetupView(
  google: GoogleDiagnostics,
  dropbox: DropboxDiagnostics,
): ArchiveSetupViewModel {
  const status = buildArchiveStatusView(google, dropbox);

  const overall: StatusSectionView = {
    ok: status.overall.ok,
    label: status.overall.ok
      ? ARCHIVE_SETUP_COPY.working
      : ARCHIVE_SETUP_COPY.attention,
    explanation: status.overall.ok
      ? ARCHIVE_SETUP_COPY.workingExplanation
      : status.overall.explanation,
  };

  const database: StatusSectionView = {
    ok: status.database.ok,
    label: status.database.ok
      ? ARCHIVE_SETUP_COPY.connected
      : ARCHIVE_SETUP_COPY.attention,
    explanation: status.database.ok
      ? ARCHIVE_SETUP_COPY.databaseHealthyExplanation
      : status.database.explanation,
    detail: status.database.detail,
  };

  const files: ArchiveSetupViewModel["files"] = {
    ok: status.files.ok,
    label: status.files.ok
      ? ARCHIVE_SETUP_COPY.connected
      : ARCHIVE_SETUP_COPY.attention,
    explanation: status.files.ok
      ? ARCHIVE_SETUP_COPY.filesHealthyExplanation
      : status.files.explanation,
    detail: status.files.detail,
    savingTo: status.files.ok
      ? savingToLabel(dropbox.archiveFolder.accessible)
      : undefined,
  };

  return {
    overall,
    database,
    files,
    connectionCheck: connectionCheck(google, dropbox, database),
    readyForIntake: status.overall.ok,
    dropboxConnected: dropbox.connected,
    dropboxEnvReady: dropbox.env.ready,
  };
}
