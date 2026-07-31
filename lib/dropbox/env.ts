import {
  DROPBOX_ENV_KEYS,
  type DropboxEnv,
  type DropboxEnvKey,
  type DropboxEnvPresence,
} from "@/lib/dropbox/types";

export {
  DROPBOX_ENV_KEYS,
  type DropboxEnv,
  type DropboxEnvKey,
  type DropboxEnvPresence,
} from "@/lib/dropbox/types";

export function getDropboxEnvPresence(
  source: NodeJS.ProcessEnv = process.env,
): DropboxEnvPresence {
  return {
    DROPBOX_APP_KEY: Boolean(source.DROPBOX_APP_KEY?.trim()),
    DROPBOX_APP_SECRET: Boolean(source.DROPBOX_APP_SECRET?.trim()),
    DROPBOX_REDIRECT_URI: Boolean(source.DROPBOX_REDIRECT_URI?.trim()),
  };
}

export function listMissingDropboxEnvKeys(
  presence: DropboxEnvPresence = getDropboxEnvPresence(),
): DropboxEnvKey[] {
  return DROPBOX_ENV_KEYS.filter((key) => !presence[key]);
}

export class MissingDropboxEnvError extends Error {
  readonly code = "MISSING_DROPBOX_ENV" as const;
  readonly missing: DropboxEnvKey[];

  constructor(missing: DropboxEnvKey[]) {
    super(
      `Missing required Dropbox environment variable(s): ${missing.join(", ")}`,
    );
    this.name = "MissingDropboxEnvError";
    this.missing = missing;
  }
}

export function validateDropboxEnv(
  source: NodeJS.ProcessEnv = process.env,
): DropboxEnv {
  const missing = listMissingDropboxEnvKeys(getDropboxEnvPresence(source));
  if (missing.length > 0) {
    throw new MissingDropboxEnvError(missing);
  }

  return {
    appKey: source.DROPBOX_APP_KEY!.trim(),
    appSecret: source.DROPBOX_APP_SECRET!.trim(),
    redirectUri: source.DROPBOX_REDIRECT_URI!.trim(),
  };
}
