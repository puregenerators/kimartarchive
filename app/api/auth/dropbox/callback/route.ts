import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { persistOAuthConnection, getCurrentAccount } from "@/lib/dropbox/client";
import { validateDropboxEnv } from "@/lib/dropbox/env";
import { DropboxIntegrationError } from "@/lib/dropbox/errors";
import {
  DROPBOX_OAUTH_STATE_COOKIE,
  exchangeAuthorizationCode,
  validateOAuthState,
} from "@/lib/dropbox/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function setupRedirect(params: Record<string, string>): NextResponse {
  let base = "http://localhost:3000/setup/archive";
  try {
    if (process.env.DROPBOX_REDIRECT_URI) {
      const redirect = new URL(process.env.DROPBOX_REDIRECT_URI);
      base = `${redirect.protocol}//${redirect.host}/setup/archive`;
    }
  } catch {
    // keep default
  }
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const response = NextResponse.redirect(url);
  response.cookies.set(DROPBOX_OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}

/**
 * Dropbox OAuth callback.
 * Verifies CSRF state, exchanges code, stores refresh token server-side.
 * Never puts tokens in the redirect URL or logs them.
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const errorParam = requestUrl.searchParams.get("error");
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(DROPBOX_OAUTH_STATE_COOKIE)?.value;

  if (errorParam) {
    const description =
      requestUrl.searchParams.get("error_description") ?? "Authorization denied.";
    return setupRedirect({
      dropbox: "error",
      reason: "oauth_denied",
      message: description.slice(0, 120),
    });
  }

  const stateResult = validateOAuthState(expectedState, state);
  if (!stateResult.ok) {
    return setupRedirect({
      dropbox: "error",
      reason: "invalid_state",
      message: "OAuth state mismatch. Try Connect Dropbox again.",
    });
  }

  if (!code) {
    return setupRedirect({
      dropbox: "error",
      reason: "missing_code",
      message: "Authorization code missing from Dropbox redirect.",
    });
  }

  try {
    const env = validateDropboxEnv();
    const tokens = await exchangeAuthorizationCode(code, env);

    // Temporarily set cache via persist after we have account info.
    // Fetch account using the fresh access token directly (before disk write).
    const accountResponse = await fetch(
      "https://api.dropboxapi.com/2/users/get_current_account",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
      },
    );

    if (!accountResponse.ok) {
      throw new DropboxIntegrationError({
        code: "ACCOUNT_LOOKUP_FAILED",
        message: "Connected to Dropbox but could not load account profile.",
        httpStatus: accountResponse.status,
      });
    }

    const accountJson = (await accountResponse.json()) as {
      account_id: string;
      email: string;
      name: { display_name: string };
    };

    await persistOAuthConnection({
      refreshToken: tokens.refreshToken,
      accountId: accountJson.account_id || tokens.accountId,
      displayName: accountJson.name.display_name,
      email: accountJson.email,
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
    });

    // Sanity: confirm refresh path works without exposing tokens
    try {
      await getCurrentAccount();
    } catch {
      // Connection is still stored; UI diagnostics will surface issues.
    }

    return setupRedirect({
      dropbox: "connected",
      message: "Dropbox connected successfully.",
    });
  } catch (error) {
    const message =
      error instanceof DropboxIntegrationError
        ? error.safeMessage
        : "Dropbox authorization failed.";
    return setupRedirect({
      dropbox: "error",
      reason: "exchange_failed",
      message: message.slice(0, 160),
    });
  }
}
