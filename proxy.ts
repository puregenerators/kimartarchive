import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  APP_ACCESS_COOKIE_NAME,
  evaluateAppAccess,
  isPublicAppPath,
  safeInternalPath,
} from "@/lib/auth/session";

/**
 * Page-level gate. API routes and Server Actions verify the session
 * independently so large multipart uploads are not buffered here.
 *
 * Matcher excludes `/api/*` on purpose: Next.js Proxy clones request
 * bodies (default 10 MB), which would truncate artwork masters.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublicAppPath(pathname)) {
    return NextResponse.next();
  }

  const cookieValue = request.cookies.get(APP_ACCESS_COOKIE_NAME)?.value;
  const state = evaluateAppAccess(cookieValue, process.env);
  if (state.ok) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  const nextPath = safeInternalPath(
    `${pathname}${request.nextUrl.search}`,
  );
  if (nextPath !== "/") {
    loginUrl.searchParams.set("next", nextPath);
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
