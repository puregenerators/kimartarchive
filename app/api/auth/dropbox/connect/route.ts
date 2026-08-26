import { NextResponse } from "next/server";

import { unauthorizedBrowserRedirect } from "@/lib/auth/access";
import { validateDropboxEnv } from "@/lib/dropbox/env";
import { DropboxIntegrationError } from "@/lib/dropbox/errors";
import {
  DROPBOX_OAUTH_STATE_COOKIE,
  DROPBOX_OAUTH_STATE_MAX_AGE_SECONDS,
  buildAuthorizeUrl,
  generateOAuthState,
} from "@/lib/dropbox/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Start Dropbox OAuth (code flow, offline refresh token).
 * Stores CSRF state in an HttpOnly cookie — not credentials.
 */
export async function GET(request: Request) {
  const denied = await unauthorizedBrowserRedirect(request);
  if (denied) return denied;

  try {
    const env = validateDropboxEnv();
    const state = generateOAuthState();
    const authorizeUrl = buildAuthorizeUrl(env, state);

    const response = NextResponse.redirect(authorizeUrl);
    response.cookies.set(DROPBOX_OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: DROPBOX_OAUTH_STATE_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    const message =
      error instanceof DropboxIntegrationError
        ? error.safeMessage
        : error instanceof Error
          ? error.message
          : "Dropbox connect failed.";
    const url = new URL(
      "/setup/archive",
      process.env.DROPBOX_REDIRECT_URI ?? "http://localhost:3000/api/auth/dropbox/callback",
    );
    // Use origin from redirect URI when possible
    try {
      if (process.env.DROPBOX_REDIRECT_URI) {
        const redirect = new URL(process.env.DROPBOX_REDIRECT_URI);
        url.protocol = redirect.protocol;
        url.host = redirect.host;
        url.pathname = "/setup/archive";
      }
    } catch {
      url.href = "http://localhost:3000/setup/archive";
    }
    url.searchParams.set("dropbox", "error");
    url.searchParams.set("reason", "connect_failed");
    // Never put secrets in the URL; a short safe message is ok
    url.searchParams.set("message", message.slice(0, 120));
    return NextResponse.redirect(url);
  }
}
