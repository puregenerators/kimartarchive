import type { StorageProviderKind } from "@/lib/storage/types";

/** Always required — Google Sheets metadata + service-account auth. */
export const GOOGLE_SHEETS_ENV_KEYS = [
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_PRIVATE_KEY",
  "GOOGLE_SHEET_ID",
] as const;

/** Required only when ARTWORK_STORAGE_PROVIDER=drive (legacy file storage). */
export const GOOGLE_DRIVE_STORAGE_ENV_KEYS = [
  "GOOGLE_DRIVE_ROOT_FOLDER_ID",
] as const;

/** All known Google env keys (for presence maps / diagnostics display). */
export const GOOGLE_ENV_KEYS = [
  ...GOOGLE_SHEETS_ENV_KEYS,
  ...GOOGLE_DRIVE_STORAGE_ENV_KEYS,
] as const;

export type GoogleSheetsEnvKey = (typeof GOOGLE_SHEETS_ENV_KEYS)[number];
export type GoogleDriveStorageEnvKey =
  (typeof GOOGLE_DRIVE_STORAGE_ENV_KEYS)[number];
export type GoogleEnvKey = (typeof GOOGLE_ENV_KEYS)[number];

export type GoogleSheetsEnv = {
  serviceAccountEmail: string;
  privateKey: string;
  sheetId: string;
};

export type GoogleDriveStorageEnv = {
  driveRootFolderId: string;
};

/** @deprecated Prefer GoogleSheetsEnv — Drive root is storage-provider-specific. */
export type GoogleEnv = GoogleSheetsEnv;

export type EnvPresence = Record<GoogleEnvKey, boolean>;

/**
 * Normalize a service-account private key from env storage.
 * Many hosts store the key with literal `\n` sequences instead of real newlines.
 */
export function normalizePrivateKey(raw: string): string {
  const trimmed = raw.trim();
  // Strip optional surrounding quotes from pasted values
  const unquoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1)
      : trimmed;

  return unquoted.replace(/\\n/g, "\n");
}

export function getGoogleEnvPresence(
  source: NodeJS.ProcessEnv = process.env,
): EnvPresence {
  return {
    GOOGLE_SERVICE_ACCOUNT_EMAIL: Boolean(
      source.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim(),
    ),
    GOOGLE_PRIVATE_KEY: Boolean(source.GOOGLE_PRIVATE_KEY?.trim()),
    GOOGLE_SHEET_ID: Boolean(source.GOOGLE_SHEET_ID?.trim()),
    GOOGLE_DRIVE_ROOT_FOLDER_ID: Boolean(
      source.GOOGLE_DRIVE_ROOT_FOLDER_ID?.trim(),
    ),
  };
}

export function listMissingGoogleSheetsEnvKeys(
  presence: EnvPresence = getGoogleEnvPresence(),
): GoogleSheetsEnvKey[] {
  return GOOGLE_SHEETS_ENV_KEYS.filter((key) => !presence[key]);
}

export function listMissingGoogleDriveStorageEnvKeys(
  presence: EnvPresence = getGoogleEnvPresence(),
): GoogleDriveStorageEnvKey[] {
  return GOOGLE_DRIVE_STORAGE_ENV_KEYS.filter((key) => !presence[key]);
}

/**
 * Missing keys required for the active storage provider.
 * Dropbox (default): Sheets credentials only.
 * Drive: Sheets credentials + GOOGLE_DRIVE_ROOT_FOLDER_ID.
 */
export function listMissingRequiredGoogleEnvKeys(
  presence: EnvPresence = getGoogleEnvPresence(),
  storageKind: StorageProviderKind = "dropbox",
): GoogleEnvKey[] {
  const missing: GoogleEnvKey[] = [
    ...listMissingGoogleSheetsEnvKeys(presence),
  ];
  if (storageKind === "drive") {
    missing.push(...listMissingGoogleDriveStorageEnvKeys(presence));
  }
  return missing;
}

/**
 * @deprecated Use listMissingRequiredGoogleEnvKeys with a storage kind.
 * Lists all known Google keys (including Drive root) that are absent.
 */
export function listMissingGoogleEnvKeys(
  presence: EnvPresence = getGoogleEnvPresence(),
): GoogleEnvKey[] {
  return GOOGLE_ENV_KEYS.filter((key) => !presence[key]);
}

export class MissingGoogleEnvError extends Error {
  readonly code = "MISSING_GOOGLE_ENV" as const;
  readonly missing: GoogleEnvKey[];

  constructor(missing: GoogleEnvKey[]) {
    super(
      `Missing required Google environment variable(s): ${missing.join(", ")}`,
    );
    this.name = "MissingGoogleEnvError";
    this.missing = missing;
  }
}

export class MalformedPrivateKeyError extends Error {
  readonly code = "MALFORMED_PRIVATE_KEY" as const;

  constructor(message = "GOOGLE_PRIVATE_KEY is malformed or incomplete.") {
    super(message);
    this.name = "MalformedPrivateKeyError";
  }
}

function assertPrivateKeyPem(privateKey: string): void {
  if (
    !privateKey.includes("BEGIN PRIVATE KEY") ||
    !privateKey.includes("END PRIVATE KEY")
  ) {
    throw new MalformedPrivateKeyError(
      "GOOGLE_PRIVATE_KEY must be a PEM private key (BEGIN/END PRIVATE KEY).",
    );
  }
}

/**
 * Validate Google Sheets + service-account credentials.
 * Does not require GOOGLE_DRIVE_ROOT_FOLDER_ID.
 */
export function validateGoogleSheetsEnv(
  source: NodeJS.ProcessEnv = process.env,
): GoogleSheetsEnv {
  const missing = listMissingGoogleSheetsEnvKeys(getGoogleEnvPresence(source));
  if (missing.length > 0) {
    throw new MissingGoogleEnvError(missing);
  }

  const privateKey = normalizePrivateKey(source.GOOGLE_PRIVATE_KEY!);
  assertPrivateKeyPem(privateKey);

  return {
    serviceAccountEmail: source.GOOGLE_SERVICE_ACCOUNT_EMAIL!.trim(),
    privateKey,
    sheetId: source.GOOGLE_SHEET_ID!.trim(),
  };
}

/**
 * Validate legacy Google Drive file-storage configuration.
 * Required only when ARTWORK_STORAGE_PROVIDER=drive.
 */
export function validateGoogleDriveStorageEnv(
  source: NodeJS.ProcessEnv = process.env,
): GoogleDriveStorageEnv {
  const missing = listMissingGoogleDriveStorageEnvKeys(
    getGoogleEnvPresence(source),
  );
  if (missing.length > 0) {
    throw new MissingGoogleEnvError(missing);
  }

  return {
    driveRootFolderId: source.GOOGLE_DRIVE_ROOT_FOLDER_ID!.trim(),
  };
}
