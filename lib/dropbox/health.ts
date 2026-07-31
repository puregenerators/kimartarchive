import "server-only";

import {
  clearDropboxCredentials,
  hasDropboxRefreshToken,
  readDropboxCredentials,
  toPublicAccount,
  getCredentialsStorageDescription,
} from "@/lib/dropbox/credentials";
import {
  clearAccessTokenCache,
  getDropboxClient,
  getCurrentAccount,
  refreshAccessToken,
  type FetchLike,
} from "@/lib/dropbox/client";
import {
  getDropboxEnvPresence,
  listMissingDropboxEnvKeys,
  validateDropboxEnv,
} from "@/lib/dropbox/env";
import { DropboxIntegrationError } from "@/lib/dropbox/errors";
import {
  DROPBOX_ARCHIVE_ROOT_DISPLAY,
  DROPBOX_DIAGNOSTICS_FOLDER_PATH,
  type DropboxConnectionStatus,
  type DropboxDiagnosticStep,
  type DropboxDiagnostics,
} from "@/lib/dropbox/types";
import { buildArchiveOverallStatus } from "@/lib/dropbox/status";

export { getCredentialsStorageDescription, buildArchiveOverallStatus };

export async function getConnectionStatus(): Promise<DropboxConnectionStatus> {
  const presence = getDropboxEnvPresence();
  const missingEnv = listMissingDropboxEnvKeys(presence);
  const credentials = await readDropboxCredentials();
  const hasRefreshToken = Boolean(credentials?.refreshToken);

  return {
    connected: hasRefreshToken,
    account: credentials ? toPublicAccount(credentials) : null,
    envReady: missingEnv.length === 0,
    missingEnv,
    hasRefreshToken,
    archiveFolderDisplay: DROPBOX_ARCHIVE_ROOT_DISPLAY,
  };
}

/**
 * Lightweight connection check: refresh + account lookup.
 * Does not create or delete files.
 */
export async function verifyConnection(
  fetchImpl: FetchLike = fetch,
): Promise<{
  ok: boolean;
  account: DropboxConnectionStatus["account"];
  error?: { code: string; message: string };
}> {
  try {
    validateDropboxEnv();
    const hasToken = await hasDropboxRefreshToken();
    if (!hasToken) {
      return {
        ok: false,
        account: null,
        error: {
          code: "NOT_CONNECTED",
          message: "Dropbox is not connected.",
        },
      };
    }

    await refreshAccessToken({ force: true, fetchImpl });
    const account = await getCurrentAccount(fetchImpl);
    return {
      ok: true,
      account: {
        accountId: account.accountId,
        displayName: account.displayName,
        email: account.email,
      },
    };
  } catch (error) {
    if (error instanceof DropboxIntegrationError) {
      return {
        ok: false,
        account: null,
        error: { code: error.code, message: error.safeMessage },
      };
    }
    return {
      ok: false,
      account: null,
      error: { code: "UNKNOWN", message: "Dropbox connection check failed." },
    };
  }
}

function step(
  id: DropboxDiagnosticStep["id"],
  label: string,
  ok: boolean,
  message: string,
): DropboxDiagnosticStep {
  return { id, label, ok, message };
}

/**
 * Full Dropbox diagnostics. Uses a temporary folder under the App Folder.
 * Does not modify artwork archive content outside the diagnostics folder.
 */
export async function runDropboxDiagnostics(
  fetchImpl: FetchLike = fetch,
): Promise<DropboxDiagnostics> {
  const checkedAt = new Date().toISOString();
  const presence = getDropboxEnvPresence();
  const missing = listMissingDropboxEnvKeys(presence);
  const env = {
    presence,
    missing,
    ready: missing.length === 0,
  };

  const credentials = await readDropboxCredentials();
  const steps: DropboxDiagnosticStep[] = [];

  const refreshExists = Boolean(credentials?.refreshToken);
  steps.push(
    step(
      "refresh_token_exists",
      "Refresh token exists",
      refreshExists,
      refreshExists
        ? "A refresh token is stored for this local installation."
        : "No refresh token on disk. Connect Dropbox.",
    ),
  );

  if (!env.ready) {
    return {
      checkedAt,
      connected: false,
      env,
      account: null,
      archiveFolder: {
        displayPath: DROPBOX_ARCHIVE_ROOT_DISPLAY,
        accessible: false,
        message: `Missing env: ${missing.join(", ")}`,
      },
      steps: [
        ...steps,
        step(
          "access_token_refresh",
          "Access token refresh",
          false,
          "Skipped: Dropbox env incomplete.",
        ),
        step(
          "account_lookup",
          "Account lookup",
          false,
          "Skipped: Dropbox env incomplete.",
        ),
        step(
          "archive_folder_exists",
          "Archive folder accessible",
          false,
          "Skipped: Dropbox env incomplete.",
        ),
        step(
          "create_folder",
          "Create diagnostics folder",
          false,
          "Skipped: Dropbox env incomplete.",
        ),
        step(
          "upload_temp_file",
          "Upload temporary file",
          false,
          "Skipped: Dropbox env incomplete.",
        ),
        step(
          "delete_temp_file",
          "Delete temporary file",
          false,
          "Skipped: Dropbox env incomplete.",
        ),
      ],
      overall: {
        ready: false,
        label: "Incomplete",
        explanation:
          "Dropbox environment variables are missing. See docs/DROPBOX_SETUP.md.",
      },
    };
  }

  if (!refreshExists) {
    return {
      checkedAt,
      connected: false,
      env,
      account: null,
      archiveFolder: {
        displayPath: DROPBOX_ARCHIVE_ROOT_DISPLAY,
        accessible: false,
        message: "Not connected.",
      },
      steps: [
        ...steps,
        step(
          "access_token_refresh",
          "Access token refresh",
          false,
          "Skipped: no refresh token.",
        ),
        step(
          "account_lookup",
          "Account lookup",
          false,
          "Skipped: no refresh token.",
        ),
        step(
          "archive_folder_exists",
          "Archive folder accessible",
          false,
          "Skipped: no refresh token.",
        ),
        step(
          "create_folder",
          "Create diagnostics folder",
          false,
          "Skipped: no refresh token.",
        ),
        step(
          "upload_temp_file",
          "Upload temporary file",
          false,
          "Skipped: no refresh token.",
        ),
        step(
          "delete_temp_file",
          "Delete temporary file",
          false,
          "Skipped: no refresh token.",
        ),
      ],
      overall: {
        ready: false,
        label: "Not Connected",
        explanation: "Connect Dropbox to authorize this local archive.",
      },
    };
  }

  let accountPublic = toPublicAccount(credentials!);
  let refreshOk = false;
  let accountOk = false;
  let archiveOk = false;
  let createOk = false;
  let uploadOk = false;
  let deleteOk = false;

  try {
    await refreshAccessToken({ force: true, fetchImpl });
    refreshOk = true;
    steps.push(
      step(
        "access_token_refresh",
        "Access token refresh",
        true,
        "Refresh token exchanged for a short-lived access token.",
      ),
    );
  } catch (error) {
    const message =
      error instanceof DropboxIntegrationError
        ? error.safeMessage
        : "Access token refresh failed.";
    steps.push(
      step("access_token_refresh", "Access token refresh", false, message),
    );
  }

  if (refreshOk) {
    try {
      const account = await getCurrentAccount(fetchImpl);
      accountPublic = {
        accountId: account.accountId,
        displayName: account.displayName,
        email: account.email,
      };
      accountOk = true;
      steps.push(
        step(
          "account_lookup",
          "Account lookup",
          true,
          `Signed in as ${account.displayName}.`,
        ),
      );
    } catch (error) {
      const message =
        error instanceof DropboxIntegrationError
          ? error.safeMessage
          : "Account lookup failed.";
      steps.push(step("account_lookup", "Account lookup", false, message));
    }
  } else {
    steps.push(
      step(
        "account_lookup",
        "Account lookup",
        false,
        "Skipped: refresh failed.",
      ),
    );
  }

  if (refreshOk && accountOk) {
    try {
      const client = await getDropboxClient(fetchImpl);
      // App Folder root is "" — confirms app can access Apps/Kim Art Archive/
      await client.listFolder("");
      archiveOk = true;
      steps.push(
        step(
          "archive_folder_exists",
          "Archive folder accessible",
          true,
          `App Folder root (${DROPBOX_ARCHIVE_ROOT_DISPLAY}) is reachable.`,
        ),
      );

      const diagFolder = DROPBOX_DIAGNOSTICS_FOLDER_PATH;
      try {
        await client.createFolder(diagFolder);
      } catch (error) {
        // path/conflict means it already exists — treat as success
        const msg =
          error instanceof Error ? error.message.toLowerCase() : "";
        if (!msg.includes("conflict") && !msg.includes("path/conflict")) {
          throw error;
        }
      }
      createOk = true;
      steps.push(
        step(
          "create_folder",
          "Create diagnostics folder",
          true,
          `Diagnostics folder ${diagFolder} is available.`,
        ),
      );

      const tempPath = `${diagFolder}/probe-${Date.now()}.txt`;
      await client.uploadFile(
        tempPath,
        "kimartarchive-dropbox-diagnostics\n",
      );
      uploadOk = true;
      steps.push(
        step(
          "upload_temp_file",
          "Upload temporary file",
          true,
          "Uploaded a temporary probe file.",
        ),
      );

      await client.deletePath(tempPath);
      deleteOk = true;
      steps.push(
        step(
          "delete_temp_file",
          "Delete temporary file",
          true,
          "Deleted the temporary probe file.",
        ),
      );
    } catch (error) {
      const message =
        error instanceof DropboxIntegrationError
          ? error.safeMessage
          : error instanceof Error
            ? error.message
            : "Dropbox file probe failed.";

      if (!archiveOk) {
        steps.push(
          step(
            "archive_folder_exists",
            "Archive folder accessible",
            false,
            message,
          ),
        );
      }
      if (!createOk) {
        steps.push(
          step("create_folder", "Create diagnostics folder", false, message),
        );
      }
      if (!uploadOk) {
        steps.push(
          step("upload_temp_file", "Upload temporary file", false, message),
        );
      }
      if (!deleteOk) {
        steps.push(
          step("delete_temp_file", "Delete temporary file", false, message),
        );
      }
    }
  } else {
    for (const [id, label] of [
      ["archive_folder_exists", "Archive folder accessible"],
      ["create_folder", "Create diagnostics folder"],
      ["upload_temp_file", "Upload temporary file"],
      ["delete_temp_file", "Delete temporary file"],
    ] as const) {
      if (!steps.some((s) => s.id === id)) {
        steps.push(step(id, label, false, "Skipped: earlier step failed."));
      }
    }
  }

  const allOk =
    refreshExists &&
    refreshOk &&
    accountOk &&
    archiveOk &&
    createOk &&
    uploadOk &&
    deleteOk;

  return {
    checkedAt,
    connected: refreshExists && refreshOk && accountOk,
    env,
    account: accountPublic,
    archiveFolder: {
      displayPath: DROPBOX_ARCHIVE_ROOT_DISPLAY,
      accessible: archiveOk,
      message: archiveOk
        ? "App Folder is accessible."
        : "Could not access the App Folder root.",
    },
    steps,
    overall: allOk
      ? {
          ready: true,
          label: "Ready",
          explanation:
            "Dropbox is connected, tokens refresh, and App Folder write probes succeeded.",
        }
      : {
          ready: false,
          label: "Incomplete",
          explanation:
            "One or more Dropbox diagnostic steps failed. See step details.",
        },
  };
}

export async function disconnectDropbox(): Promise<void> {
  clearAccessTokenCache();
  await clearDropboxCredentials();
}
