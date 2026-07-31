import { randomBytes } from "node:crypto";

import {
  MissingDropboxEnvError,
  validateDropboxEnv,
  type DropboxEnv,
} from "@/lib/dropbox/env";
import {
  DropboxIntegrationError,
  mapDropboxApiError,
  sanitizeDropboxErrorText,
} from "@/lib/dropbox/errors";
import {
  DROPBOX_OAUTH_SCOPES,
  type DropboxAccessTokenResult,
  type DropboxTokenExchangeResult,
  type OAuthStateValidation,
} from "@/lib/dropbox/types";

export const DROPBOX_AUTHORIZE_URL = "https://www.dropbox.com/oauth2/authorize";
export const DROPBOX_TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";

/** HttpOnly cookie name for OAuth CSRF state (not credentials). */
export const DROPBOX_OAUTH_STATE_COOKIE = "dropbox_oauth_state";

export const DROPBOX_OAUTH_STATE_MAX_AGE_SECONDS = 60 * 10;

export type FetchLike = typeof fetch;

export function generateOAuthState(): string {
  return randomBytes(24).toString("hex");
}

export function validateOAuthState(
  expected: string | undefined | null,
  received: string | undefined | null,
): OAuthStateValidation {
  if (!received || !received.trim()) {
    return { ok: false, code: "MISSING_STATE" };
  }
  if (!expected || !expected.trim()) {
    return { ok: false, code: "INVALID_STATE" };
  }
  if (expected !== received) {
    return { ok: false, code: "STATE_MISMATCH" };
  }
  return { ok: true };
}

export function buildAuthorizeUrl(env: DropboxEnv, state: string): string {
  const params = new URLSearchParams({
    client_id: env.appKey,
    redirect_uri: env.redirectUri,
    response_type: "code",
    token_access_type: "offline",
    state,
    scope: DROPBOX_OAUTH_SCOPES.join(" "),
  });
  return `${DROPBOX_AUTHORIZE_URL}?${params.toString()}`;
}

type TokenEndpointJson = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  account_id?: string;
  uid?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function postTokenForm(
  body: URLSearchParams,
  fetchImpl: FetchLike,
): Promise<TokenEndpointJson> {
  const response = await fetchImpl(DROPBOX_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  let json: TokenEndpointJson = {};
  try {
    json = (await response.json()) as TokenEndpointJson;
  } catch {
    json = {};
  }

  if (!response.ok) {
    const err = new Error(
      sanitizeDropboxErrorText(
        json.error_description || json.error || `HTTP ${response.status}`,
      ),
    );
    (err as Error & { status?: number }).status = response.status;
    throw err;
  }

  return json;
}

export async function exchangeAuthorizationCode(
  code: string,
  env: DropboxEnv = validateDropboxEnv(),
  fetchImpl: FetchLike = fetch,
): Promise<DropboxTokenExchangeResult> {
  if (!code.trim()) {
    throw new DropboxIntegrationError({
      code: "TOKEN_EXCHANGE_FAILED",
      message: "Authorization code is missing.",
    });
  }

  try {
    const body = new URLSearchParams({
      code: code.trim(),
      grant_type: "authorization_code",
      client_id: env.appKey,
      client_secret: env.appSecret,
      redirect_uri: env.redirectUri,
    });

    const json = await postTokenForm(body, fetchImpl);

    if (!json.access_token || !json.refresh_token || !json.account_id) {
      throw new DropboxIntegrationError({
        code: "TOKEN_EXCHANGE_FAILED",
        message:
          "Dropbox token response was incomplete. Ensure token_access_type=offline was used.",
      });
    }

    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresIn: typeof json.expires_in === "number" ? json.expires_in : 14400,
      accountId: json.account_id,
      scope: json.scope,
      uid: json.uid,
    };
  } catch (error) {
    if (error instanceof MissingDropboxEnvError) {
      throw new DropboxIntegrationError({
        code: "MISSING_DROPBOX_ENV",
        message: error.message,
      });
    }
    throw mapDropboxApiError(error, "oauth");
  }
}

export async function refreshAccessToken(
  refreshToken: string,
  env: DropboxEnv = validateDropboxEnv(),
  fetchImpl: FetchLike = fetch,
): Promise<DropboxAccessTokenResult> {
  if (!refreshToken.trim()) {
    throw new DropboxIntegrationError({
      code: "MISSING_REFRESH_TOKEN",
      message:
        "No Dropbox refresh token is stored. Connect Dropbox from Archive Setup.",
    });
  }

  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken.trim(),
      client_id: env.appKey,
      client_secret: env.appSecret,
    });

    const json = await postTokenForm(body, fetchImpl);

    if (!json.access_token) {
      throw new DropboxIntegrationError({
        code: "TOKEN_REFRESH_FAILED",
        message: "Dropbox refresh response did not include an access token.",
      });
    }

    return {
      accessToken: json.access_token,
      expiresIn: typeof json.expires_in === "number" ? json.expires_in : 14400,
      tokenType: json.token_type ?? "bearer",
    };
  } catch (error) {
    if (error instanceof DropboxIntegrationError) {
      throw error;
    }
    if (error instanceof MissingDropboxEnvError) {
      throw new DropboxIntegrationError({
        code: "MISSING_DROPBOX_ENV",
        message: error.message,
      });
    }
    throw mapDropboxApiError(error, "refresh");
  }
}
