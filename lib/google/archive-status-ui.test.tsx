/**
 * Presentation tests for the Archive status page.
 * Static markup only — no browser, no new test framework.
 * Run: npx tsx lib/google/archive-status-ui.test.tsx
 */

import { renderToStaticMarkup } from "react-dom/server";

import { ArchiveStatusView } from "@/app/setup/google/ArchiveStatusView";
import type { DropboxDiagnostics } from "@/lib/dropbox/types";
import type {
  GoogleDiagnostics,
  SheetsDiagnostics,
  TabHeaderStatus,
} from "@/lib/google/diagnostic-types";
import {
  ARCHIVE_STATUS_COPY,
  buildArchiveStatusView,
} from "@/lib/google/archive-status-presentation";
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

function blankInventoryTab(): TabHeaderStatus {
  return {
    tab: ARTWORK_INVENTORY_TAB,
    exists: true,
    comparison: {
      kind: "blank",
      expected: [...ARTWORK_INVENTORY_HEADERS],
      actual: [],
      missingHeaders: [...ARTWORK_INVENTORY_HEADERS],
      unexpectedHeaders: [],
      orderMismatch: false,
    },
    canInitializeHeaders: true,
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

function renderStatus(
  google: GoogleDiagnostics,
  dropbox: DropboxDiagnostics,
) {
  return renderToStaticMarkup(
    <ArchiveStatusView
      diagnostics={google}
      dropbox={dropbox}
      pending={false}
      message={null}
      confirmHeadersTab={null}
      confirmFailedIntake={false}
      confirmThumbnailColumn={false}
      onRefresh={noop}
      onPrepareHeaders={noop}
      onCancelHeaders={noop}
      onConfirmHeaders={noop}
      onPrepareThumbnail={noop}
      onCancelThumbnail={noop}
      onConfirmThumbnail={noop}
      onPrepareFailedIntake={noop}
      onCancelFailedIntake={noop}
      onConfirmFailedIntake={noop}
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
      const view = buildArchiveStatusView(healthyGoogle(), healthyDropbox());
      assertEqual(view.overall.ok, true, "overall ok");
      assertEqual(view.overall.label, ARCHIVE_STATUS_COPY.working, "overall label");
      assertEqual(
        view.database.label,
        ARCHIVE_STATUS_COPY.connected,
        "database connected",
      );
      assertEqual(
        view.files.label,
        ARCHIVE_STATUS_COPY.connected,
        "files connected",
      );
      assertEqual(
        view.files.detail,
        ARCHIVE_STATUS_COPY.filesProviderDropbox,
        "files provider",
      );
      assertEqual(
        view.target.label,
        ARCHIVE_STATUS_COPY.liveArchive,
        "live archive",
      );
      assertEqual(view.showHeaderTools, false, "no header tools");
      assertEqual(view.showThumbnailTool, false, "no thumbnail tool");
    },
  },
  {
    name: "test target uses test-archive language",
    run: () => {
      const view = buildArchiveStatusView(
        healthyGoogle({
          archiveTarget: {
            target: "test",
            ready: true,
            message: "Submitting to the TEST archive.",
            testConfigPresent: true,
            productionConfigPresent: true,
          },
        }),
        healthyDropbox(),
      );
      assertEqual(view.target.label, ARCHIVE_STATUS_COPY.testArchive, "label");
      assertEqual(
        view.target.explanation,
        ARCHIVE_STATUS_COPY.testArchiveExplanation,
        "explanation",
      );
    },
  },
  {
    name: "disconnected Dropbox needs attention without Drive wording",
    run: () => {
      const view = buildArchiveStatusView(
        healthyGoogle(),
        healthyDropbox({
          connected: false,
          account: null,
          overall: {
            ready: false,
            label: "Not Connected",
            explanation: "Connect Dropbox to authorize this local archive.",
          },
        }),
      );
      assertEqual(view.overall.ok, false, "overall not ok");
      assertEqual(view.overall.label, ARCHIVE_STATUS_COPY.attention, "overall");
      assertEqual(view.files.ok, false, "files not ok");
      assertEqual(
        view.files.explanation,
        ARCHIVE_STATUS_COPY.filesDropboxDisconnected,
        "files copy",
      );
    },
  },
  {
    name: "blank inventory headers need attention",
    run: () => {
      const sheets = healthySheets();
      sheets.artworkInventory = blankInventoryTab();
      sheets.artworkInventorySummary = {
        label: "Header row blank",
        details: ["Row 1 is empty. You can initialize the expected headers from this page."],
      };
      const view = buildArchiveStatusView(
        healthyGoogle({ sheets }),
        healthyDropbox(),
      );
      assertEqual(view.database.ok, false, "database not ok");
      assertEqual(
        view.database.explanation,
        ARCHIVE_STATUS_COPY.databaseBlankHeaders,
        "blank copy",
      );
      assertEqual(view.showHeaderTools, true, "header tools available");
    },
  },
  {
    name: "healthy page shows the simple archive status structure",
    run: () => {
      const markup = renderStatus(healthyGoogle(), healthyDropbox());
      const main = mainMarkup(markup);

      assert(main.includes(ARCHIVE_STATUS_COPY.working), "working label");
      assert(
        main.includes(ARCHIVE_STATUS_COPY.workingExplanation),
        "working explanation",
      );
      assert(main.includes(ARCHIVE_STATUS_COPY.databaseTitle), "database heading");
      assert(main.includes("Kim Artwork Inventory"), "spreadsheet title");
      assert(
        main.includes(ARCHIVE_STATUS_COPY.databaseHealthyExplanation),
        "database copy",
      );
      assert(main.includes(ARCHIVE_STATUS_COPY.filesTitle), "files heading");
      assert(main.includes(ARCHIVE_STATUS_COPY.filesProviderDropbox), "Dropbox");
      assert(
        main.includes(ARCHIVE_STATUS_COPY.filesHealthyExplanation),
        "files copy",
      );
      assert(main.includes(ARCHIVE_STATUS_COPY.targetTitle), "target heading");
      assert(main.includes(ARCHIVE_STATUS_COPY.liveArchive), "live archive");
      assert(
        main.includes(ARCHIVE_STATUS_COPY.liveArchiveExplanation),
        "live copy",
      );
      assert(main.includes(ARCHIVE_STATUS_COPY.refresh), "refresh status");
      assert(markup.includes(ARCHIVE_STATUS_COPY.technicalDetails), "details label");
      assert(
        !/<details[^>]*\sopen/.test(markup),
        "technical details start closed",
      );
    },
  },
  {
    name: "healthy page hides implementation details from the normal UI",
    run: () => {
      const markup = renderStatus(healthyGoogle(), healthyDropbox());
      const main = mainMarkup(markup);

      for (const hidden of [
        "GOOGLE_SERVICE_ACCOUNT_EMAIL",
        "GOOGLE_PRIVATE_KEY",
        "GOOGLE_SHEET_ID",
        "GOOGLE_DRIVE_ROOT_FOLDER_ID",
        "Google configuration",
        "Google Sheets",
        "Google Drive",
        "Initialize headers",
        "Unavailable",
        "Headers match",
        "Permission level",
        "ARTWORK_SUBMISSION_TARGET",
        "dbid:secret-account",
        "NOT CONNECTED",
        "PRODUCTION",
        "Overall Status",
        "Archive submission target",
      ]) {
        assert(!main.includes(hidden), `hidden from main UI: ${hidden}`);
      }

      assert(markup.includes("GOOGLE_SERVICE_ACCOUNT_EMAIL"), "env names stay in details");
      assert(markup.includes("Headers match"), "header diagnostics stay in details");
    },
  },
  {
    name: "Dropbox disconnected page does not show a Google Drive not-connected section",
    run: () => {
      const markup = renderStatus(
        healthyGoogle(),
        healthyDropbox({
          connected: false,
          account: null,
          overall: {
            ready: false,
            label: "Not Connected",
            explanation: "Connect Dropbox to authorize this local archive.",
          },
        }),
      );
      const main = mainMarkup(markup);
      assert(main.includes(ARCHIVE_STATUS_COPY.attention), "needs attention");
      assert(
        main.includes(ARCHIVE_STATUS_COPY.filesDropboxDisconnected),
        "dropbox copy",
      );
      assert(!main.includes("Google Drive"), "no Drive heading in main UI");
      assert(!main.includes("NOT CONNECTED"), "no Drive not-connected label");
      assert(main.includes("Archive setup"), "points to archive setup");
    },
  },
  {
    name: "header setup tools stay inside technical details",
    run: () => {
      const sheets = healthySheets();
      sheets.artworkInventory = blankInventoryTab();
      const markup = renderStatus(
        healthyGoogle({ sheets }),
        healthyDropbox(),
      );
      const main = mainMarkup(markup);
      assert(!main.includes("Initialize headers"), "tools not in main UI");
      assert(markup.includes("Initialize headers"), "tools remain in details");
      assert(markup.includes(ARTWORK_INVENTORY_TAB), "inventory tab in details");
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
