/**
 * Presentation tests for the Archive setup page.
 * Static markup only — no browser, no new test framework.
 * Run: npx tsx lib/archive/setup-ui.test.tsx
 */

import { renderToStaticMarkup } from "react-dom/server";

import { ArchiveSetupView } from "@/app/setup/archive/ArchiveSetupView";
import {
  ARCHIVE_SETUP_COPY,
  ARCHIVE_SETUP_DESTINATIONS,
  buildArchiveSetupView,
} from "@/lib/archive/setup-presentation";
import type { DropboxDiagnostics } from "@/lib/dropbox/types";
import type {
  GoogleDiagnostics,
  SheetsDiagnostics,
  TabHeaderStatus,
} from "@/lib/google/diagnostic-types";
import {
  ARTWORK_INVENTORY_HEADERS,
  ARTWORK_INVENTORY_TAB,
  INVENTORY_CLAIMS_HEADERS,
  INVENTORY_CLAIMS_TAB,
} from "@/lib/google/headers";

type TestCase = { name: string; run: () => void };

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(
      `${message}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`,
    );
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function matchingTab(tab: TabHeaderStatus["tab"]): TabHeaderStatus {
  const expected =
    tab === ARTWORK_INVENTORY_TAB
      ? ARTWORK_INVENTORY_HEADERS
      : INVENTORY_CLAIMS_HEADERS;
  return {
    tab,
    exists: true,
    comparison: {
      kind: "match",
      expected: [...expected],
      actual: [...expected],
      missingHeaders: [],
      unexpectedHeaders: [],
      orderMismatch: false,
    },
    canInitializeHeaders: false,
    canInsertThumbnailColumn: false,
  };
}

function healthySheets(): SheetsDiagnostics {
  return {
    ok: true,
    complete: true,
    title: "Kim Artwork Inventory",
    spreadsheetIdPresent: true,
    permission: {
      level: "editor",
      label: "Editor",
      hasEditorAccess: true,
    },
    artworkInventory: matchingTab(ARTWORK_INVENTORY_TAB),
    inventoryClaims: matchingTab(INVENTORY_CLAIMS_TAB),
    artworkInventorySummary: {
      label: "Headers match",
      details: ["22 columns in expected order."],
    },
    inventoryClaimsSummary: {
      label: "Headers match",
      details: ["5 columns in expected order."],
    },
  };
}

function healthyGoogle(
  overrides: Partial<GoogleDiagnostics> = {},
): GoogleDiagnostics {
  return {
    checkedAt: "2026-08-26T12:00:00.000Z",
    overall: {
      ready: true,
      label: "Ready",
      explanation:
        "Environment variables are valid, and Google Sheets is reachable with Editor access.",
    },
    config: {
      presence: {
        GOOGLE_SERVICE_ACCOUNT_EMAIL: true,
        GOOGLE_PRIVATE_KEY: true,
        GOOGLE_SHEET_ID: true,
        GOOGLE_DRIVE_ROOT_FOLDER_ID: false,
      },
      missing: [],
      ready: true,
      storageKind: "dropbox",
      driveRootRequired: false,
    },
    archiveTarget: {
      target: "production",
      ready: true,
      message: "Submitting to the production archive.",
      testConfigPresent: false,
      productionConfigPresent: true,
    },
    sheets: healthySheets(),
    drive: {
      ok: false,
      complete: false,
      permission: null,
      childFolders: [],
      failedIntakePresent: false,
      failedIntakeFolderName: "Failed Intake",
    },
    expectedHeaders: {
      artworkInventory: ARTWORK_INVENTORY_HEADERS,
      inventoryClaims: INVENTORY_CLAIMS_HEADERS,
    },
    ...overrides,
  };
}

function healthyDropbox(
  overrides: Partial<DropboxDiagnostics> = {},
): DropboxDiagnostics {
  return {
    checkedAt: "2026-08-26T12:00:00.000Z",
    connected: true,
    env: {
      presence: {
        DROPBOX_APP_KEY: true,
        DROPBOX_APP_SECRET: true,
        DROPBOX_REDIRECT_URI: true,
      },
      missing: [],
      ready: true,
    },
    account: {
      accountId: "dbid:secret-account",
      displayName: "Kim Osgood",
      email: "kim@example.com",
    },
    archiveFolder: {
      displayPath: "Apps/Kim Art Archive/",
      accessible: true,
      message: "App Folder is accessible.",
    },
    steps: [
      {
        id: "refresh_token_exists",
        label: "Refresh token exists",
        ok: true,
        message: "Refresh token is stored.",
      },
      {
        id: "upload_temp_file",
        label: "Upload temporary file",
        ok: true,
        message: "Temporary file uploaded.",
      },
    ],
    overall: {
      ready: true,
      label: "Ready",
      explanation:
        "Dropbox is connected, tokens refresh, and App Folder write probes succeeded.",
    },
    ...overrides,
  };
}

const noop = () => {};

function renderSetup(
  google: GoogleDiagnostics,
  dropbox: DropboxDiagnostics,
) {
  return renderToStaticMarkup(
    <ArchiveSetupView
      google={google}
      dropbox={dropbox}
      pending={false}
      message={null}
      confirmDisconnect={false}
      uploadTestPending={false}
      uploadTestResult={null}
      onRefresh={noop}
      onDisconnectClick={noop}
      onConfirmDisconnect={noop}
      onCancelDisconnect={noop}
      onRunDiagnostics={noop}
      onRunUploadTest={noop}
    />,
  );
}

function mainMarkup(markup: string): string {
  const detailsIndex = markup.indexOf("<details");
  assert(detailsIndex >= 0, "technical details disclosure is present");
  return markup.slice(0, detailsIndex);
}

const tests: TestCase[] = [
  {
    name: "healthy diagnostics translate to everything working",
    run: () => {
      const view = buildArchiveSetupView(healthyGoogle(), healthyDropbox());
      assertEqual(view.overall.ok, true, "overall ok");
      assertEqual(view.overall.label, ARCHIVE_SETUP_COPY.working, "overall label");
      assertEqual(
        view.overall.explanation,
        ARCHIVE_SETUP_COPY.workingExplanation,
        "overall copy",
      );
      assertEqual(
        view.database.label,
        ARCHIVE_SETUP_COPY.connected,
        "database connected",
      );
      assertEqual(
        view.database.detail,
        "Kim Artwork Inventory",
        "spreadsheet title",
      );
      assertEqual(
        view.files.label,
        ARCHIVE_SETUP_COPY.connected,
        "files connected",
      );
      assertEqual(
        view.files.detail,
        ARCHIVE_SETUP_COPY.filesProviderDropbox,
        "files provider",
      );
      assertEqual(
        view.files.savingTo,
        "Saving to: Kim Osgood Archive",
        "conversational folder",
      );
      assertEqual(view.connectionCheck.ok, true, "connection check ok");
      assertEqual(
        view.connectionCheck.label,
        ARCHIVE_SETUP_COPY.connectionPassed,
        "connection passed",
      );
      assertEqual(view.readyForIntake, true, "ready for intake");
    },
  },
  {
    name: "upload probe failure uses plain Dropbox language",
    run: () => {
      const view = buildArchiveSetupView(
        healthyGoogle(),
        healthyDropbox({
          overall: {
            ready: false,
            label: "Incomplete",
            explanation: "One or more Dropbox diagnostic steps failed.",
          },
          steps: [
            {
              id: "refresh_token_exists",
              label: "Refresh token exists",
              ok: true,
              message: "Refresh token is stored.",
            },
            {
              id: "upload_temp_file",
              label: "Upload temporary file",
              ok: false,
              message: "Could not upload diagnostic file.",
            },
          ],
        }),
      );
      assertEqual(view.overall.ok, false, "overall not ok");
      assertEqual(view.overall.label, ARCHIVE_SETUP_COPY.attention, "needs attention");
      assertEqual(view.connectionCheck.ok, false, "connection check failed");
      assertEqual(
        view.connectionCheck.label,
        ARCHIVE_SETUP_COPY.dropboxAttention,
        "dropbox label",
      );
      assert(
        view.connectionCheck.explanation.includes("test file"),
        "plain test-file language",
      );
      assert(
        !view.connectionCheck.explanation.includes("upload_temp_file"),
        "no step id",
      );
    },
  },
  {
    name: "healthy page shows the simple archive setup structure",
    run: () => {
      const markup = renderSetup(healthyGoogle(), healthyDropbox());
      const main = mainMarkup(markup);

      assert(main.includes(ARCHIVE_SETUP_COPY.statusTitle), "archive status");
      assert(main.includes(ARCHIVE_SETUP_COPY.working), "working label");
      assert(
        main.includes(ARCHIVE_SETUP_COPY.workingExplanation),
        "working explanation",
      );
      assert(main.includes(ARCHIVE_SETUP_COPY.refresh), "refresh status");
      assert(
        main.includes("Settings &amp; connections"),
        "settings heading",
      );
      assert(
        main.includes(ARCHIVE_SETUP_COPY.archiveSettingsTitle),
        "archive settings",
      );
      assert(
        main.includes(ARCHIVE_SETUP_COPY.archiveSettingsCta),
        "view settings",
      );
      assert(
        main.includes(ARCHIVE_SETUP_COPY.databaseSettingsTitle),
        "database settings card",
      );
      assert(
        main.includes(ARCHIVE_SETUP_COPY.databaseSettingsCta),
        "view database settings",
      );
      assert(main.includes(ARCHIVE_SETUP_COPY.databaseTitle), "database heading");
      assert(main.includes("Kim Artwork Inventory"), "spreadsheet title");
      assert(
        main.includes(ARCHIVE_SETUP_COPY.databaseHealthyExplanation),
        "database copy",
      );
      assert(main.includes(ARCHIVE_SETUP_COPY.filesTitle), "files heading");
      assert(main.includes(ARCHIVE_SETUP_COPY.filesProviderDropbox), "Dropbox");
      assert(
        main.includes("Saving to: Kim Osgood Archive"),
        "conversational folder",
      );
      assert(
        main.includes(ARCHIVE_SETUP_COPY.filesHealthyExplanation),
        "files copy",
      );
      assert(
        main.includes(ARCHIVE_SETUP_COPY.connectionCheckTitle),
        "connection check",
      );
      assert(
        main.includes(ARCHIVE_SETUP_COPY.connectionPassed),
        "everything passed",
      );
      assert(markup.includes(ARCHIVE_SETUP_COPY.continue), "continue to intake");
      assert(markup.includes(ARCHIVE_SETUP_COPY.technicalDetails), "details label");
      assert(
        !/<details[^>]*\sopen/.test(markup),
        "technical details start closed",
      );
    },
  },
  {
    name: "settings cards are fully clickable links to existing destinations",
    run: () => {
      const markup = renderSetup(healthyGoogle(), healthyDropbox());
      const main = mainMarkup(markup);

      assert(
        main.includes(`href="${ARCHIVE_SETUP_DESTINATIONS.archiveSettings}"`),
        "archive settings destination",
      );
      assert(
        main.includes(`href="${ARCHIVE_SETUP_DESTINATIONS.databaseSettings}"`),
        "database settings destination",
      );
      assert(
        ARCHIVE_SETUP_DESTINATIONS.databaseSettings === "/setup/google",
        "google sheet tools stay at /setup/google",
      );

      const settingsIndex = main.indexOf("Settings &amp; connections");
      const databaseStatusIndex = main.indexOf(
        `>${ARCHIVE_SETUP_COPY.databaseTitle}</h2>`,
      );
      assert(settingsIndex >= 0, "settings section present");
      const settingsBlock = main.slice(settingsIndex, databaseStatusIndex);
      assert(
        settingsBlock.includes("<a") &&
          settingsBlock.includes(`href="${ARCHIVE_SETUP_DESTINATIONS.archiveSettings}"`) &&
          settingsBlock.includes(`href="${ARCHIVE_SETUP_DESTINATIONS.databaseSettings}"`),
        "settings rows are links",
      );
      assert(
        !settingsBlock.includes("Overall Status"),
        "settings are not status labels",
      );
    },
  },
  {
    name: "healthy page hides implementation details from the normal UI",
    run: () => {
      const markup = renderSetup(healthyGoogle(), healthyDropbox());
      const main = mainMarkup(markup);

      for (const hidden of [
        "Overall Status",
        "Google Sheets",
        "READY",
        "PASS",
        "Present",
        "Missing",
        "Connected via API",
        "Production",
        "Permission",
        "Header validation",
        "Expected columns",
        "Inventory Claims",
        "dbid:secret-account",
        "Apps/Kim Art Archive/",
        "Refresh token exists",
        "Access token refresh",
        "Account lookup",
        "Create diagnostic folder",
        "Upload temporary file",
        "Delete temporary file",
        "Local image processing",
        "Run Diagnostics",
        "Run Dropbox Upload Test",
        "DROPBOX_APP_KEY",
        "GOOGLE_SHEET_ID",
      ]) {
        assert(!main.includes(hidden), `hidden from main UI: ${hidden}`);
      }

      assert(markup.includes("Refresh token exists"), "steps stay in details");
      assert(markup.includes("Upload temporary file"), "upload step in details");
      assert(markup.includes("Apps/Kim Art Archive/"), "raw path stays in details");
      assert(!markup.includes("dbid:secret-account"), "account id never shown");
    },
  },
  {
    name: "disconnected Dropbox shows connect without technical labels",
    run: () => {
      const markup = renderSetup(
        healthyGoogle(),
        healthyDropbox({
          connected: false,
          account: null,
          archiveFolder: {
            displayPath: "Apps/Kim Art Archive/",
            accessible: false,
            message: "Not connected.",
          },
          overall: {
            ready: false,
            label: "Not Connected",
            explanation: "Connect Dropbox to authorize this local archive.",
          },
          steps: [
            {
              id: "refresh_token_exists",
              label: "Refresh token exists",
              ok: false,
              message: "No refresh token on disk. Connect Dropbox.",
            },
          ],
        }),
      );
      const main = mainMarkup(markup);
      assert(main.includes(ARCHIVE_SETUP_COPY.attention), "needs attention");
      assert(main.includes(ARCHIVE_SETUP_COPY.connectDropbox), "connect action");
      assert(!main.includes("Not Connected"), "no technical not-connected label");
      assert(!main.includes("READY"), "no READY");
      assert(!main.includes("Local image processing"), "no local processing");
      assert(!main.includes(ARCHIVE_SETUP_COPY.continue), "intake hidden until ready");
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
    console.error(`\n${failed} failed`);
    process.exit(1);
  }
  console.log(`\n${tests.length} passed`);
}

main();
