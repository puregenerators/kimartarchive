import "server-only";

import { google } from "googleapis";
import {
  validateGoogleSheetsEnv,
  type GoogleSheetsEnv,
} from "@/lib/google/env";
import { GoogleIntegrationError, mapGoogleApiError } from "@/lib/google/errors";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
] as const;

export function getGoogleEnvSafe(): GoogleSheetsEnv {
  return validateGoogleSheetsEnv();
}

export function createGoogleAuth(
  env: GoogleSheetsEnv = validateGoogleSheetsEnv(),
) {
  try {
    return new google.auth.JWT({
      email: env.serviceAccountEmail,
      key: env.privateKey,
      scopes: [...GOOGLE_SCOPES],
    });
  } catch (error) {
    throw mapGoogleApiError(error, "auth");
  }
}

export function createSheetsClient(env?: GoogleSheetsEnv) {
  const auth = createGoogleAuth(env);
  return google.sheets({ version: "v4", auth });
}

export function createDriveClient(env?: GoogleSheetsEnv) {
  const auth = createGoogleAuth(env);
  return google.drive({ version: "v3", auth });
}

export async function assertGoogleAuthWorks(
  env: GoogleSheetsEnv = validateGoogleSheetsEnv(),
): Promise<void> {
  const auth = createGoogleAuth(env);
  try {
    await auth.authorize();
  } catch (error) {
    throw mapGoogleApiError(error, "auth");
  }
}

export function ensureServerOnlyGoogleModule(): void {
  if (typeof window !== "undefined") {
    throw new GoogleIntegrationError({
      code: "AUTH_FAILURE",
      message: "Google credentials must not be used in the browser.",
    });
  }
}
