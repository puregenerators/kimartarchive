/**
 * Dropbox credential resolution helpers (no `server-only` — unit-testable).
 */

import type { DropboxStoredCredentials } from "@/lib/dropbox/types";

export function isVercelRuntime(
  source: NodeJS.ProcessEnv = process.env,
): boolean {
  return source.VERCEL === "1";
}

/**
 * Read Dropbox credentials from env (production / Vercel).
 */
export function readDropboxCredentialsFromEnv(
  source: NodeJS.ProcessEnv = process.env,
): DropboxStoredCredentials | null {
  const refreshToken = source.DROPBOX_REFRESH_TOKEN?.trim() ?? "";
  if (!refreshToken) return null;

  return {
    refreshToken,
    accountId: source.DROPBOX_ACCOUNT_ID?.trim() || "env",
    displayName:
      source.DROPBOX_ACCOUNT_DISPLAY_NAME?.trim() || "Dropbox (env)",
    email: source.DROPBOX_ACCOUNT_EMAIL?.trim() || "",
    connectedAt:
      source.DROPBOX_CONNECTED_AT?.trim() || "1970-01-01T00:00:00.000Z",
  };
}

export function credentialsStorageDescription(): string {
  return (
    "Locally, Dropbox refresh tokens are stored in " +
    ".data/dropbox-credentials.json (gitignored). On Vercel, set " +
    "DROPBOX_REFRESH_TOKEN (and optional DROPBOX_ACCOUNT_* metadata). " +
    "Tokens are never sent to the browser."
  );
}
