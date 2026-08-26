/**
 * Shared-password session and path-safety tests.
 * Run: npx tsx lib/auth/session.test.ts
 */

import {
  APP_ACCESS_COOKIE_MAX_AGE_SECONDS,
  appAccessCookieOptions,
  createSessionToken,
  evaluateAppAccess,
  isPublicAppPath,
  readAppAccessPassword,
  safeInternalPath,
  secretsEqual,
  verifySessionToken,
} from "@/lib/auth/session";

type TestCase = { name: string; run: () => void };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(
      `${message}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`,
    );
  }
}

const PASSWORD = "test-archive-password";
const OTHER = "other-archive-password";
const NOW = Date.UTC(2026, 7, 26, 18, 0, 0);

const tests: TestCase[] = [
  {
    name: "empty or whitespace APP_ACCESS_PASSWORD is treated as missing",
    run: () => {
      assertEqual(readAppAccessPassword({}), null, "unset");
      assertEqual(readAppAccessPassword({ APP_ACCESS_PASSWORD: "" }), null, "empty");
      assertEqual(
        readAppAccessPassword({ APP_ACCESS_PASSWORD: "   " }),
        null,
        "whitespace",
      );
    },
  },
  {
    name: "missing password fails closed in production and development",
    run: () => {
      const production = evaluateAppAccess(undefined, {
        NODE_ENV: "production",
      });
      assertEqual(production.ok, false, "production denied");
      if (!production.ok) {
        assertEqual(production.code, "AUTH_NOT_CONFIGURED", "production code");
      }

      const development = evaluateAppAccess(undefined, {
        NODE_ENV: "development",
        APP_ACCESS_PASSWORD: "",
      });
      assertEqual(development.ok, false, "development denied");
      if (!development.ok) {
        assertEqual(development.code, "AUTH_NOT_CONFIGURED", "development code");
      }
    },
  },
  {
    name: "valid session cookie is accepted",
    run: () => {
      const token = createSessionToken(PASSWORD, NOW);
      assert(
        verifySessionToken(token, PASSWORD, NOW),
        "token verifies with same password",
      );
      const state = evaluateAppAccess(
        token,
        { APP_ACCESS_PASSWORD: PASSWORD, NODE_ENV: "production" },
        NOW,
      );
      assertEqual(state.ok, true, "access granted");
    },
  },
  {
    name: "wrong password and tampered token are rejected",
    run: () => {
      const token = createSessionToken(PASSWORD, NOW);
      assertEqual(
        verifySessionToken(token, OTHER, NOW),
        false,
        "other password",
      );
      const tampered = `${token.slice(0, -2)}ab`;
      assertEqual(
        verifySessionToken(tampered, PASSWORD, NOW),
        false,
        "tampered mac",
      );
      assertEqual(secretsEqual(PASSWORD, OTHER), false, "passwords differ");
      assertEqual(secretsEqual(PASSWORD, PASSWORD), true, "passwords match");
    },
  },
  {
    name: "expired and future-dated tokens are rejected",
    run: () => {
      const expired = createSessionToken(
        PASSWORD,
        NOW - (APP_ACCESS_COOKIE_MAX_AGE_SECONDS + 10) * 1000,
      );
      assertEqual(
        verifySessionToken(expired, PASSWORD, NOW),
        false,
        "expired",
      );
      const future = createSessionToken(PASSWORD, NOW + 10 * 60 * 1000);
      assertEqual(
        verifySessionToken(future, PASSWORD, NOW),
        false,
        "future",
      );
    },
  },
  {
    name: "changing APP_ACCESS_PASSWORD invalidates existing sessions",
    run: () => {
      const token = createSessionToken(PASSWORD, NOW);
      const state = evaluateAppAccess(
        token,
        { APP_ACCESS_PASSWORD: OTHER, NODE_ENV: "production" },
        NOW,
      );
      assertEqual(state.ok, false, "denied after password change");
    },
  },
  {
    name: "only /login is a public app path",
    run: () => {
      assertEqual(isPublicAppPath("/login"), true, "login");
      assertEqual(isPublicAppPath("/login/"), true, "login slash");
      assertEqual(isPublicAppPath("/artworks"), false, "artworks");
      assertEqual(isPublicAppPath("/api/dev/process-artwork-image"), false, "dev api");
      assertEqual(isPublicAppPath("/api/artwork-batches/prepare"), false, "prepare");
      assertEqual(
        isPublicAppPath("/api/artwork-batches/upload-link"),
        false,
        "upload-link",
      );
      assertEqual(isPublicAppPath("/api/artwork-batches/process"), false, "process");
      assertEqual(isPublicAppPath("/"), false, "home");
    },
  },
  {
    name: "safeInternalPath rejects open redirects",
    run: () => {
      assertEqual(safeInternalPath("/artworks"), "/artworks", "relative");
      assertEqual(safeInternalPath("/artworks/1004"), "/artworks/1004", "detail");
      assertEqual(safeInternalPath("https://evil.example"), "/", "absolute");
      assertEqual(safeInternalPath("//evil.example"), "/", "protocol-relative");
      assertEqual(safeInternalPath("/\\evil.example"), "/", "backslash");
      assertEqual(safeInternalPath("/login"), "/", "login loop");
      assertEqual(safeInternalPath("/login?next=/"), "/", "login query");
      assertEqual(safeInternalPath("artworks"), "/", "missing slash");
    },
  },
  {
    name: "session cookie is httpOnly, sameSite lax, and secure in production",
    run: () => {
      const production = appAccessCookieOptions({ NODE_ENV: "production" });
      assertEqual(production.httpOnly, true, "httpOnly");
      assertEqual(production.sameSite, "lax", "sameSite");
      assertEqual(production.secure, true, "secure in production");
      assertEqual(production.path, "/", "path");
      const development = appAccessCookieOptions({ NODE_ENV: "development" });
      assertEqual(development.secure, false, "insecure on local http");
    },
  },
];

function main() {
  let failed = 0;
  for (const test of tests) {
    try {
      test.run();
      console.log(`ok - ${test.name}`);
    } catch (error) {
      failed += 1;
      console.error(`fail - ${test.name}`);
      console.error(error instanceof Error ? error.message : error);
    }
  }
  if (failed > 0) {
    console.error(`\n${failed} auth session test(s) failed`);
    process.exit(1);
  }
  console.log(`\n${tests.length} auth session tests passed`);
}

void main();
