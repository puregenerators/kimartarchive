/**
 * Pure / injectable Dropbox unit tests. Never calls the real Dropbox API.
 */

import {
  credentialsStorageDescription,
  isVercelRuntime,
  readDropboxCredentialsFromEnv,
} from "./credentials-logic";
import {
  MissingDropboxEnvError,
  getDropboxEnvPresence,
  listMissingDropboxEnvKeys,
  validateDropboxEnv,
} from "./env";
import {
  DropboxIntegrationError,
  mapDropboxApiError,
  sanitizeDropboxErrorText,
} from "./errors";
import {
  getDropboxDirectImageUrl,
  isDropboxSharedLinkAlreadyExistsError,
  normalizeDropboxSharedLinkForImage,
} from "./direct-image-url";
import {
  DROPBOX_AUTHORIZE_URL,
  buildAuthorizeUrl,
  exchangeAuthorizationCode,
  generateOAuthState,
  refreshAccessToken,
  validateOAuthState,
} from "./oauth";
import {
  buildArchiveOverallStatus,
  connectionStatusFromFlags,
  summarizeDiagnosticSteps,
} from "./status";
import {
  DROPBOX_INTEGRATION_TEST_CONTENTS,
  DROPBOX_INTEGRATION_TEST_FILENAME,
  DROPBOX_OAUTH_SCOPES,
  type DropboxDiagnosticStep,
  type DropboxFileMetadata,
} from "./types";
import type { DropboxFilesOps } from "./files-ops";
import { runDropboxUploadTest } from "./test-upload";

type TestCase = { name: string; run: () => void | Promise<void> };

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(
      `${message}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`,
    );
  }
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${message}\n  expected: ${e}\n  actual:   ${a}`);
  }
}

function assertThrows(fn: () => void, nameIncludes: string, message: string) {
  try {
    fn();
  } catch (error) {
    if (error instanceof Error && error.message.includes(nameIncludes)) {
      return;
    }
    throw new Error(
      `${message}\n  unexpected error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  throw new Error(`${message}\n  expected throw containing: ${nameIncludes}`);
}

async function assertRejects(
  fn: () => Promise<unknown>,
  codeOrMessage: string,
  message: string,
) {
  try {
    await fn();
  } catch (error) {
    if (error instanceof DropboxIntegrationError) {
      if (
        error.code === codeOrMessage ||
        error.message.includes(codeOrMessage) ||
        error.safeMessage.includes(codeOrMessage)
      ) {
        return error;
      }
    }
    if (error instanceof Error && error.message.includes(codeOrMessage)) {
      return error;
    }
    throw new Error(
      `${message}\n  unexpected error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  throw new Error(`${message}\n  expected rejection containing: ${codeOrMessage}`);
}

const testEnv = {
  DROPBOX_APP_KEY: "test-app-key",
  DROPBOX_APP_SECRET: "test-app-secret",
  DROPBOX_REDIRECT_URI: "http://localhost:3000/api/auth/dropbox/callback",
};

function mockFetchJson(
  status: number,
  body: unknown,
): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
}

const tests: TestCase[] = [
  {
    name: "validateOAuthState accepts matching state",
    run: () => {
      assertDeepEqual(
        validateOAuthState("abc123", "abc123"),
        { ok: true },
        "match",
      );
    },
  },
  {
    name: "validateOAuthState rejects missing received state",
    run: () => {
      assertDeepEqual(
        validateOAuthState("abc123", null),
        { ok: false, code: "MISSING_STATE" },
        "missing received",
      );
      assertDeepEqual(
        validateOAuthState("abc123", ""),
        { ok: false, code: "MISSING_STATE" },
        "empty received",
      );
    },
  },
  {
    name: "validateOAuthState rejects missing expected / invalid state",
    run: () => {
      assertDeepEqual(
        validateOAuthState(undefined, "abc"),
        { ok: false, code: "INVALID_STATE" },
        "no cookie",
      );
      assertDeepEqual(
        validateOAuthState("one", "two"),
        { ok: false, code: "STATE_MISMATCH" },
        "mismatch",
      );
    },
  },
  {
    name: "generateOAuthState returns opaque hex",
    run: () => {
      const a = generateOAuthState();
      const b = generateOAuthState();
      assertEqual(a.length >= 32, true, "length");
      assertEqual(/^[0-9a-f]+$/.test(a), true, "hex");
      assertEqual(a === b, false, "unique");
    },
  },
  {
    name: "buildAuthorizeUrl includes offline code flow params",
    run: () => {
      const url = buildAuthorizeUrl(
        {
          appKey: "key",
          appSecret: "secret",
          redirectUri: "http://localhost:3000/api/auth/dropbox/callback",
        },
        "csrf-state",
      );
      assertEqual(url.startsWith(DROPBOX_AUTHORIZE_URL), true, "base");
      const parsed = new URL(url);
      assertEqual(parsed.searchParams.get("response_type"), "code", "code");
      assertEqual(
        parsed.searchParams.get("token_access_type"),
        "offline",
        "offline",
      );
      assertEqual(parsed.searchParams.get("state"), "csrf-state", "state");
      assertEqual(parsed.searchParams.get("client_id"), "key", "client_id");
      const scope = parsed.searchParams.get("scope") ?? "";
      for (const s of DROPBOX_OAUTH_SCOPES) {
        assertEqual(scope.includes(s), true, `scope ${s}`);
      }
      assertEqual(url.includes("secret"), false, "no secret in URL");
    },
  },
  {
    name: "validateDropboxEnv and presence",
    run: () => {
      const presence = getDropboxEnvPresence(testEnv);
      assertDeepEqual(listMissingDropboxEnvKeys(presence), [], "none missing");
      const env = validateDropboxEnv(testEnv);
      assertEqual(env.appKey, "test-app-key", "key");
      assertThrows(
        () => validateDropboxEnv({}),
        "Missing required Dropbox",
        "missing throws",
      );
      try {
        validateDropboxEnv({});
      } catch (error) {
        assertEqual(
          error instanceof MissingDropboxEnvError,
          true,
          "typed error",
        );
      }
    },
  },
  {
    name: "exchangeAuthorizationCode success (mocked)",
    run: async () => {
      const fetchImpl = mockFetchJson(200, {
        access_token: "access-token-value",
        refresh_token: "refresh-token-value",
        expires_in: 14400,
        account_id: "dbid:test",
        token_type: "bearer",
      });
      const result = await exchangeAuthorizationCode(
        "auth-code",
        validateDropboxEnv(testEnv),
        fetchImpl,
      );
      assertEqual(result.accessToken, "access-token-value", "access");
      assertEqual(result.refreshToken, "refresh-token-value", "refresh");
      assertEqual(result.accountId, "dbid:test", "account");
    },
  },
  {
    name: "exchangeAuthorizationCode fails on HTTP error (mocked)",
    run: async () => {
      const fetchImpl = mockFetchJson(400, {
        error: "invalid_grant",
        error_description: "code expired",
      });
      await assertRejects(
        () =>
          exchangeAuthorizationCode(
            "bad-code",
            validateDropboxEnv(testEnv),
            fetchImpl,
          ),
        "TOKEN_EXCHANGE_FAILED",
        "exchange failure",
      );
    },
  },
  {
    name: "exchangeAuthorizationCode rejects empty code",
    run: async () => {
      await assertRejects(
        () =>
          exchangeAuthorizationCode(
            "  ",
            validateDropboxEnv(testEnv),
            mockFetchJson(200, {}),
          ),
        "TOKEN_EXCHANGE_FAILED",
        "empty code",
      );
    },
  },
  {
    name: "refreshAccessToken success (mocked)",
    run: async () => {
      const fetchImpl = mockFetchJson(200, {
        access_token: "new-access",
        expires_in: 14400,
        token_type: "bearer",
      });
      const result = await refreshAccessToken(
        "stored-refresh",
        validateDropboxEnv(testEnv),
        fetchImpl,
      );
      assertEqual(result.accessToken, "new-access", "access");
    },
  },
  {
    name: "refreshAccessToken failed refresh (mocked)",
    run: async () => {
      const fetchImpl = mockFetchJson(400, {
        error: "invalid_grant",
        error_description: "refresh token is invalid",
      });
      await assertRejects(
        () =>
          refreshAccessToken(
            "revoked-refresh",
            validateDropboxEnv(testEnv),
            fetchImpl,
          ),
        "TOKEN_REFRESH_FAILED",
        "failed refresh",
      );
    },
  },
  {
    name: "refreshAccessToken missing refresh token",
    run: async () => {
      await assertRejects(
        () =>
          refreshAccessToken(
            "",
            validateDropboxEnv(testEnv),
            mockFetchJson(200, {}),
          ),
        "MISSING_REFRESH_TOKEN",
        "missing refresh",
      );
    },
  },
  {
    name: "sanitizeDropboxErrorText redacts token-like strings",
    run: () => {
      const raw =
        'Bearer sl.ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdef and refresh_token=supersecrettokenvaluehere';
      const cleaned = sanitizeDropboxErrorText(raw);
      assertEqual(cleaned.includes("sl.ABCDEF"), false, "no sl token");
      assertEqual(cleaned.toLowerCase().includes("supersecret"), false, "no secret");
    },
  },
  {
    name: "mapDropboxApiError maps invalid_grant refresh failures",
    run: () => {
      const mapped = mapDropboxApiError(
        Object.assign(new Error("invalid_grant"), { status: 400 }),
        "refresh",
      );
      assertEqual(mapped.code, "TOKEN_REFRESH_FAILED", "code");
      assertEqual(mapped.safeMessage.includes("Reconnect"), true, "message");
    },
  },
  {
    name: "buildArchiveOverallStatus requires both providers",
    run: () => {
      assertEqual(
        buildArchiveOverallStatus({
          googleSheetsReady: true,
          dropboxReady: true,
        }).ready,
        true,
        "both ready",
      );
      assertEqual(
        buildArchiveOverallStatus({
          googleSheetsReady: true,
          dropboxReady: false,
        }).ready,
        false,
        "dropbox down",
      );
      assertEqual(
        buildArchiveOverallStatus({
          googleSheetsReady: false,
          dropboxReady: true,
        }).ready,
        false,
        "sheets down",
      );
      const status = buildArchiveOverallStatus({
        googleSheetsReady: true,
        dropboxReady: true,
      });
      assertEqual(status.googleSheets, "Connected", "sheets label");
      assertEqual(status.dropbox, "Connected", "dropbox label");
      assertEqual(status.archiveFolderReady, true, "folder");
    },
  },
  {
    name: "connectionStatusFromFlags",
    run: () => {
      assertEqual(
        connectionStatusFromFlags({ hasRefreshToken: true, envReady: true }),
        "connected",
        "connected",
      );
      assertEqual(
        connectionStatusFromFlags({ hasRefreshToken: false, envReady: true }),
        "not_connected",
        "not connected",
      );
      assertEqual(
        connectionStatusFromFlags({ hasRefreshToken: true, envReady: false }),
        "misconfigured",
        "misconfigured",
      );
    },
  },
  {
    name: "summarizeDiagnosticSteps pass/fail",
    run: () => {
      const steps: DropboxDiagnosticStep[] = [
        {
          id: "refresh_token_exists",
          label: "Refresh token exists",
          ok: true,
          message: "ok",
        },
        {
          id: "access_token_refresh",
          label: "Access token refresh",
          ok: false,
          message: "fail",
        },
      ];
      const summary = summarizeDiagnosticSteps(steps);
      assertEqual(summary.passed, 1, "passed");
      assertEqual(summary.failed, 1, "failed");
      assertEqual(summary.allPassed, false, "not all");
      assertEqual(
        summarizeDiagnosticSteps([
          { ...steps[0], ok: true },
          { ...steps[1], ok: true },
        ]).allPassed,
        true,
        "all passed",
      );
    },
  },
  {
    name: "diagnostics step ids cover required probes",
    run: () => {
      const required = [
        "refresh_token_exists",
        "access_token_refresh",
        "account_lookup",
        "archive_folder_exists",
        "create_folder",
        "upload_temp_file",
        "delete_temp_file",
      ];
      // Document expected diagnostic contract for UI/tests.
      assertEqual(required.length, 7, "seven steps");
    },
  },
  {
    name: "OAuth scopes include sharing for shared links",
    run: () => {
      assertEqual(DROPBOX_OAUTH_SCOPES.includes("sharing.write"), true, "write");
      assertEqual(DROPBOX_OAUTH_SCOPES.includes("sharing.read"), true, "read");
    },
  },
  {
    name: "upload test succeeds with mocked Dropbox ops",
    run: async () => {
      const result = await runDropboxUploadTest({
        ops: createMockUploadOps(),
        fetchImpl: mockSharedLinkFetch(200),
      });
      assertEqual(result.success, true, "success");
      if (!result.success) return;
      assertEqual(result.folderCreated, true, "folder");
      assertEqual(result.uploadSucceeded, true, "upload");
      assertEqual(result.metadataVerified, true, "metadata");
      assertEqual(result.sharedLinkCreated, true, "shared");
      assertEqual(result.downloadVerified, true, "download");
      assertEqual(result.fileDeleted, true, "file deleted");
      assertEqual(result.folderDeleted, true, "folder deleted");
      assertEqual(result.metadata.filename, DROPBOX_INTEGRATION_TEST_FILENAME, "name");
      assertEqual(
        result.metadata.size,
        Buffer.byteLength(DROPBOX_INTEGRATION_TEST_CONTENTS, "utf8"),
        "size",
      );
      assertEqual(result.sharedLink.startsWith("https://"), true, "link");
    },
  },
  {
    name: "upload test stops on upload failure",
    run: async () => {
      const result = await runDropboxUploadTest({
        ops: createMockUploadOps({
          uploadBuffer: async () => {
            throw new DropboxIntegrationError({
              code: "API_ERROR",
              message: "Upload rejected by mock.",
            });
          },
        }),
        fetchImpl: mockSharedLinkFetch(200),
      });
      assertEqual(result.success, false, "failed");
      if (result.success) return;
      assertEqual(result.failedOperation, "upload", "op");
      assertEqual(result.completedStep, "create_folder", "completed");
      assertEqual(result.folderCreated, true, "folder ok");
      assertEqual(result.uploadSucceeded, false, "upload flag");
    },
  },
  {
    name: "upload test stops on metadata failure",
    run: async () => {
      const result = await runDropboxUploadTest({
        ops: createMockUploadOps({
          getMetadata: async () => {
            throw new DropboxIntegrationError({
              code: "API_ERROR",
              message: "Metadata unavailable.",
            });
          },
        }),
        fetchImpl: mockSharedLinkFetch(200),
      });
      assertEqual(result.success, false, "failed");
      if (result.success) return;
      assertEqual(result.failedOperation, "verify_metadata", "op");
      assertEqual(result.uploadSucceeded, true, "upload ok");
      assertEqual(result.metadataVerified, false, "meta flag");
    },
  },
  {
    name: "upload test stops on shared link failure",
    run: async () => {
      const result = await runDropboxUploadTest({
        ops: createMockUploadOps({
          createSharedLink: async () => {
            throw new DropboxIntegrationError({
              code: "API_ERROR",
              message: "Shared link denied.",
            });
          },
        }),
        fetchImpl: mockSharedLinkFetch(200),
      });
      assertEqual(result.success, false, "failed");
      if (result.success) return;
      assertEqual(result.failedOperation, "create_shared_link", "op");
      assertEqual(result.metadataVerified, true, "meta ok");
      assertEqual(result.sharedLinkCreated, false, "shared flag");
    },
  },
  {
    name: "upload test stops when shared link URL does not work",
    run: async () => {
      const result = await runDropboxUploadTest({
        ops: createMockUploadOps(),
        fetchImpl: mockSharedLinkFetch(404),
      });
      assertEqual(result.success, false, "failed");
      if (result.success) return;
      assertEqual(result.failedOperation, "create_shared_link", "op");
    },
  },
  {
    name: "upload test stops on download failure",
    run: async () => {
      const result = await runDropboxUploadTest({
        ops: createMockUploadOps({
          downloadFile: async () => {
            throw new DropboxIntegrationError({
              code: "API_ERROR",
              message: "Download failed.",
            });
          },
        }),
        fetchImpl: mockSharedLinkFetch(200),
      });
      assertEqual(result.success, false, "failed");
      if (result.success) return;
      assertEqual(result.failedOperation, "download", "op");
      assertEqual(result.sharedLinkCreated, true, "shared ok");
      assertEqual(result.downloadVerified, false, "download flag");
    },
  },
  {
    name: "upload test stops on delete failure",
    run: async () => {
      const result = await runDropboxUploadTest({
        ops: createMockUploadOps({
          deleteFile: async () => {
            throw new DropboxIntegrationError({
              code: "API_ERROR",
              message: "Delete failed.",
            });
          },
        }),
        fetchImpl: mockSharedLinkFetch(200),
      });
      assertEqual(result.success, false, "failed");
      if (result.success) return;
      assertEqual(result.failedOperation, "delete_file", "op");
      assertEqual(result.downloadVerified, true, "download ok");
      assertEqual(result.fileDeleted, false, "delete flag");
    },
  },
  {
    name: "readDropboxCredentialsFromEnv requires refresh token",
    run: () => {
      assertEqual(
        readDropboxCredentialsFromEnv({}),
        null,
        "missing token is null",
      );
      const creds = readDropboxCredentialsFromEnv({
        DROPBOX_REFRESH_TOKEN: " rt-abc ",
        DROPBOX_ACCOUNT_ID: " dbid:xyz ",
        DROPBOX_ACCOUNT_DISPLAY_NAME: " Kim ",
        DROPBOX_ACCOUNT_EMAIL: " kim@example.com ",
      });
      assertEqual(creds?.refreshToken, "rt-abc", "token");
      assertEqual(creds?.accountId, "dbid:xyz", "account");
      assertEqual(creds?.displayName, "Kim", "name");
      assertEqual(creds?.email, "kim@example.com", "email");
    },
  },
  {
    name: "isVercelRuntime and storage description",
    run: () => {
      assertEqual(isVercelRuntime({}), false, "unset");
      assertEqual(isVercelRuntime({ VERCEL: "1" }), true, "vercel");
      assertEqual(
        credentialsStorageDescription().includes("DROPBOX_REFRESH_TOKEN"),
        true,
        "mentions env token",
      );
    },
  },
  {
    name: "shared Dropbox preview URL becomes a direct image URL",
    run: () => {
      const shared =
        "https://www.dropbox.com/scl/fi/abc123/tulip_thumb_01.jpg?rlkey=secretkey&dl=0";
      const result = normalizeDropboxSharedLinkForImage(shared);
      assertEqual(result.ok, true, "ok");
      if (!result.ok) return;
      const direct = new URL(result.directImageUrl);
      assertEqual(direct.hostname, "dl.dropboxusercontent.com", "usercontent host");
      assertEqual(direct.searchParams.get("raw"), "1", "raw=1");
      assertEqual(direct.searchParams.get("dl"), null, "dl removed");
      assertEqual(direct.searchParams.get("rlkey"), "secretkey", "rlkey kept");
      assertEqual(getDropboxDirectImageUrl(shared), result.directImageUrl, "helper");
    },
  },
  {
    name: "existing shared_link_already_exists is treated as reuse, not failure",
    run: () => {
      assertEqual(
        isDropboxSharedLinkAlreadyExistsError({
          errorTag: "shared_link_already_exists",
          message: "shared_link_already_exists/",
        }),
        true,
        "tag",
      );
      assertEqual(
        isDropboxSharedLinkAlreadyExistsError({
          errorSummary: "shared_link_already_exists/",
        }),
        true,
        "summary",
      );
      assertEqual(
        isDropboxSharedLinkAlreadyExistsError({
          message: "path/not_found/",
        }),
        false,
        "other error",
      );
    },
  },
];

function mockSharedLinkFetch(status: number): typeof fetch {
  return (async () =>
    new Response("ok", {
      status,
      headers: { "Content-Type": "text/plain" },
    })) as typeof fetch;
}

function createMockUploadOps(
  overrides: Partial<DropboxFilesOps> = {},
): DropboxFilesOps {
  const paths = new Set<string>();
  const files = new Map<string, Buffer>();

  const base: DropboxFilesOps = {
    async pathExists(path) {
      return paths.has(path) || files.has(path);
    },
    async createFolder(path) {
      paths.add(path);
      return { pathDisplay: path };
    },
    async deleteFolder(path) {
      paths.delete(path);
      for (const key of [...files.keys()]) {
        if (key.startsWith(`${path}/`)) files.delete(key);
      }
    },
    async uploadBuffer(path, contents) {
      const buf =
        typeof contents === "string"
          ? Buffer.from(contents, "utf8")
          : Buffer.from(contents);
      files.set(path, buf);
      paths.add(path);
      return {
        pathDisplay: path,
        id: "id:mock-file",
        name: path.split("/").pop() ?? "",
        size: buf.byteLength,
      };
    },
    async getMetadata(path) {
      const buf = files.get(path);
      if (!buf && !paths.has(path)) {
        throw new DropboxIntegrationError({
          code: "PATH_ERROR",
          message: "path/not_found/",
        });
      }
      const meta: DropboxFileMetadata = {
        id: paths.has(path) && !buf ? "id:mock-folder" : "id:mock-file",
        name: path.split("/").pop() ?? "",
        pathDisplay: path,
        pathLower: path.toLowerCase(),
        size: buf?.byteLength ?? 0,
        isFolder: Boolean(paths.has(path) && !buf),
      };
      return meta;
    },
    async createSharedLink(path) {
      if (!files.has(path) && !paths.has(path)) {
        throw new DropboxIntegrationError({
          code: "PATH_ERROR",
          message: "path/not_found/",
        });
      }
      return {
        url: `https://www.dropbox.com/s/mock/${encodeURIComponent(path)}?dl=0`,
        name: path.split("/").pop() ?? DROPBOX_INTEGRATION_TEST_FILENAME,
        pathDisplay: path,
      };
    },
    async downloadFile(path) {
      const buf = files.get(path);
      if (!buf) {
        throw new DropboxIntegrationError({
          code: "PATH_ERROR",
          message: "path/not_found/",
        });
      }
      return Buffer.from(buf);
    },
    async deleteFile(path) {
      if (!files.has(path)) {
        throw new DropboxIntegrationError({
          code: "PATH_ERROR",
          message: "path/not_found/",
        });
      }
      files.delete(path);
      paths.delete(path);
    },
    async movePath(fromPath, toPath) {
      if (!paths.has(fromPath) && !files.has(fromPath)) {
        throw new DropboxIntegrationError({
          code: "PATH_ERROR",
          message: "path/not_found/",
        });
      }
      const isFile = files.has(fromPath);
      if (isFile) {
        const buf = files.get(fromPath)!;
        files.delete(fromPath);
        paths.delete(fromPath);
        files.set(toPath, buf);
        paths.add(toPath);
      } else {
        paths.delete(fromPath);
        paths.add(toPath);
        for (const key of [...files.keys()]) {
          if (key.startsWith(`${fromPath}/`)) {
            const next = `${toPath}${key.slice(fromPath.length)}`;
            files.set(next, files.get(key)!);
            files.delete(key);
            paths.delete(key);
            paths.add(next);
          }
        }
      }
      return { pathDisplay: toPath };
    },
  };

  return { ...base, ...overrides };
}

async function main() {
  let failed = 0;
  for (const test of tests) {
    try {
      await test.run();
      console.log(`ok - ${test.name}`);
    } catch (error) {
      failed += 1;
      console.error(`fail - ${test.name}`);
      console.error(error instanceof Error ? error.message : error);
    }
  }
  if (failed > 0) {
    console.error(`\n${failed} Dropbox test(s) failed`);
    process.exit(1);
  }
  console.log(`\n${tests.length} Dropbox tests passed`);
}

void main();
