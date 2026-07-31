import "server-only";

import {
  readDropboxCredentials,
  writeDropboxCredentials,
  toPublicAccount,
} from "@/lib/dropbox/credentials";
import { validateDropboxEnv } from "@/lib/dropbox/env";
import {
  DropboxIntegrationError,
  mapDropboxApiError,
  sanitizeDropboxErrorText,
} from "@/lib/dropbox/errors";
import { refreshAccessToken as oauthRefreshAccessToken } from "@/lib/dropbox/oauth";
import type {
  DropboxAccountPublic,
  DropboxCurrentAccount,
  DropboxFileMetadata,
  DropboxSharedLink,
  DropboxStoredCredentials,
} from "@/lib/dropbox/types";

export type FetchLike = typeof fetch;

type CachedAccessToken = {
  accessToken: string;
  expiresAtMs: number;
};

/** In-memory access token only — never persisted to disk. */
let accessTokenCache: CachedAccessToken | null = null;

const EXPIRY_SKEW_MS = 60_000;

export function clearAccessTokenCache(): void {
  accessTokenCache = null;
}

export type DropboxClient = {
  getAccessToken: () => Promise<string>;
  getCurrentAccount: () => Promise<DropboxCurrentAccount>;
  listFolder: (path: string) => Promise<{ entries: unknown[] }>;
  createFolder: (path: string) => Promise<{ pathDisplay: string }>;
  /** Alias used by the archive file helpers / future submission pipeline. */
  uploadBuffer: (
    path: string,
    contents: Buffer | Uint8Array | string,
  ) => Promise<{ pathDisplay: string; id: string; name: string; size: number }>;
  uploadFile: (
    path: string,
    contents: Buffer | Uint8Array | string,
  ) => Promise<{ pathDisplay: string; id: string; name: string; size: number }>;
  getMetadata: (path: string) => Promise<DropboxFileMetadata>;
  downloadFile: (path: string) => Promise<Buffer>;
  createSharedLink: (path: string) => Promise<DropboxSharedLink>;
  deleteFile: (path: string) => Promise<void>;
  deleteFolder: (path: string) => Promise<void>;
  deletePath: (path: string) => Promise<void>;
  movePath: (
    fromPath: string,
    toPath: string,
  ) => Promise<{ pathDisplay: string }>;
  request: <T>(options: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: BodyInit | null;
    apiArg?: unknown;
  }) => Promise<T>;
};

async function getStoredCredentialsOrThrow(): Promise<DropboxStoredCredentials> {
  const credentials = await readDropboxCredentials();
  if (!credentials?.refreshToken) {
    throw new DropboxIntegrationError({
      code: "MISSING_REFRESH_TOKEN",
      message:
        "No Dropbox refresh token is stored. Connect Dropbox from Archive Setup.",
    });
  }
  return credentials;
}

/**
 * Silently exchange the stored refresh token for a short-lived access token.
 * Updates the in-memory cache only (refresh token stays on disk).
 */
export async function refreshAccessToken(
  options: { force?: boolean; fetchImpl?: FetchLike } = {},
): Promise<string> {
  const { force = false, fetchImpl = fetch } = options;
  const now = Date.now();

  if (
    !force &&
    accessTokenCache &&
    accessTokenCache.expiresAtMs - EXPIRY_SKEW_MS > now
  ) {
    return accessTokenCache.accessToken;
  }

  const credentials = await getStoredCredentialsOrThrow();
  const env = validateDropboxEnv();
  const result = await oauthRefreshAccessToken(
    credentials.refreshToken,
    env,
    fetchImpl,
  );

  accessTokenCache = {
    accessToken: result.accessToken,
    expiresAtMs: now + result.expiresIn * 1000,
  };

  return result.accessToken;
}

type DropboxHttpError = Error & {
  status?: number;
  errorSummary?: string;
  errorTag?: string;
  errorBody?: unknown;
};

async function readDropboxError(response: Response): Promise<DropboxHttpError> {
  let detail = `HTTP ${response.status}`;
  let errorSummary: string | undefined;
  let errorTag: string | undefined;
  let errorBody: unknown;
  try {
    const errBody = (await response.json()) as {
      error_summary?: string;
      error?: { ".tag"?: string } & Record<string, unknown>;
    };
    errorBody = errBody;
    if (errBody.error_summary) {
      errorSummary = errBody.error_summary;
      detail = sanitizeDropboxErrorText(errBody.error_summary);
    }
    if (errBody.error?.[".tag"]) {
      errorTag = errBody.error[".tag"];
    }
  } catch {
    // ignore parse failures
  }
  const err = new Error(detail) as DropboxHttpError;
  err.status = response.status;
  err.errorSummary = errorSummary;
  err.errorTag = errorTag;
  err.errorBody = errorBody;
  return err;
}

async function dropboxFetchJson<T>(
  accessToken: string,
  url: string,
  init: RequestInit,
  fetchImpl: FetchLike,
): Promise<T> {
  const response = await fetchImpl(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw await readDropboxError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  if (!text) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

function parseFileMetadata(json: {
  id?: string;
  name?: string;
  path_display?: string;
  path_lower?: string;
  size?: number;
  ".tag"?: string;
}): DropboxFileMetadata {
  return {
    id: json.id ?? "",
    name: json.name ?? "",
    pathDisplay: json.path_display ?? "",
    pathLower: json.path_lower ?? "",
    size: typeof json.size === "number" ? json.size : 0,
    isFolder: json[".tag"] === "folder",
  };
}

/**
 * Authenticated Dropbox HTTP client with automatic token refresh + one retry.
 */
export async function getDropboxClient(
  fetchImpl: FetchLike = fetch,
): Promise<DropboxClient> {
  await getStoredCredentialsOrThrow();

  async function withToken<T>(
    run: (accessToken: string) => Promise<T>,
  ): Promise<T> {
    let token = await refreshAccessToken({ fetchImpl });
    try {
      return await run(token);
    } catch (error) {
      const status =
        error && typeof error === "object" && "status" in error
          ? Number((error as { status?: number }).status)
          : undefined;
      if (status === 401) {
        try {
          token = await refreshAccessToken({ force: true, fetchImpl });
          return await run(token);
        } catch (retryError) {
          throw mapDropboxApiError(retryError, "api");
        }
      }
      throw mapDropboxApiError(error, "api");
    }
  }

  async function uploadFile(
    filePath: string,
    contents: Buffer | Uint8Array | string,
  ) {
    return withToken(async (accessToken) => {
      const bytes =
        typeof contents === "string"
          ? new TextEncoder().encode(contents)
          : new Uint8Array(contents);
      const json = await dropboxFetchJson<{
        path_display?: string;
        id?: string;
        name?: string;
        size?: number;
      }>(
        accessToken,
        "https://content.dropboxapi.com/2/files/upload",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "Dropbox-API-Arg": JSON.stringify({
              path: filePath,
              mode: "overwrite",
              autorename: false,
              mute: true,
            }),
          },
          body: bytes,
        },
        fetchImpl,
      );
      return {
        pathDisplay: json.path_display ?? filePath,
        id: json.id ?? "",
        name: json.name ?? filePath.split("/").pop() ?? "",
        size: typeof json.size === "number" ? json.size : bytes.byteLength,
      };
    });
  }

  async function deletePath(targetPath: string) {
    return withToken(async (accessToken) => {
      await dropboxFetchJson(
        accessToken,
        "https://api.dropboxapi.com/2/files/delete_v2",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: targetPath }),
        },
        fetchImpl,
      );
    });
  }

  return {
    getAccessToken: () => refreshAccessToken({ fetchImpl }),

    async getCurrentAccount() {
      return withToken(async (accessToken) => {
        try {
          const json = await dropboxFetchJson<{
            account_id: string;
            email: string;
            name: {
              display_name: string;
              abbreviated_name?: string;
            };
          }>(
            accessToken,
            "https://api.dropboxapi.com/2/users/get_current_account",
            { method: "POST" },
            fetchImpl,
          );

          return {
            accountId: json.account_id,
            email: json.email,
            displayName: json.name.display_name,
            abbreviatedName: json.name.abbreviated_name,
          };
        } catch (error) {
          throw mapDropboxApiError(error, "account");
        }
      });
    },

    async listFolder(folderPath: string) {
      return withToken(async (accessToken) => {
        const json = await dropboxFetchJson<{ entries: unknown[] }>(
          accessToken,
          "https://api.dropboxapi.com/2/files/list_folder",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              path: folderPath === "/" ? "" : folderPath,
              limit: 20,
            }),
          },
          fetchImpl,
        );
        return { entries: json.entries ?? [] };
      });
    },

    async createFolder(folderPath: string) {
      return withToken(async (accessToken) => {
        const json = await dropboxFetchJson<{
          metadata: { path_display?: string };
        }>(
          accessToken,
          "https://api.dropboxapi.com/2/files/create_folder_v2",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              path: folderPath,
              autorename: false,
            }),
          },
          fetchImpl,
        );
        return {
          pathDisplay: json.metadata?.path_display ?? folderPath,
        };
      });
    },

    uploadFile,
    uploadBuffer: uploadFile,

    async getMetadata(targetPath: string) {
      return withToken(async (accessToken) => {
        const json = await dropboxFetchJson<{
          id?: string;
          name?: string;
          path_display?: string;
          path_lower?: string;
          size?: number;
          ".tag"?: string;
        }>(
          accessToken,
          "https://api.dropboxapi.com/2/files/get_metadata",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              path: targetPath,
              include_deleted: false,
            }),
          },
          fetchImpl,
        );
        return parseFileMetadata(json);
      });
    },

    async downloadFile(filePath: string) {
      return withToken(async (accessToken) => {
        const response = await fetchImpl(
          "https://content.dropboxapi.com/2/files/download",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Dropbox-API-Arg": JSON.stringify({ path: filePath }),
            },
          },
        );

        if (!response.ok) {
          throw await readDropboxError(response);
        }

        return Buffer.from(await response.arrayBuffer());
      });
    },

    async createSharedLink(targetPath: string) {
      return withToken(async (accessToken) => {
        try {
          const json = await dropboxFetchJson<{
            url?: string;
            name?: string;
            path_display?: string;
          }>(
            accessToken,
            "https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                path: targetPath,
                settings: {
                  requested_visibility: "public",
                  audience: "public",
                  access: "viewer",
                },
              }),
            },
            fetchImpl,
          );
          return {
            url: json.url ?? "",
            name: json.name,
            pathDisplay: json.path_display,
          };
        } catch (error) {
          const err = error as DropboxHttpError;
          const alreadyExists =
            err.errorTag === "shared_link_already_exists" ||
            (err.errorSummary ?? err.message ?? "")
              .toLowerCase()
              .includes("shared_link_already_exists");

          if (!alreadyExists) {
            throw error;
          }

          const listed = await dropboxFetchJson<{
            links?: Array<{
              url?: string;
              name?: string;
              path_display?: string;
            }>;
          }>(
            accessToken,
            "https://api.dropboxapi.com/2/sharing/list_shared_links",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                path: targetPath,
                direct_only: true,
              }),
            },
            fetchImpl,
          );

          const link = listed.links?.[0];
          if (!link?.url) {
            throw error;
          }
          return {
            url: link.url,
            name: link.name,
            pathDisplay: link.path_display,
          };
        }
      });
    },

    deletePath,
    deleteFile: deletePath,
    deleteFolder: deletePath,

    async movePath(fromPath: string, toPath: string) {
      return withToken(async (accessToken) => {
        const json = await dropboxFetchJson<{
          metadata?: { path_display?: string };
        }>(
          accessToken,
          "https://api.dropboxapi.com/2/files/move_v2",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              from_path: fromPath,
              to_path: toPath,
              autorename: false,
              allow_ownership_transfer: false,
            }),
          },
          fetchImpl,
        );
        return {
          pathDisplay: json.metadata?.path_display ?? toPath,
        };
      });
    },

    async request<T>(options: {
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: BodyInit | null;
      apiArg?: unknown;
    }) {
      return withToken(async (accessToken) => {
        const headers: Record<string, string> = {
          ...(options.headers ?? {}),
        };
        if (options.apiArg !== undefined) {
          headers["Dropbox-API-Arg"] = JSON.stringify(options.apiArg);
        }
        return dropboxFetchJson<T>(
          accessToken,
          options.url,
          {
            method: options.method ?? "POST",
            headers,
            body: options.body,
          },
          fetchImpl,
        );
      });
    },
  };
}

export async function getCurrentAccount(
  fetchImpl: FetchLike = fetch,
): Promise<DropboxCurrentAccount> {
  const client = await getDropboxClient(fetchImpl);
  return client.getCurrentAccount();
}

/**
 * Persist OAuth result + account profile after a successful callback.
 * Never logs tokens.
 */
export async function persistOAuthConnection(input: {
  refreshToken: string;
  accountId: string;
  displayName: string;
  email: string;
  accessToken?: string;
  expiresIn?: number;
}): Promise<DropboxAccountPublic> {
  const credentials: DropboxStoredCredentials = {
    refreshToken: input.refreshToken,
    accountId: input.accountId,
    displayName: input.displayName,
    email: input.email,
    connectedAt: new Date().toISOString(),
  };
  await writeDropboxCredentials(credentials);
  clearAccessTokenCache();
  if (input.accessToken && input.expiresIn) {
    accessTokenCache = {
      accessToken: input.accessToken,
      expiresAtMs: Date.now() + input.expiresIn * 1000,
    };
  }
  return toPublicAccount(credentials);
}
