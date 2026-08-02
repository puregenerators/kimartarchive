import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";

import {
  credentialsStorageDescription,
  isVercelRuntime,
  readDropboxCredentialsFromEnv,
} from "@/lib/dropbox/credentials-logic";
import { DropboxIntegrationError } from "@/lib/dropbox/errors";
import type {
  DropboxAccountPublic,
  DropboxStoredCredentials,
} from "@/lib/dropbox/types";

export {
  isVercelRuntime,
  readDropboxCredentialsFromEnv,
} from "@/lib/dropbox/credentials-logic";

/**
 * Local credential file for this single-archive installation.
 *
 * Path (relative to process.cwd()): `.data/dropbox-credentials.json`
 *
 * Contains refresh token + account metadata. Never commit this file.
 * Never send contents to the browser. Never log the refresh token.
 *
 * On Vercel / serverless, prefer `DROPBOX_REFRESH_TOKEN` (and optional
 * account env vars) because the local filesystem is ephemeral.
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

async function readDropboxCredentialsFromFile(
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

/**
 * Prefer local `.data` file (dev), then env (`DROPBOX_REFRESH_TOKEN` for Vercel).
 */
export async function readDropboxCredentials(
  cwd: string = process.cwd(),
  envSource: NodeJS.ProcessEnv = process.env,
): Promise<DropboxStoredCredentials | null> {
  const fromFile = await readDropboxCredentialsFromFile(cwd);
  if (fromFile) return fromFile;
  return readDropboxCredentialsFromEnv(envSource);
}

export async function writeDropboxCredentials(
  credentials: DropboxStoredCredentials,
  cwd: string = process.cwd(),
  envSource: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (isVercelRuntime(envSource)) {
    throw new DropboxIntegrationError({
      code: "UNKNOWN",
      message:
        "Dropbox Connect cannot persist credentials on Vercel. Connect locally, then set DROPBOX_REFRESH_TOKEN (and optional DROPBOX_ACCOUNT_*) in the Vercel project environment.",
    });
  }

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
  envSource: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (isVercelRuntime(envSource) && readDropboxCredentialsFromEnv(envSource)) {
    throw new DropboxIntegrationError({
      code: "UNKNOWN",
      message:
        "Dropbox is connected via DROPBOX_REFRESH_TOKEN on Vercel. Remove that env var in the Vercel dashboard to disconnect.",
    });
  }

  const filePath = getDropboxCredentialsPath(cwd);
  try {
    await fs.rm(filePath, { force: true });
  } catch {
    // ignore
  }
}

export async function hasDropboxRefreshToken(
  cwd: string = process.cwd(),
  envSource: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const creds = await readDropboxCredentials(cwd, envSource);
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
  return credentialsStorageDescription();
}
