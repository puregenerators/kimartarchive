/**
 * Insert the Thumbnail display column into live Artwork Inventory.
 *
 * Safety:
 * - Verifies headers match the 21-column schema before Thumbnail
 * - Inserts one column after Inventory ID
 * - Writes the Thumbnail header
 * - Does not backfill images for existing rows
 * - Does not touch Inventory Claims
 */
import { google } from "googleapis";
import { validateGoogleSheetsEnv } from "@/lib/google/env";
import {
  ARTWORK_INVENTORY_HEADERS,
  ARTWORK_INVENTORY_TAB,
} from "@/lib/google/headers";
import { planArtworkInventoryThumbnailColumnInsert } from "@/lib/google/inventory-header-migration";

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

  const plan = planArtworkInventoryThumbnailColumnInsert({ headerRow: headers });
  if (!plan.ok) {
    console.error("Migration refused:", plan.reason, plan.message);
    if (plan.actualHeaders) {
      console.error("Actual headers:", plan.actualHeaders);
    }
    process.exit(1);
  }

  if (plan.alreadyMigrated) {
    console.log("Thumbnail column already present. No changes made.");
    console.log("Headers:", ARTWORK_INVENTORY_HEADERS.join(" | "));
    return;
  }

  console.log(
    "Inserting Thumbnail column at 0-based index",
    plan.insertColumnIndex,
  );

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          insertDimension: {
            range: {
              sheetId: tabId,
              dimension: "COLUMNS",
              startIndex: plan.insertColumnIndex,
              endIndex: plan.insertColumnIndex + 1,
            },
            inheritFromBefore: false,
          },
        },
      ],
    },
  });

  const columnLetter = String.fromCharCode(65 + plan.insertColumnIndex);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${ARTWORK_INVENTORY_TAB}'!${columnLetter}1`,
    valueInputOption: "RAW",
    requestBody: { values: [["Thumbnail"]] },
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
  console.log(
    "Migration complete. Existing rows have a blank Thumbnail cell. Inventory Claims untouched.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
