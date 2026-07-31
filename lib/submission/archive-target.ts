/**
 * Archive target resolution (test vs production).
 *
 * Sheet IDs are always required for the active target.
 * Drive root folder IDs are required only when ARTWORK_STORAGE_PROVIDER=drive.
 * Test mode never silently falls back to production IDs.
 */

import type { StorageProviderKind } from "@/lib/storage/types";
import {
  getStorageProviderKind,
  UnsupportedStorageProviderError,
} from "@/lib/storage/provider-kind";

export type ArchiveTarget = "test" | "production";

export type ArchiveResources = {
  target: ArchiveTarget;
  sheetId: string;
  /**
   * Legacy Drive archive root. Set when storage kind is `drive`;
   * null when Dropbox is the file backend.
   */
  driveRootFolderId: string | null;
};

export type ArchiveTargetError = {
  code: "MISSING_TARGET_CONFIG" | "INVALID_TARGET";
  message: string;
};

const ALLOWED_TARGETS = new Set(["test", "production"]);

export function readArchiveTarget(
  source: NodeJS.ProcessEnv = process.env,
): ArchiveTarget {
  const raw = (source.ARTWORK_SUBMISSION_TARGET ?? "production")
    .trim()
    .toLowerCase();
  if (raw === "test" || raw === "production") return raw;
  return "production";
}

function requiresDriveRoot(storageKind: StorageProviderKind): boolean {
  return storageKind === "drive";
}

/**
 * Resolve sheet (+ optional Drive root) for the active archive target.
 * Never falls back from test → production.
 */
export function resolveArchiveResources(
  source: NodeJS.ProcessEnv = process.env,
  storageKind: StorageProviderKind = getStorageProviderKind(source),
): ArchiveResources | ArchiveTargetError {
  const raw = (source.ARTWORK_SUBMISSION_TARGET ?? "production")
    .trim()
    .toLowerCase();

  if (raw && !ALLOWED_TARGETS.has(raw)) {
    return {
      code: "INVALID_TARGET",
      message: `ARTWORK_SUBMISSION_TARGET must be "test" or "production" (got "${raw}").`,
    };
  }

  const target: ArchiveTarget = raw === "test" ? "test" : "production";
  const needDrive = requiresDriveRoot(storageKind);

  if (target === "test") {
    const sheetId = source.GOOGLE_TEST_SHEET_ID?.trim() ?? "";
    const driveRootFolderId =
      source.GOOGLE_TEST_DRIVE_ROOT_FOLDER_ID?.trim() ?? "";

    if (!sheetId) {
      return {
        code: "MISSING_TARGET_CONFIG",
        message:
          "ARTWORK_SUBMISSION_TARGET=test requires GOOGLE_TEST_SHEET_ID. Refusing to fall back to production.",
      };
    }

    if (needDrive && !driveRootFolderId) {
      return {
        code: "MISSING_TARGET_CONFIG",
        message:
          "ARTWORK_SUBMISSION_TARGET=test with ARTWORK_STORAGE_PROVIDER=drive requires GOOGLE_TEST_DRIVE_ROOT_FOLDER_ID. Refusing to fall back to production.",
      };
    }

    return {
      target,
      sheetId,
      driveRootFolderId: needDrive ? driveRootFolderId : null,
    };
  }

  const sheetId = source.GOOGLE_SHEET_ID?.trim() ?? "";
  const driveRootFolderId = source.GOOGLE_DRIVE_ROOT_FOLDER_ID?.trim() ?? "";

  if (!sheetId) {
    return {
      code: "MISSING_TARGET_CONFIG",
      message: "Production archive requires GOOGLE_SHEET_ID.",
    };
  }

  if (needDrive && !driveRootFolderId) {
    return {
      code: "MISSING_TARGET_CONFIG",
      message:
        "Production archive with ARTWORK_STORAGE_PROVIDER=drive requires GOOGLE_DRIVE_ROOT_FOLDER_ID.",
    };
  }

  return {
    target,
    sheetId,
    driveRootFolderId: needDrive ? driveRootFolderId : null,
  };
}

function sheetAndDrivePresent(
  sheetId: string | undefined,
  driveId: string | undefined,
  needDrive: boolean,
): boolean {
  if (!sheetId?.trim()) return false;
  if (needDrive && !driveId?.trim()) return false;
  return true;
}

/** Presence-only view for diagnostics (never expose IDs). */
export function getArchiveTargetDiagnostics(
  source: NodeJS.ProcessEnv = process.env,
  storageKind?: StorageProviderKind,
): {
  target: ArchiveTarget | "invalid";
  testConfigPresent: boolean;
  productionConfigPresent: boolean;
  ready: boolean;
  message: string;
} {
  let kind = storageKind;
  if (kind == null) {
    try {
      kind = getStorageProviderKind(source);
    } catch (error) {
      if (error instanceof UnsupportedStorageProviderError) {
        kind = "dropbox";
      } else {
        throw error;
      }
    }
  }
  const needDrive = requiresDriveRoot(kind);
  const raw = (source.ARTWORK_SUBMISSION_TARGET ?? "production")
    .trim()
    .toLowerCase();

  if (raw && !ALLOWED_TARGETS.has(raw)) {
    return {
      target: "invalid",
      testConfigPresent: sheetAndDrivePresent(
        source.GOOGLE_TEST_SHEET_ID,
        source.GOOGLE_TEST_DRIVE_ROOT_FOLDER_ID,
        needDrive,
      ),
      productionConfigPresent: sheetAndDrivePresent(
        source.GOOGLE_SHEET_ID,
        source.GOOGLE_DRIVE_ROOT_FOLDER_ID,
        needDrive,
      ),
      ready: false,
      message: `Invalid ARTWORK_SUBMISSION_TARGET "${raw}". Use "test" or "production".`,
    };
  }

  const target: ArchiveTarget = raw === "test" ? "test" : "production";
  const testConfigPresent = sheetAndDrivePresent(
    source.GOOGLE_TEST_SHEET_ID,
    source.GOOGLE_TEST_DRIVE_ROOT_FOLDER_ID,
    needDrive,
  );
  const productionConfigPresent = sheetAndDrivePresent(
    source.GOOGLE_SHEET_ID,
    source.GOOGLE_DRIVE_ROOT_FOLDER_ID,
    needDrive,
  );

  if (target === "test") {
    const missingHint = needDrive
      ? "GOOGLE_TEST_SHEET_ID / GOOGLE_TEST_DRIVE_ROOT_FOLDER_ID are missing."
      : "GOOGLE_TEST_SHEET_ID is missing.";
    return {
      target,
      testConfigPresent,
      productionConfigPresent,
      ready: testConfigPresent,
      message: testConfigPresent
        ? "Submitting to the TEST archive."
        : `TEST target selected but ${missingHint}`,
    };
  }

  const missingHint = needDrive
    ? "Production Sheet/Drive IDs are missing."
    : "Production Sheet ID is missing.";

  return {
    target,
    testConfigPresent,
    productionConfigPresent,
    ready: productionConfigPresent,
    message: productionConfigPresent
      ? "Submitting to the production archive."
      : missingHint,
  };
}
