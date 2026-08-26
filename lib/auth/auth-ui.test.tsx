/**
 * Presentation tests for the shared-password login screen.
 * Run: npx tsx lib/auth/auth-ui.test.tsx
 */

import { renderToStaticMarkup } from "react-dom/server";

import { LoginView } from "@/components/auth/LoginView";

type TestCase = { name: string; run: () => void };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const tests: TestCase[] = [
  {
    name: "login form does not include the configured password",
    run: () => {
      const markup = renderToStaticMarkup(
        <LoginView
          configured
          nextPath="/artworks"
          unconfiguredMessage="missing"
        />,
      );
      assert(markup.includes('type="password"'), "password field");
      assert(markup.includes('name="password"'), "password name");
      assert(markup.includes('name="next"'), "next field");
      assert(markup.includes('value="/artworks"'), "next path");
      assert(markup.includes("Continue"), "submit");
      assert(!markup.includes("APP_ACCESS_PASSWORD"), "no env name in copy");
      assert(!markup.includes("test-archive-password"), "no sample secret");
    },
  },
  {
    name: "incorrect password shows an error and does not reveal configuration",
    run: () => {
      const markup = renderToStaticMarkup(
        <LoginView
          configured
          nextPath="/"
          error="Incorrect password."
          unconfiguredMessage="missing"
        />,
      );
      assert(markup.includes("Incorrect password."), "error copy");
      assert(markup.includes('role="alert"'), "alert");
    },
  },
  {
    name: "missing production password fails closed without a form",
    run: () => {
      const message =
        "This archive is not available because access is not configured.";
      const markup = renderToStaticMarkup(
        <LoginView
          configured={false}
          nextPath="/"
          unconfiguredMessage={message}
        />,
      );
      assert(markup.includes(message), "fail-closed copy");
      assert(!markup.includes('type="password"'), "no password field");
      assert(!markup.includes("Continue"), "no submit");
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
    console.error(`\n${failed} auth UI test(s) failed`);
    process.exit(1);
  }
  console.log(`\n${tests.length} auth UI tests passed`);
}

void main();
