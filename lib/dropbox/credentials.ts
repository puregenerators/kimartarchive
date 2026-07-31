import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";

import { DropboxIntegrationError } from "@/lib/dropbox/errors";
import type {
  DropboxAccountPublic,
  DropboxStoredCredentials,
} from "@/lib/dropbox/types";

/**
 * Local credential file for this single-archive installation.
 *
 * Path (relative to process.cwd()): `.data/dropbox-credentials.json`
 *
 * Contains refresh token + account metadata. Never commit this file.
 * Never send contents to the browser. Never log the refresh token.
 */
export const DROPBOX_CREDENTIALS_DIR_NAME = ".data";
export const DROPBOX_CREDENTIALS_FILE_NAME = "dropbox-credentials.json";

export function getDropboxCredentialsPath(
  cwd: string = process.cwd(),
): string {
  return path.join(
    cwd,
    DROPBOX_CREDENTIALS_DIR_NAME,
    DROPBOX_CREDENTIALS_FILE_NAME,
  );
}

function isStoredCredentials(value: unknown): value is DropboxStoredCredentials {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.refreshToken === "string" &&
    v.refreshToken.length > 0 &&
    typeof v.accountId === "string" &&
    typeof v.displayName === "string" &&
    typeof v.email === "string" &&
    typeof v.connectedAt === "string"
  );
}

export async function readDropboxCredentials(
  cwd: string = process.cwd(),
): Promise<DropboxStoredCredentials | null> {
  const filePath = getDropboxCredentialsPath(cwd);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isStoredCredentials(parsed)) {
      return null;
    }
    return parsed;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return null;
    }
    throw new DropboxIntegrationError({
      code: "UNKNOWN",
      message: "Could not read Dropbox credentials file.",
    });
  }
}

export async function writeDropboxCredentials(
  credentials: DropboxStoredCredentials,
  cwd: string = process.cwd(),
): Promise<void> {
  const filePath = getDropboxCredentialsPath(cwd);
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const payload = JSON.stringify(credentials, null, 2);
  await fs.writeFile(filePath, `${payload}\n`, { mode: 0o600 });
  try {
    await fs.chmod(filePath, 0o600);
  } catch {
    // Windows may ignore chmod; best-effort.
  }
}

export async function clearDropboxCredentials(
  cwd: string = process.cwd(),
): Promise<void> {
  const filePath = getDropboxCredentialsPath(cwd);
  try {
    await fs.rm(filePath, { force: true });
  } catch {
    // ignore
  }
}

export async function hasDropboxRefreshToken(
  cwd: string = process.cwd(),
): Promise<boolean> {
  const creds = await readDropboxCredentials(cwd);
  return Boolean(creds?.refreshToken);
}

export function toPublicAccount(
  credentials: DropboxStoredCredentials,
): DropboxAccountPublic {
  return {
    accountId: credentials.accountId,
    displayName: credentials.displayName,
    email: credentials.email,
  };
}

export function getCredentialsStorageDescription(): string {
  return (
    "Dropbox refresh tokens are stored server-side in " +
    `${DROPBOX_CREDENTIALS_DIR_NAME}/${DROPBOX_CREDENTIALS_FILE_NAME} ` +
    "(gitignored). They are never sent to the browser."
  );
}
