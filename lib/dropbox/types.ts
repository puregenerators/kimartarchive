/**
 * Dropbox integration types.
 * Tokens must never be serialized to the browser or included in logs.
 */

export const DROPBOX_ENV_KEYS = [
  "DROPBOX_APP_KEY",
  "DROPBOX_APP_SECRET",
  "DROPBOX_REDIRECT_URI",
] as const;

export type DropboxEnvKey = (typeof DROPBOX_ENV_KEYS)[number];

export type DropboxEnv = {
  appKey: string;
  appSecret: string;
  redirectUri: string;
};

export type DropboxEnvPresence = Record<DropboxEnvKey, boolean>;

/** Scopes required for App Folder archive operations. */
export const DROPBOX_OAUTH_SCOPES = [
  "account_info.read",
  "files.metadata.read",
  "files.metadata.write",
  "files.content.write",
  "files.content.read",
  "sharing.write",
  "sharing.read",
] as const;

export type DropboxOAuthScope = (typeof DROPBOX_OAUTH_SCOPES)[number];

/**
 * Display path of the App Folder root for this installation.
 * App Folder apps cannot see outside this folder.
 */
export const DROPBOX_ARCHIVE_ROOT_DISPLAY = "Apps/Kim Art Archive/";

/**
 * Convenience Dropbox web UI URL for the App Folder (operator must be signed in).
 * Artwork shared links are created separately via the sharing API.
 */
export const DROPBOX_ARCHIVE_ROOT_WEB_URL =
  "https://www.dropbox.com/home/Apps/Kim%20Art%20Archive";

/** API path of the App Folder root (empty string for list_folder). */
export const DROPBOX_ARCHIVE_ROOT_API_PATH = "";

/** Failed Intake folder directly under the App Folder root (same layout as Drive). */
export const DROPBOX_FAILED_INTAKE_PATH = "/Failed Intake";

/**
 * Cross-instance inventory allocation lock (created with Dropbox mode=add).
 * Not an artwork folder. Safe to steal if stale.
 */
export const DROPBOX_ALLOCATION_LOCK_PATH =
  "/_system/inventory-allocation.lock";
export const DROPBOX_ALLOCATION_LOCK_FOLDER = "/_system";
export const DROPBOX_ALLOCATION_LOCK_STALE_MS = 30_000;

/** API path "" is the App Folder root. Diagnostics use a nested temp folder. */
export const DROPBOX_DIAGNOSTICS_FOLDER_PATH = "/.kimartarchive-diagnostics";

/**
 * Standalone integration-test folder inside the App Folder.
 * Never use this path for real artwork uploads.
 */
export const DROPBOX_INTEGRATION_TEST_FOLDER = "/Integration Test";
export const DROPBOX_INTEGRATION_TEST_FILENAME = "hello.txt";
export const DROPBOX_INTEGRATION_TEST_FILE_PATH = `${DROPBOX_INTEGRATION_TEST_FOLDER}/${DROPBOX_INTEGRATION_TEST_FILENAME}`;
export const DROPBOX_INTEGRATION_TEST_CONTENTS =
  "Hello from the Kim Artwork Archive.";

/** File metadata returned by helpers (safe for clients — no tokens). */
export type DropboxFileMetadata = {
  id: string;
  name: string;
  pathDisplay: string;
  pathLower: string;
  size: number;
  isFolder: boolean;
  /** ISO timestamp from Dropbox `client_modified` when present. */
  clientModified?: string;
};

export type DropboxSharedLink = {
  url: string;
  name?: string;
  pathDisplay?: string;
};

/**
 * Persisted server-only credentials for this local installation.
 * Never send to the client.
 */
export type DropboxStoredCredentials = {
  refreshToken: string;
  accountId: string;
  displayName: string;
  email: string;
  connectedAt: string;
};

/** Safe account fields for UI (no tokens). */
export type DropboxAccountPublic = {
  accountId: string;
  displayName: string;
  email: string;
};

export type DropboxTokenExchangeResult = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  accountId: string;
  scope?: string;
  uid?: string;
};

export type DropboxAccessTokenResult = {
  accessToken: string;
  expiresIn: number;
  tokenType: string;
};

export type DropboxCurrentAccount = {
  accountId: string;
  email: string;
  displayName: string;
  abbreviatedName?: string;
};

export type DropboxConnectionStatus = {
  connected: boolean;
  account: DropboxAccountPublic | null;
  envReady: boolean;
  missingEnv: DropboxEnvKey[];
  hasRefreshToken: boolean;
  archiveFolderDisplay: string;
};

export type DropboxDiagnosticStepId =
  | "refresh_token_exists"
  | "access_token_refresh"
  | "account_lookup"
  | "archive_folder_exists"
  | "create_folder"
  | "upload_temp_file"
  | "delete_temp_file";

export type DropboxDiagnosticStep = {
  id: DropboxDiagnosticStepId;
  label: string;
  ok: boolean;
  message: string;
};

export type DropboxDiagnostics = {
  checkedAt: string;
  connected: boolean;
  env: {
    presence: DropboxEnvPresence;
    missing: DropboxEnvKey[];
    ready: boolean;
  };
  account: DropboxAccountPublic | null;
  archiveFolder: {
    displayPath: string;
    accessible: boolean;
    message: string;
  };
  steps: DropboxDiagnosticStep[];
  overall: {
    ready: boolean;
    label: "Ready" | "Not Connected" | "Incomplete";
    explanation: string;
  };
};

export type OAuthStateValidation =
  | { ok: true }
  | { ok: false; code: "MISSING_STATE" | "INVALID_STATE" | "STATE_MISMATCH" };
