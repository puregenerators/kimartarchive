/**
 * One-time: remove Location column from live Artwork Inventory.
 *
 * Safety:
 * - Verifies headers match the 22-column schema with Location
 * - Aborts if Location contains any values
 * - Deletes the Location column (does not blank the header only)
 * - Does not touch Inventory Claims
 */
import { google } from "googleapis";
import { validateGoogleSheetsEnv } from "@/lib/google/env";
import {
  ARTWORK_INVENTORY_HEADERS,
  ARTWORK_INVENTORY_TAB,
} from "@/lib/google/headers";
import { planArtworkInventoryHeaderMigration } from "@/lib/google/inventory-header-migration";

async function main() {
  const env = validateGoogleSheetsEnv();
  const auth = new google.auth.JWT({
    email: env.serviceAccountEmail,
    key: env.privateKey,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive",
    ],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = env.sheetId;

  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(sheetId,title)",
  });
  const inventorySheet = meta.data.sheets?.find(
    (s) => s.properties?.title === ARTWORK_INVENTORY_TAB,
  );
  const tabId = inventorySheet?.properties?.sheetId;
  if (tabId == null) {
    throw new Error(`Tab “${ARTWORK_INVENTORY_TAB}” not found.`);
  }

  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${ARTWORK_INVENTORY_TAB}'!1:1`,
    majorDimension: "ROWS",
  });
  const headers = (headerRes.data.values?.[0] ?? []).map((c) =>
    String(c ?? ""),
  );

  const dataRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${ARTWORK_INVENTORY_TAB}'!A2:V`,
    majorDimension: "ROWS",
  });
  const dataRows =
    dataRes.data.values?.map((row) =>
      row.map((cell) => String(cell ?? "")),
    ) ?? [];

  const plan = planArtworkInventoryHeaderMigration({
    headerRow: headers,
    dataRows,
  });

  if (!plan.ok) {
    console.error("Migration refused:", plan.reason, plan.message);
    if (plan.valuesInRemovedColumns?.length) {
      console.error(
        "Values in removed columns:",
        JSON.stringify(plan.valuesInRemovedColumns, null, 2),
      );
    }
    if (plan.actualHeaders) {
      console.error("Actual headers:", plan.actualHeaders);
    }
    process.exit(1);
  }

  if (plan.alreadyMigrated) {
    console.log("Location already removed. No changes made.");
    console.log("Headers:", ARTWORK_INVENTORY_HEADERS.join(" | "));
    return;
  }

  console.log(
    "Deleting columns (0-based indices, descending):",
    plan.deleteColumnIndicesDescending,
  );
  console.log(
    "Non-empty data rows scanned:",
    dataRows.filter((r) => r.some((c) => c.trim())).length,
  );

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: plan.deleteColumnIndicesDescending.map((startIndex) => ({
        deleteDimension: {
          range: {
            sheetId: tabId,
            dimension: "COLUMNS",
            startIndex,
            endIndex: startIndex + 1,
          },
        },
      })),
    },
  });

  const afterRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${ARTWORK_INVENTORY_TAB}'!1:1`,
    majorDimension: "ROWS",
  });
  const after = (afterRes.data.values?.[0] ?? []).map((c) => String(c ?? ""));
  const match =
    after.length === ARTWORK_INVENTORY_HEADERS.length &&
    after.every((h, i) => h === ARTWORK_INVENTORY_HEADERS[i]);

  console.log("Post-migration headers:", after);
  console.log("Matches expected schema:", match);
  if (!match) {
    process.exit(1);
  }
  console.log("Migration complete. Inventory Claims untouched.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
