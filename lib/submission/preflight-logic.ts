/**
 * Submission preflight orchestration (no `server-only` — unit-testable).
 */

import { GoogleIntegrationError } from "@/lib/google/errors";
import {
  ARTWORK_INVENTORY_HEADERS,
  ARTWORK_INVENTORY_TAB,
  INVENTORY_CLAIMS_HEADERS,
  INVENTORY_CLAIMS_TAB,
} from "@/lib/google/headers";
import type {
  SheetTabName,
  TabHeaderStatus,
} from "@/lib/google/diagnostic-types";
import { mapCapabilitiesToPermissionLevel } from "@/lib/google/setup-logic";
import type { ArchiveResources } from "@/lib/submission/archive-target";
import { resolvePreflightConfig } from "@/lib/submission/preflight-config";
import type {
  StorageProvider,
  StorageProviderKind,
} from "@/lib/storage/types";

type DriveFileCapabilities = {
  canEdit: boolean | null;
  canAddChildren: boolean | null;
};

function tabExists(sheetTitles: string[], tab: string): boolean {
  return sheetTitles.includes(tab);
}

export type PreflightSuccess = {
  ok: true;
  archive: ArchiveResources;
  sheetTitle: string;
  storageRootName: string;
  storage: StorageProvider;
  archiveRootUrl: string | null;
};

export type PreflightFailure = {
  ok: false;
  message: string;
};

export type SpreadsheetAccess = {
  title: string;
  spreadsheetId: string;
  sheetTitles: string[];
};

export type PreflightDeps = {
  envSource?: NodeJS.ProcessEnv;
  createStorage: (
    archive: ArchiveResources,
    kind: StorageProviderKind,
  ) => StorageProvider;
  verifySpreadsheetAccess: (spreadsheetId: string) => Promise<SpreadsheetAccess>;
  getTabHeaderStatus: (
    tab: SheetTabName,
    expectedHeaders: readonly string[],
    spreadsheetId: string,
  ) => Promise<TabHeaderStatus>;
  getDriveFileCapabilities: (fileId: string) => Promise<DriveFileCapabilities>;
};

/**
 * Global preflight before any inventory claims or storage writes.
 * Fail closed: create nothing / claim nothing on failure.
 *
 * Dropbox: Sheets + claims + Dropbox verifyReady (no Drive root checks).
 * Drive: Sheets + claims + Drive root folder / permission checks via verifyReady.
 */
export async function runSubmissionPreflightWithDeps(
  deps: PreflightDeps,
): Promise<PreflightSuccess | PreflightFailure> {
  const envSource = deps.envSource ?? process.env;
  const config = resolvePreflightConfig(envSource);
  if (!config.ok) {
    return { ok: false, message: config.message };
  }

  const { archive, storageKind } = config;

  try {
    const sheet = await deps.verifySpreadsheetAccess(archive.sheetId);
    if (!tabExists(sheet.sheetTitles, ARTWORK_INVENTORY_TAB)) {
      return {
        ok: false,
        message: `Required sheet tab “${ARTWORK_INVENTORY_TAB}” is missing.`,
      };
    }
    if (!tabExists(sheet.sheetTitles, INVENTORY_CLAIMS_TAB)) {
      return {
        ok: false,
        message: `Required sheet tab “${INVENTORY_CLAIMS_TAB}” is missing.`,
      };
    }

    const [inventoryHeaders, claimsHeaders] = await Promise.all([
      deps.getTabHeaderStatus(
        ARTWORK_INVENTORY_TAB,
        ARTWORK_INVENTORY_HEADERS,
        archive.sheetId,
      ),
      deps.getTabHeaderStatus(
        INVENTORY_CLAIMS_TAB,
        INVENTORY_CLAIMS_HEADERS,
        archive.sheetId,
      ),
    ]);

    if (inventoryHeaders.comparison.kind !== "match") {
      return {
        ok: false,
        message: `“${ARTWORK_INVENTORY_TAB}” header row does not match the expected schema.`,
      };
    }
    if (claimsHeaders.comparison.kind !== "match") {
      return {
        ok: false,
        message: `“${INVENTORY_CLAIMS_TAB}” header row does not match the expected schema.`,
      };
    }

    const sheetCaps = await deps.getDriveFileCapabilities(archive.sheetId);
    const sheetLevel = mapCapabilitiesToPermissionLevel(sheetCaps);
    if (sheetLevel !== "editor") {
      return {
        ok: false,
        message:
          "Service account needs Editor access on the configured spreadsheet before submission.",
      };
    }

    const storage = deps.createStorage(archive, storageKind);
    const storageReady = await storage.verifyReady();
    if (!storageReady.ok) {
      return { ok: false, message: storageReady.message };
    }

    return {
      ok: true,
      archive,
      sheetTitle: sheet.title,
      storageRootName: storageReady.rootName,
      storage,
      archiveRootUrl: storageReady.archiveRootUrl ?? storage.getArchiveRootUrl(),
    };
  } catch (error) {
    if (error instanceof GoogleIntegrationError) {
      return { ok: false, message: error.safeMessage };
    }
    return {
      ok: false,
      message: "Archive preflight failed. Check setup diagnostics.",
    };
  }
}
