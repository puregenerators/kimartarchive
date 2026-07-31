import {
  MalformedPrivateKeyError,
  MissingGoogleEnvError,
  getGoogleEnvPresence,
  listMissingGoogleEnvKeys,
  listMissingRequiredGoogleEnvKeys,
  normalizePrivateKey,
  validateGoogleDriveStorageEnv,
  validateGoogleSheetsEnv,
} from "./env";
import {
  ARTWORK_INVENTORY_HEADERS,
  compareHeaders,
  isBlankHeaderRow,
} from "./headers";
import {
  buildChildFolderQuery,
  escapeDriveQueryValue,
} from "./drive-query";
import {
  buildOverallStatus,
  decideFailedIntakeCreation,
  decideHeaderInitialization,
  formatPermissionLevel,
  isSectionComplete,
  mapCapabilitiesToPermissionLevel,
} from "./setup-logic";
import {
  GoogleIntegrationError,
  googleReasonFromUnknown,
  mapGoogleApiError,
} from "./errors";

type TestCase = { name: string; run: () => void };

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(
      `${message}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`,
    );
  }
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${message}\n  expected: ${e}\n  actual:   ${a}`);
  }
}

function assertThrows(fn: () => void, nameIncludes: string, message: string) {
  try {
    fn();
  } catch (error) {
    if (error instanceof Error && error.message.includes(nameIncludes)) {
      return;
    }
    throw new Error(
      `${message}\n  unexpected error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  throw new Error(`${message}\n  expected throw containing: ${nameIncludes}`);
}

const tests: TestCase[] = [
  {
    name: "normalizePrivateKey converts literal \\n sequences",
    run: () => {
      const raw =
        "-----BEGIN PRIVATE KEY-----\\nABC\\nDEF\\n-----END PRIVATE KEY-----\\n";
      const normalized = normalizePrivateKey(raw);
      assertEqual(
        normalized.includes("\nABC\n"),
        true,
        "contains real newlines",
      );
      assertEqual(normalized.includes("\\n"), false, "no literal backslash-n");
    },
  },
  {
    name: "normalizePrivateKey strips surrounding quotes",
    run: () => {
      const normalized = normalizePrivateKey(
        '"-----BEGIN PRIVATE KEY-----\\nX\\n-----END PRIVATE KEY-----"',
      );
      assertEqual(normalized.startsWith("-----BEGIN"), true, "starts with BEGIN");
      assertEqual(normalized.includes("\nX\n"), true, "newline around X");
    },
  },
  {
    name: "env presence and missing keys",
    run: () => {
      const presence = getGoogleEnvPresence({
        GOOGLE_SERVICE_ACCOUNT_EMAIL: "a@b.com",
        GOOGLE_PRIVATE_KEY: "",
        GOOGLE_SHEET_ID: "sheet",
      });
      assertDeepEqual(
        presence,
        {
          GOOGLE_SERVICE_ACCOUNT_EMAIL: true,
          GOOGLE_PRIVATE_KEY: false,
          GOOGLE_SHEET_ID: true,
          GOOGLE_DRIVE_ROOT_FOLDER_ID: false,
        },
        "presence map",
      );
      assertDeepEqual(
        listMissingGoogleEnvKeys(presence),
        ["GOOGLE_PRIVATE_KEY", "GOOGLE_DRIVE_ROOT_FOLDER_ID"],
        "all known missing keys",
      );
      assertDeepEqual(
        listMissingRequiredGoogleEnvKeys(presence, "dropbox"),
        ["GOOGLE_PRIVATE_KEY"],
        "dropbox required missing keys omit Drive root",
      );
      assertDeepEqual(
        listMissingRequiredGoogleEnvKeys(presence, "drive"),
        ["GOOGLE_PRIVATE_KEY", "GOOGLE_DRIVE_ROOT_FOLDER_ID"],
        "drive required missing keys include Drive root",
      );
    },
  },
  {
    name: "validateGoogleSheetsEnv throws clear missing-variable error",
    run: () => {
      try {
        validateGoogleSheetsEnv({});
        throw new Error("should have thrown");
      } catch (error) {
        assertEqual(error instanceof MissingGoogleEnvError, true, "type");
        const missing = (error as MissingGoogleEnvError).missing;
        assertEqual(missing.length, 3, "three sheets keys missing");
        assertEqual(
          missing.includes("GOOGLE_DRIVE_ROOT_FOLDER_ID"),
          false,
          "Drive root not required for Sheets",
        );
      }
    },
  },
  {
    name: "validateGoogleSheetsEnv passes without Drive root",
    run: () => {
      const env = validateGoogleSheetsEnv({
        GOOGLE_SERVICE_ACCOUNT_EMAIL: " svc@project.iam.gserviceaccount.com ",
        GOOGLE_PRIVATE_KEY:
          "-----BEGIN PRIVATE KEY-----\\nLINE\\n-----END PRIVATE KEY-----\\n",
        GOOGLE_SHEET_ID: " sheet123 ",
      });
      assertEqual(
        env.serviceAccountEmail,
        "svc@project.iam.gserviceaccount.com",
        "email trimmed",
      );
      assertEqual(env.privateKey.includes("\nLINE\n"), true, "key newlines");
      assertEqual(env.sheetId, "sheet123", "sheet id");
      assertEqual(
        "driveRootFolderId" in env,
        false,
        "no Drive root on Sheets env",
      );
    },
  },
  {
    name: "validateGoogleDriveStorageEnv fails without Drive root",
    run: () => {
      try {
        validateGoogleDriveStorageEnv({
          GOOGLE_SERVICE_ACCOUNT_EMAIL: "a@b.com",
          GOOGLE_PRIVATE_KEY:
            "-----BEGIN PRIVATE KEY-----\\nX\\n-----END PRIVATE KEY-----\\n",
          GOOGLE_SHEET_ID: "sheet",
        });
        throw new Error("should have thrown");
      } catch (error) {
        assertEqual(error instanceof MissingGoogleEnvError, true, "type");
        const missing = (error as MissingGoogleEnvError).missing;
        assertDeepEqual(
          missing,
          ["GOOGLE_DRIVE_ROOT_FOLDER_ID"],
          "only Drive root missing",
        );
      }
    },
  },
  {
    name: "validateGoogleDriveStorageEnv passes with Drive root",
    run: () => {
      const env = validateGoogleDriveStorageEnv({
        GOOGLE_DRIVE_ROOT_FOLDER_ID: " folder123 ",
      });
      assertEqual(env.driveRootFolderId, "folder123", "folder id");
    },
  },
  {
    name: "validateGoogleSheetsEnv rejects malformed private key",
    run: () => {
      assertThrows(
        () =>
          validateGoogleSheetsEnv({
            GOOGLE_SERVICE_ACCOUNT_EMAIL: "a@b.com",
            GOOGLE_PRIVATE_KEY: "not-a-key",
            GOOGLE_SHEET_ID: "sheet",
          }),
        "PEM private key",
        "malformed key",
      );
      try {
        validateGoogleSheetsEnv({
          GOOGLE_SERVICE_ACCOUNT_EMAIL: "a@b.com",
          GOOGLE_PRIVATE_KEY: "not-a-key",
          GOOGLE_SHEET_ID: "sheet",
        });
      } catch (error) {
        assertEqual(error instanceof MalformedPrivateKeyError, true, "type");
      }
    },
  },
  {
    name: "validateGoogleSheetsEnv accepts normalized PEM",
    run: () => {
      const env = validateGoogleSheetsEnv({
        GOOGLE_SERVICE_ACCOUNT_EMAIL: " svc@project.iam.gserviceaccount.com ",
        GOOGLE_PRIVATE_KEY:
          "-----BEGIN PRIVATE KEY-----\\nLINE\\n-----END PRIVATE KEY-----\\n",
        GOOGLE_SHEET_ID: " sheet123 ",
      });
      assertEqual(
        env.serviceAccountEmail,
        "svc@project.iam.gserviceaccount.com",
        "email trimmed",
      );
      assertEqual(env.privateKey.includes("\nLINE\n"), true, "key newlines");
      assertEqual(env.sheetId, "sheet123", "sheet id");
    },
  },
  {
    name: "header comparison blank / match / mismatch",
    run: () => {
      assertEqual(isBlankHeaderRow([]), true, "empty blank");
      assertEqual(isBlankHeaderRow(["", "  "]), true, "whitespace blank");

      const blank = compareHeaders([], ARTWORK_INVENTORY_HEADERS);
      assertEqual(blank.kind, "blank", "blank kind");

      const match = compareHeaders(
        [...ARTWORK_INVENTORY_HEADERS],
        ARTWORK_INVENTORY_HEADERS,
      );
      assertEqual(match.kind, "match", "match kind");

      const missing = compareHeaders(
        ["Inventory ID", "Title"],
        ARTWORK_INVENTORY_HEADERS,
      );
      assertEqual(missing.kind, "mismatch", "missing kind");
      assertEqual(missing.missingHeaders.includes("Year"), true, "Year missing");

      const unexpected = compareHeaders(
        [...ARTWORK_INVENTORY_HEADERS, "Extra"],
        ARTWORK_INVENTORY_HEADERS,
      );
      assertEqual(unexpected.unexpectedHeaders.includes("Extra"), true, "extra");

      const reordered = compareHeaders(
        [
          ARTWORK_INVENTORY_HEADERS[1],
          ARTWORK_INVENTORY_HEADERS[0],
          ...ARTWORK_INVENTORY_HEADERS.slice(2),
        ],
        ARTWORK_INVENTORY_HEADERS,
      );
      assertEqual(reordered.kind, "mismatch", "reorder mismatch");
      assertEqual(reordered.orderMismatch, true, "order flag");
    },
  },
  {
    name: "Drive query escaping and child folder query",
    run: () => {
      assertEqual(escapeDriveQueryValue("O'Brien"), "O\\'Brien", "quote");
      assertEqual(escapeDriveQueryValue("a\\b"), "a\\\\b", "backslash");
      const q = buildChildFolderQuery("parent'id", "Failed Intake");
      assertEqual(q.includes("'parent\\'id' in parents"), true, "parent escaped");
      assertEqual(q.includes("name = 'Failed Intake'"), true, "name clause");
      assertEqual(q.includes("trashed = false"), true, "not trashed");
    },
  },
  {
    name: "idempotent header init decisions",
    run: () => {
      assertDeepEqual(
        decideHeaderInitialization({ kind: "missing_tab" }),
        {
          action: "refuse",
          reason: "tab_missing",
          detail:
            "The sheet tab does not exist. Create it manually in Google Sheets, then retry.",
        },
        "missing tab",
      );
      assertDeepEqual(
        decideHeaderInitialization(
          compareHeaders([], ARTWORK_INVENTORY_HEADERS),
        ),
        { action: "write_headers", reason: "blank_header_row" },
        "blank write",
      );
      assertDeepEqual(
        decideHeaderInitialization(
          compareHeaders([...ARTWORK_INVENTORY_HEADERS], ARTWORK_INVENTORY_HEADERS),
        ),
        { action: "noop", reason: "headers_already_match" },
        "match noop",
      );
      const refused = decideHeaderInitialization(
        compareHeaders(["Wrong"], ARTWORK_INVENTORY_HEADERS),
      );
      assertEqual(refused.action, "refuse", "mismatch refuse");
    },
  },
  {
    name: "idempotent Failed Intake decisions",
    run: () => {
      assertDeepEqual(
        decideFailedIntakeCreation(true),
        { action: "noop", reason: "already_exists" },
        "exists",
      );
      assertDeepEqual(
        decideFailedIntakeCreation(false),
        { action: "create", reason: "missing" },
        "missing",
      );
    },
  },
  {
    name: "map Drive capabilities to permission levels",
    run: () => {
      assertEqual(
        mapCapabilitiesToPermissionLevel({ canEdit: true }),
        "editor",
        "editor",
      );
      assertEqual(
        mapCapabilitiesToPermissionLevel({ canEdit: false }),
        "viewer",
        "viewer",
      );
      assertEqual(
        mapCapabilitiesToPermissionLevel({ canEdit: null }),
        "unknown",
        "null unknown",
      );
      assertEqual(
        mapCapabilitiesToPermissionLevel({}),
        "unknown",
        "missing unknown",
      );
      assertEqual(formatPermissionLevel("editor"), "Editor", "editor label");
      assertEqual(
        formatPermissionLevel("viewer"),
        "Viewer / Read-only",
        "viewer label",
      );
      assertEqual(formatPermissionLevel("unknown"), "Unknown", "unknown label");
      assertEqual(isSectionComplete(true, "editor"), true, "complete");
      assertEqual(isSectionComplete(true, "viewer"), false, "viewer incomplete");
      assertEqual(isSectionComplete(false, "editor"), false, "disconnected");
    },
  },
  {
    name: "overall status requires Editor on both resources",
    run: () => {
      assertDeepEqual(
        buildOverallStatus({
          configReady: false,
          sheetsConnected: false,
          sheetsPermission: null,
          driveConnected: false,
          drivePermission: null,
        }),
        {
          ready: false,
          label: "Configuration Incomplete",
          explanation:
            "Required environment variables are missing. See docs/GOOGLE_SETUP.md.",
        },
        "missing env",
      );

      assertDeepEqual(
        buildOverallStatus({
          configReady: true,
          sheetsConnected: true,
          sheetsPermission: "editor",
          driveConnected: true,
          drivePermission: "editor",
        }),
        {
          ready: true,
          label: "Ready",
          explanation:
            "Environment variables are valid, and Sheets and Drive are reachable with Editor access.",
        },
        "ready",
      );

      const viewerSheets = buildOverallStatus({
        configReady: true,
        sheetsConnected: true,
        sheetsPermission: "viewer",
        driveConnected: true,
        drivePermission: "editor",
      });
      assertEqual(viewerSheets.ready, false, "viewer sheets not ready");
      assertEqual(
        viewerSheets.label,
        "Configuration Incomplete",
        "viewer sheets label",
      );
      assertEqual(
        viewerSheets.explanation.includes("Google Sheets requires Editor access"),
        true,
        "viewer sheets explanation",
      );

      const viewerDrive = buildOverallStatus({
        configReady: true,
        sheetsConnected: true,
        sheetsPermission: "editor",
        driveConnected: true,
        drivePermission: "unknown",
      });
      assertEqual(viewerDrive.ready, false, "unknown drive not ready");
      assertEqual(
        viewerDrive.explanation.includes("Google Drive requires Editor access"),
        true,
        "unknown drive explanation",
      );

      const disconnected = buildOverallStatus({
        configReady: true,
        sheetsConnected: false,
        sheetsPermission: null,
        driveConnected: false,
        drivePermission: null,
      });
      assertEqual(disconnected.ready, false, "disconnected not ready");
      assertEqual(
        disconnected.explanation.includes("Google Sheets is not connected"),
        true,
        "sheets disconnected text",
      );
      assertEqual(
        disconnected.explanation.includes("Google Drive is not connected"),
        true,
        "drive disconnected text",
      );

      const dropboxReady = buildOverallStatus({
        configReady: true,
        sheetsConnected: true,
        sheetsPermission: "editor",
        driveConnected: false,
        drivePermission: null,
        requireDrive: false,
      });
      assertEqual(dropboxReady.ready, true, "dropbox mode ready without Drive");
      assertEqual(
        dropboxReady.explanation.includes("Google Sheets is reachable"),
        true,
        "dropbox ready explanation",
      );
    },
  },
  {
    name: "Drive 403 storageQuotaExceeded is not reported as missing share",
    run: () => {
      const error = {
        code: 403,
        message: "Service Accounts do not have storage quota.",
        errors: [{ reason: "storageQuotaExceeded", message: "quota" }],
      };
      const mapped = mapGoogleApiError(error, "drive");
      assertEqual(mapped.code, "DRIVE_STORAGE_QUOTA", "code");
      assertEqual(mapped.httpStatus, 403, "status");
      assertEqual(mapped.googleReason, "storageQuotaExceeded", "reason");
      assertEqual(
        mapped.safeMessage.includes("storage quota"),
        true,
        "quota message",
      );
      assertEqual(
        mapped.safeMessage.includes("Share the folder"),
        false,
        "not share wording",
      );
    },
  },
  {
    name: "Drive 403 insufficientFilePermissions keeps permission message",
    run: () => {
      const error = {
        code: 403,
        message: "The user does not have sufficient permissions for this file.",
        errors: [{ reason: "insufficientFilePermissions" }],
      };
      const mapped = mapGoogleApiError(error, "drive");
      assertEqual(mapped.code, "DRIVE_ACCESS_DENIED", "code");
      assertEqual(
        mapped.safeMessage.includes("Share the folder"),
        true,
        "permission wording",
      );
    },
  },
  {
    name: "Drive 403 without known reason is a generic upload rejection",
    run: () => {
      const error = { code: 403, message: "Forbidden" };
      const mapped = mapGoogleApiError(error, "drive");
      assertEqual(mapped.code, "DRIVE_UPLOAD_REJECTED", "code");
      assertEqual(
        mapped.safeMessage,
        "Google Drive rejected the upload request.",
        "generic message",
      );
      assertEqual(
        mapped.safeMessage.includes("Share the folder"),
        false,
        "not share wording",
      );
    },
  },
  {
    name: "googleReasonFromUnknown reads nested gaxios error lists",
    run: () => {
      const reason = googleReasonFromUnknown({
        response: {
          status: 403,
          data: {
            error: {
              errors: [{ reason: "storageQuotaExceeded" }],
            },
          },
        },
      });
      assertEqual(reason, "storageQuotaExceeded", "nested reason");
      assertEqual(
        googleReasonFromUnknown(new GoogleIntegrationError({
          code: "UNKNOWN",
          message: "x",
        })),
        undefined,
        "no reason on integration error",
      );
    },
  },
];

let failed = 0;
for (const test of tests) {
  try {
    test.run();
    console.log(`ok  — ${test.name}`);
  } catch (error) {
    failed += 1;
    console.error(`fail — ${test.name}`);
    console.error(error instanceof Error ? error.message : error);
  }
}

if (failed > 0) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
}

console.log(`\nAll ${tests.length} Google unit tests passed.`);
