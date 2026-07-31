import "server-only";

import {
  getGoogleEnvPresence,
  listMissingRequiredGoogleEnvKeys,
} from "@/lib/google/env";
import { GoogleIntegrationError } from "@/lib/google/errors";
import {
  ARTWORK_INVENTORY_HEADERS,
  ARTWORK_INVENTORY_TAB,
  INVENTORY_CLAIMS_HEADERS,
  INVENTORY_CLAIMS_TAB,
} from "@/lib/google/headers";
import { FAILED_INTAKE_FOLDER_NAME } from "@/lib/google/drive-query";
import {
  failedIntakeFolderExists,
  getDriveFileCapabilities,
  listImmediateChildFolders,
  verifyDriveRootFolderAccess,
} from "@/lib/google/drive";
import {
  describeHeaderStatus,
  getRequiredTabsHeaderStatus,
  verifySpreadsheetAccess,
} from "@/lib/google/sheets";
import {
  buildOverallStatus,
  formatPermissionLevel,
  isSectionComplete,
  mapCapabilitiesToPermissionLevel,
  type GooglePermissionLevel,
} from "@/lib/google/setup-logic";
import type {
  GoogleDiagnostics,
  SheetsDiagnostics,
  DriveDiagnostics,
  ResourcePermissionDiagnostics,
} from "@/lib/google/diagnostic-types";
import { getArchiveTargetDiagnostics } from "@/lib/submission/archive-target";
import {
  getStorageProviderKind,
  UnsupportedStorageProviderError,
} from "@/lib/storage/provider-kind";
import type { StorageProviderKind } from "@/lib/storage/types";

function toClientError(error: unknown): { code: string; message: string } {
  if (error instanceof GoogleIntegrationError) {
    return { code: error.code, message: error.safeMessage };
  }
  if (error instanceof Error) {
    return { code: "UNKNOWN", message: error.message };
  }
  return { code: "UNKNOWN", message: "Unexpected error." };
}

function buildSheetsPermission(
  level: GooglePermissionLevel,
): ResourcePermissionDiagnostics {
  const hasEditorAccess = level === "editor";
  return {
    level,
    label: formatPermissionLevel(level),
    hasEditorAccess,
    warning: hasEditorAccess
      ? undefined
      : "This application requires Editor access on the spreadsheet. Share the Sheet with the service-account email as Editor, then refresh.",
  };
}

function buildDrivePermission(
  level: GooglePermissionLevel,
): ResourcePermissionDiagnostics {
  const hasEditorAccess = level === "editor";
  return {
    level,
    label: formatPermissionLevel(level),
    hasEditorAccess,
    warning: hasEditorAccess
      ? undefined
      : "Uploads cannot succeed without Editor access on the Drive root folder. Share the folder with the service-account email as Editor, then refresh.",
  };
}

async function resolveSpreadsheetPermission(
  spreadsheetId: string,
): Promise<GooglePermissionLevel> {
  try {
    const capabilities = await getDriveFileCapabilities(spreadsheetId);
    return mapCapabilitiesToPermissionLevel(capabilities);
  } catch {
    // Connection already succeeded via Sheets API; treat an opaque capability
    // response as Unknown rather than failing the Sheets section.
    return "unknown";
  }
}

function resolveDiagnosticsStorageKind(): StorageProviderKind {
  try {
    return getStorageProviderKind();
  } catch (error) {
    if (error instanceof UnsupportedStorageProviderError) {
      // Fail closed for unknown providers: still require Sheets-only config
      // until the provider value is fixed.
      return "dropbox";
    }
    throw error;
  }
}

export async function runGoogleDiagnostics(): Promise<GoogleDiagnostics> {
  const storageKind = resolveDiagnosticsStorageKind();
  const requireDrive = storageKind === "drive";
  const presence = getGoogleEnvPresence();
  const missing = listMissingRequiredGoogleEnvKeys(presence, storageKind);
  const config = {
    presence,
    missing,
    ready: missing.length === 0,
    storageKind,
    driveRootRequired: requireDrive,
  };

  const sheets: SheetsDiagnostics = {
    ok: false,
    complete: false,
    spreadsheetIdPresent: presence.GOOGLE_SHEET_ID,
    permission: null,
    artworkInventory: null,
    inventoryClaims: null,
  };

  const drive: DriveDiagnostics = {
    ok: false,
    complete: false,
    permission: null,
    childFolders: [],
    failedIntakePresent: false,
    failedIntakeFolderName: FAILED_INTAKE_FOLDER_NAME,
  };

  const expectedHeaders = {
    artworkInventory: ARTWORK_INVENTORY_HEADERS,
    inventoryClaims: INVENTORY_CLAIMS_HEADERS,
  };

  const archiveTarget = getArchiveTargetDiagnostics(process.env, storageKind);

  if (!config.ready) {
    return {
      checkedAt: new Date().toISOString(),
      overall: buildOverallStatus({
        configReady: false,
        sheetsConnected: false,
        sheetsPermission: null,
        driveConnected: false,
        drivePermission: null,
        requireDrive,
      }),
      config,
      archiveTarget,
      sheets,
      drive,
      expectedHeaders,
    };
  }

  try {
    const access = await verifySpreadsheetAccess();
    const tabs = await getRequiredTabsHeaderStatus(access.spreadsheetId);
    const permissionLevel = await resolveSpreadsheetPermission(
      access.spreadsheetId,
    );
    sheets.ok = true;
    sheets.title = access.title;
    sheets.permission = buildSheetsPermission(permissionLevel);
    sheets.complete = isSectionComplete(true, permissionLevel);
    sheets.artworkInventory = tabs.artworkInventory;
    sheets.inventoryClaims = tabs.inventoryClaims;
    sheets.artworkInventorySummary = describeHeaderStatus(tabs.artworkInventory);
    sheets.inventoryClaimsSummary = describeHeaderStatus(tabs.inventoryClaims);
  } catch (error) {
    sheets.ok = false;
    sheets.complete = false;
    sheets.permission = null;
    sheets.error = toClientError(error);
  }

  // Drive root probe: required for legacy Drive storage; optional tooling when
  // Dropbox is active (only runs when GOOGLE_DRIVE_ROOT_FOLDER_ID is present).
  const driveRootPresent = presence.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (requireDrive || driveRootPresent) {
    try {
      const folder = await verifyDriveRootFolderAccess();
      const children = await listImmediateChildFolders(folder.id);
      const failedIntakePresent = await failedIntakeFolderExists(folder.id);
      const permissionLevel = mapCapabilitiesToPermissionLevel(
        folder.capabilities,
      );
      drive.ok = true;
      drive.folder = {
        id: folder.id,
        name: folder.name,
        mimeType: folder.mimeType,
        isFolder: folder.isFolder,
      };
      drive.permission = buildDrivePermission(permissionLevel);
      drive.complete = isSectionComplete(true, permissionLevel);
      drive.childFolders = children.map(({ id, name }) => ({ id, name }));
      drive.failedIntakePresent = failedIntakePresent;
    } catch (error) {
      drive.ok = false;
      drive.complete = false;
      drive.permission = null;
      drive.error = toClientError(error);
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    overall: buildOverallStatus({
      configReady: config.ready,
      sheetsConnected: sheets.ok,
      sheetsPermission: sheets.permission?.level ?? null,
      driveConnected: drive.ok,
      drivePermission: drive.permission?.level ?? null,
      requireDrive,
    }),
    config,
    archiveTarget,
    sheets,
    drive,
    expectedHeaders,
  };
}

export const DIAGNOSTIC_TAB_LABELS = {
  [ARTWORK_INVENTORY_TAB]: ARTWORK_INVENTORY_TAB,
  [INVENTORY_CLAIMS_TAB]: INVENTORY_CLAIMS_TAB,
} as const;
