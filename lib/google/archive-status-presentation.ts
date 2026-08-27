/**
 * User-facing copy for the Archive status page.
 * Translates existing Google/Dropbox diagnostics; does not change checks.
 */

import type { DropboxDiagnostics } from "@/lib/dropbox/types";
import type {
  GoogleDiagnostics,
  SheetsDiagnostics,
  TabHeaderStatus,
} from "@/lib/google/diagnostic-types";

export const ARCHIVE_STATUS_COPY = {
  pageTitle: "Archive status",
  intro:
    "Check that the artwork archive, database, and file storage are connected and working properly.",
  working: "Everything is working",
  workingExplanation:
    "The archive is connected and ready for new artwork submissions.",
  attention: "Needs attention",
  attentionExplanation:
    "One or more parts of the archive need attention before new artwork can be saved.",
  connected: "Connected",
  databaseTitle: "Artwork database",
  databaseHealthyExplanation: "Artwork details will be saved here.",
  databaseDisconnected:
    "The artwork database is not connected, so artwork details cannot be saved.",
  databasePermission:
    "This app does not have permission to update the artwork database.",
  databaseBlankHeaders:
    "The artwork database is missing its column headings, so new artwork cannot be saved yet.",
  databaseMismatch:
    "The artwork database columns do not match what this app expects.",
  databaseMissingTab:
    "The artwork database is missing a required sheet, so new artwork cannot be saved yet.",
  filesTitle: "Artwork files",
  filesProviderDropbox: "Dropbox",
  filesProviderDrive: "Google Drive",
  filesHealthyExplanation:
    "Original files, high-resolution images, web images, and thumbnails will be saved here.",
  filesDropboxDisconnected:
    "Artwork files cannot be saved until Dropbox is connected.",
  filesDropboxIncomplete:
    "Dropbox is connected, but file storage is not working properly. New artwork files cannot be saved yet.",
  filesDropboxUnconfigured:
    "Dropbox is not set up yet, so artwork files cannot be saved.",
  filesDriveDisconnected:
    "Artwork files cannot be saved until Google Drive is connected.",
  filesDriveIncomplete:
    "Google Drive is connected, but file storage is not working properly. New artwork files cannot be saved yet.",
  targetTitle: "Where new artworks are being saved",
  liveArchive: "Live archive",
  liveArchiveExplanation:
    "New artworks are being saved to the main Kim Osgood archive.",
  testArchive: "Test archive",
  testArchiveExplanation:
    "New artworks are being saved to the test archive, not the live Kim Osgood archive.",
  targetNeedsAttention:
    "The archive is not sure where to save new artworks. New submissions cannot be saved until this is fixed.",
  refresh: "Refresh status",
  technicalDetails: "Technical details",
} as const;

export type StatusSectionView = {
  ok: boolean;
  label: string;
  explanation: string;
  detail?: string;
};

export type ArchiveStatusViewModel = {
  overall: StatusSectionView;
  database: StatusSectionView;
  files: StatusSectionView;
  target: StatusSectionView;
  showHeaderTools: boolean;
  showThumbnailTool: boolean;
  showFailedIntakeTool: boolean;
};

function tabHeadersMatch(tab: TabHeaderStatus | null): boolean {
  return Boolean(tab?.exists && tab.comparison.kind === "match");
}

export function sheetsHeadersHealthy(sheets: SheetsDiagnostics): boolean {
  return (
    tabHeadersMatch(sheets.artworkInventory) &&
    tabHeadersMatch(sheets.inventoryClaims)
  );
}

function databaseSection(sheets: SheetsDiagnostics): StatusSectionView {
  if (!sheets.ok || !sheets.complete) {
    const permissionBlocked =
      sheets.ok && sheets.permission && !sheets.permission.hasEditorAccess;
    return {
      ok: false,
      label: ARCHIVE_STATUS_COPY.attention,
      explanation: permissionBlocked
        ? ARCHIVE_STATUS_COPY.databasePermission
        : ARCHIVE_STATUS_COPY.databaseDisconnected,
      detail: sheets.title,
    };
  }

  if (!sheetsHeadersHealthy(sheets)) {
    const inventory = sheets.artworkInventory;
    const claims = sheets.inventoryClaims;
    const kinds = [inventory?.comparison.kind, claims?.comparison.kind];
    let explanation: string = ARCHIVE_STATUS_COPY.databaseMismatch;
    if (kinds.includes("missing_tab") || inventory?.exists === false || claims?.exists === false) {
      explanation = ARCHIVE_STATUS_COPY.databaseMissingTab;
    } else if (kinds.includes("blank")) {
      explanation = ARCHIVE_STATUS_COPY.databaseBlankHeaders;
    }
    return {
      ok: false,
      label: ARCHIVE_STATUS_COPY.attention,
      explanation,
      detail: sheets.title,
    };
  }

  return {
    ok: true,
    label: ARCHIVE_STATUS_COPY.connected,
    explanation: ARCHIVE_STATUS_COPY.databaseHealthyExplanation,
    detail: sheets.title,
  };
}

function filesSection(
  google: GoogleDiagnostics,
  dropbox: DropboxDiagnostics,
): StatusSectionView {
  if (google.config.storageKind === "drive") {
    if (google.drive.complete) {
      return {
        ok: true,
        label: ARCHIVE_STATUS_COPY.connected,
        explanation: ARCHIVE_STATUS_COPY.filesHealthyExplanation,
        detail: ARCHIVE_STATUS_COPY.filesProviderDrive,
      };
    }
    return {
      ok: false,
      label: ARCHIVE_STATUS_COPY.attention,
      explanation: google.drive.ok
        ? ARCHIVE_STATUS_COPY.filesDriveIncomplete
        : ARCHIVE_STATUS_COPY.filesDriveDisconnected,
      detail: ARCHIVE_STATUS_COPY.filesProviderDrive,
    };
  }

  if (dropbox.overall.ready) {
    return {
      ok: true,
      label: ARCHIVE_STATUS_COPY.connected,
      explanation: ARCHIVE_STATUS_COPY.filesHealthyExplanation,
      detail: ARCHIVE_STATUS_COPY.filesProviderDropbox,
    };
  }

  let explanation: string = ARCHIVE_STATUS_COPY.filesDropboxDisconnected;
  if (!dropbox.env.ready) {
    explanation = ARCHIVE_STATUS_COPY.filesDropboxUnconfigured;
  } else if (dropbox.connected) {
    explanation = ARCHIVE_STATUS_COPY.filesDropboxIncomplete;
  }

  return {
    ok: false,
    label: ARCHIVE_STATUS_COPY.attention,
    explanation,
    detail: ARCHIVE_STATUS_COPY.filesProviderDropbox,
  };
}

function targetSection(
  archiveTarget: GoogleDiagnostics["archiveTarget"],
): StatusSectionView {
  if (archiveTarget.target === "invalid" || !archiveTarget.ready) {
    return {
      ok: false,
      label: ARCHIVE_STATUS_COPY.attention,
      explanation: ARCHIVE_STATUS_COPY.targetNeedsAttention,
    };
  }

  if (archiveTarget.target === "test") {
    return {
      ok: true,
      label: ARCHIVE_STATUS_COPY.testArchive,
      explanation: ARCHIVE_STATUS_COPY.testArchiveExplanation,
    };
  }

  return {
    ok: true,
    label: ARCHIVE_STATUS_COPY.liveArchive,
    explanation: ARCHIVE_STATUS_COPY.liveArchiveExplanation,
  };
}

export function buildArchiveStatusView(
  google: GoogleDiagnostics,
  dropbox: DropboxDiagnostics,
): ArchiveStatusViewModel {
  const database = databaseSection(google.sheets);
  const files = filesSection(google, dropbox);
  const target = targetSection(google.archiveTarget);
  const overallOk = database.ok && files.ok && target.ok;

  const issues = [database, files, target]
    .filter((section) => !section.ok)
    .map((section) => section.explanation);

  return {
    overall: {
      ok: overallOk,
      label: overallOk
        ? ARCHIVE_STATUS_COPY.working
        : ARCHIVE_STATUS_COPY.attention,
      explanation: overallOk
        ? ARCHIVE_STATUS_COPY.workingExplanation
        : issues.length === 1
          ? issues[0]!
          : ARCHIVE_STATUS_COPY.attentionExplanation,
    },
    database,
    files,
    target,
    showHeaderTools: Boolean(
      google.sheets.artworkInventory?.canInitializeHeaders ||
        google.sheets.inventoryClaims?.canInitializeHeaders,
    ),
    showThumbnailTool: Boolean(
      google.sheets.artworkInventory?.canInsertThumbnailColumn,
    ),
    showFailedIntakeTool: Boolean(
      google.drive.ok && !google.drive.failedIntakePresent,
    ),
  };
}
