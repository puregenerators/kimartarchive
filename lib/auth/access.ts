import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

import {
  APP_ACCESS_COOKIE_NAME,
  appAccessCookieOptions,
  evaluateAppAccess,
  type AppAccessFailureCode,
  type AppAccessState,
} from "@/lib/auth/session";

export const APP_ACCESS_UNAUTHORIZED_MESSAGE = "Authentication required.";

export async function readAppAccessCookieValue(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(APP_ACCESS_COOKIE_NAME)?.value;
}

export async function getAppAccessState(): Promise<AppAccessState> {
  return evaluateAppAccess(await readAppAccessCookieValue(), process.env);
}

export async function requireAuthenticatedPage(): Promise<void> {
  const state = await getAppAccessState();
  if (state.ok) return;
  redirect("/login");
}

export type ActionAccessResult =
  | { ok: true }
  | { ok: false; code: AppAccessFailureCode; message: string };

export async function requireAuthenticatedAction(): Promise<ActionAccessResult> {
  const state = await getAppAccessState();
  if (state.ok) return { ok: true };
  return {
    ok: false,
    code: state.code,
    message:
      state.code === "UNAUTHORIZED"
        ? APP_ACCESS_UNAUTHORIZED_MESSAGE
        : state.message,
  };
}

export async function unauthorizedApiResponse(): Promise<NextResponse | null> {
  const state = await getAppAccessState();
  if (state.ok) return null;
  const status = state.code === "AUTH_NOT_CONFIGURED" ? 503 : 401;
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: state.code,
        message:
          state.code === "UNAUTHORIZED"
            ? APP_ACCESS_UNAUTHORIZED_MESSAGE
            : state.message,
      },
    },
    { status },
  );
}

export async function unauthorizedBrowserRedirect(
  request: Request,
): Promise<NextResponse | null> {
  const state = await getAppAccessState();
  if (state.ok) return null;
  return NextResponse.redirect(new URL("/login", request.url));
}

export async function setAppAccessCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(APP_ACCESS_COOKIE_NAME, token, appAccessCookieOptions());
}

export async function clearAppAccessCookie(): Promise<void> {
  const store = await cookies();
  store.set(APP_ACCESS_COOKIE_NAME, "", {
    ...appAccessCookieOptions(),
    maxAge: 0,
  });
}
