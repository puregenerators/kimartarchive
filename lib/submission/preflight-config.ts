/**
 * Provider-aware env + archive resolution for submission preflight.
 * Kept free of `server-only` so unit tests can exercise it without Next.
 */

import {
  MalformedPrivateKeyError,
  MissingGoogleEnvError,
  validateGoogleDriveStorageEnv,
  validateGoogleSheetsEnv,
  type GoogleDriveStorageEnv,
  type GoogleSheetsEnv,
} from "@/lib/google/env";
import {
  resolveArchiveResources,
  type ArchiveResources,
} from "@/lib/submission/archive-target";
import {
  getStorageProviderKind,
  UnsupportedStorageProviderError,
} from "@/lib/storage/provider-kind";
import type { StorageProviderKind } from "@/lib/storage/types";

export type PreflightConfigSuccess = {
  ok: true;
  storageKind: StorageProviderKind;
  sheets: GoogleSheetsEnv;
  /** Present only when storageKind === "drive". */
  driveStorage: GoogleDriveStorageEnv | null;
  archive: ArchiveResources;
  /** True when Drive-root env validation ran (legacy Drive storage only). */
  validatedDriveStorageEnv: boolean;
};

export type PreflightConfigFailure = {
  ok: false;
  message: string;
  validatedDriveStorageEnv: boolean;
};

export type PreflightConfigResult =
  | PreflightConfigSuccess
  | PreflightConfigFailure;

/**
 * Validate Sheets credentials, resolve storage provider, optionally validate
 * Drive storage env, then resolve archive target resources.
 *
 * Dropbox (default): Sheets only — no Drive root requirement or Drive env check.
 * Drive: Sheets + GOOGLE_DRIVE_ROOT_FOLDER_ID + archive Drive IDs.
 */
export function resolvePreflightConfig(
  source: NodeJS.ProcessEnv = process.env,
): PreflightConfigResult {
  let sheets: GoogleSheetsEnv;
  try {
    sheets = validateGoogleSheetsEnv(source);
  } catch (error) {
    if (error instanceof MissingGoogleEnvError) {
      return {
        ok: false,
        message: `Missing Google environment variable(s): ${error.missing.join(", ")}`,
        validatedDriveStorageEnv: false,
      };
    }
    if (error instanceof MalformedPrivateKeyError) {
      return {
        ok: false,
        message: error.message,
        validatedDriveStorageEnv: false,
      };
    }
    return {
      ok: false,
      message: "Google credentials are not configured correctly.",
      validatedDriveStorageEnv: false,
    };
  }

  let storageKind: StorageProviderKind;
  try {
    storageKind = getStorageProviderKind(source);
  } catch (error) {
    if (error instanceof UnsupportedStorageProviderError) {
      return {
        ok: false,
        message: error.message,
        validatedDriveStorageEnv: false,
      };
    }
    throw error;
  }

  let driveStorage: GoogleDriveStorageEnv | null = null;
  let validatedDriveStorageEnv = false;

  if (storageKind === "drive") {
    validatedDriveStorageEnv = true;
    try {
      driveStorage = validateGoogleDriveStorageEnv(source);
    } catch (error) {
      if (error instanceof MissingGoogleEnvError) {
        return {
          ok: false,
          message: `Missing Google environment variable(s): ${error.missing.join(", ")}`,
          validatedDriveStorageEnv,
        };
      }
      return {
        ok: false,
        message: "Google Drive storage is not configured correctly.",
        validatedDriveStorageEnv,
      };
    }
  }

  const archive = resolveArchiveResources(source, storageKind);
  if ("code" in archive) {
    return {
      ok: false,
      message: archive.message,
      validatedDriveStorageEnv,
    };
  }

  return {
    ok: true,
    storageKind,
    sheets,
    driveStorage,
    archive,
    validatedDriveStorageEnv,
  };
}
