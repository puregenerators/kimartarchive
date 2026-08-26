/**
 * Shared application-password session (HMAC cookie). Isolated so it can
 * later be replaced with a real user-account system.
 *
 * Never import this from Client Components. Never put the password in
 * NEXT_PUBLIC_* or return it to the browser.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const APP_ACCESS_COOKIE_NAME = "kim_archive_access";
export const APP_ACCESS_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const SESSION_VERSION = "v1";
const HMAC_KEY_INFO = "kimartarchive.access.v1";
const CLOCK_SKEW_MS = 5 * 60 * 1000;

export type AppAccessFailureCode = "AUTH_NOT_CONFIGURED" | "UNAUTHORIZED";

export type AppAccessState =
  | { ok: true }
  | { ok: false; code: AppAccessFailureCode; message: string };

export type AppAccessEnv = {
  APP_ACCESS_PASSWORD?: string;
  NODE_ENV?: string;
};

export function readAppAccessPassword(
  env: AppAccessEnv = process.env,
): string | null {
  const raw = env.APP_ACCESS_PASSWORD;
  if (typeof raw !== "string") return null;
  const password = raw.trim();
  return password.length > 0 ? password : null;
}

export function isProductionNodeEnv(
  env: AppAccessEnv = process.env,
): boolean {
  return env.NODE_ENV === "production";
}

export function authNotConfiguredMessage(
  env: AppAccessEnv = process.env,
): string {
  return isProductionNodeEnv(env)
    ? "This archive is not available because access is not configured."
    : "Access is not configured. Set the shared app password in .env.local.";
}

export function secretsEqual(left: string, right: string): boolean {
  const leftBuf = Buffer.from(left, "utf8");
  const rightBuf = Buffer.from(right, "utf8");
  const max = Math.max(leftBuf.length, rightBuf.length, 1);
  const paddedLeft = Buffer.alloc(max);
  const paddedRight = Buffer.alloc(max);
  leftBuf.copy(paddedLeft);
  rightBuf.copy(paddedRight);
  const contentsEqual = timingSafeEqual(paddedLeft, paddedRight);
  return contentsEqual && leftBuf.length === rightBuf.length;
}

export function createSessionToken(
  password: string,
  nowMs: number = Date.now(),
): string {
  const issuedAt = String(nowMs);
  const mac = signSessionPayload(password, issuedAt);
  return `${SESSION_VERSION}.${issuedAt}.${mac}`;
}

export function verifySessionToken(
  token: string,
  password: string,
  nowMs: number = Date.now(),
): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [version, issuedAt, mac] = parts;
  if (version !== SESSION_VERSION) return false;
  if (!issuedAt || !/^\d+$/.test(issuedAt)) return false;
  if (!mac || !/^[0-9a-f]+$/i.test(mac)) return false;

  const issuedAtMs = Number(issuedAt);
  if (!Number.isFinite(issuedAtMs)) return false;
  if (issuedAtMs > nowMs + CLOCK_SKEW_MS) return false;
  if (nowMs - issuedAtMs > APP_ACCESS_COOKIE_MAX_AGE_SECONDS * 1000) {
    return false;
  }

  const expected = signSessionPayload(password, issuedAt);
  return secretsEqual(mac.toLowerCase(), expected);
}

export function evaluateAppAccess(
  cookieValue: string | undefined,
  env: AppAccessEnv = process.env,
  nowMs: number = Date.now(),
): AppAccessState {
  const password = readAppAccessPassword(env);
  if (!password) {
    return {
      ok: false,
      code: "AUTH_NOT_CONFIGURED",
      message: authNotConfiguredMessage(env),
    };
  }
  if (!cookieValue || !verifySessionToken(cookieValue, password, nowMs)) {
    return {
      ok: false,
      code: "UNAUTHORIZED",
      message: "Authentication required.",
    };
  }
  return { ok: true };
}

export function isPublicAppPath(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/login/");
}

export function safeInternalPath(raw: unknown): string {
  if (typeof raw !== "string") return "/";
  const value = raw.trim();
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (value.includes("://") || value.includes("\\") || /\s/.test(value)) {
    return "/";
  }
  if (value === "/login" || value.startsWith("/login?")) return "/";
  if (value.startsWith("/login/")) return "/";
  return value;
}

export function appAccessCookieOptions(
  env: AppAccessEnv = process.env,
): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: isProductionNodeEnv(env),
    sameSite: "lax",
    path: "/",
    maxAge: APP_ACCESS_COOKIE_MAX_AGE_SECONDS,
  };
}

function signSessionPayload(password: string, issuedAt: string): string {
  const key = createHmac("sha256", HMAC_KEY_INFO).update(password).digest();
  return createHmac("sha256", key)
    .update(`${SESSION_VERSION}.${issuedAt}`)
    .digest("hex");
}
