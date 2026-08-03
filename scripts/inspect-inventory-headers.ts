/**
 * One-shot: inspect Artwork Inventory headers and Location column values.
 * Does not modify the Sheet.
 */
import { google } from "googleapis";
import { validateGoogleSheetsEnv } from "@/lib/google/env";
import { ARTWORK_INVENTORY_TAB } from "@/lib/google/headers";
import {
  ARTWORK_INVENTORY_HEADERS_WITH_LOCATION,
  LOCATION_COLUMN_INDEX,
  findValuesInLocationColumn,
} from "@/lib/google/inventory-header-migration";

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
    fields:
      "spreadsheetId,properties.title,sheets.properties(sheetId,title,gridProperties)",
  });

  console.log("Spreadsheet:", meta.data.properties?.title);
  console.log(
    "Tabs:",
    JSON.stringify(
      meta.data.sheets?.map((s) => ({
        title: s.properties?.title,
        sheetId: s.properties?.sheetId,
        cols: s.properties?.gridProperties?.columnCount,
        rows: s.properties?.gridProperties?.rowCount,
      })),
      null,
      2,
    ),
  );

  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${ARTWORK_INVENTORY_TAB}'!1:1`,
    majorDimension: "ROWS",
  });
  const headers = (headerRes.data.values?.[0] ?? []).map((c) =>
    String(c ?? ""),
  );
  console.log("\nHeader count:", headers.length);
  console.log("Headers:", JSON.stringify(headers, null, 2));
  const match =
    headers.length === ARTWORK_INVENTORY_HEADERS_WITH_LOCATION.length &&
    headers.every((h, i) => h === ARTWORK_INVENTORY_HEADERS_WITH_LOCATION[i]);
  console.log("Matches schema with Location (pre-migration):", match);
  console.log(
    `Location at index ${LOCATION_COLUMN_INDEX}:`,
    headers[LOCATION_COLUMN_INDEX],
  );

  const dataRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${ARTWORK_INVENTORY_TAB}'!A2:V`,
    majorDimension: "ROWS",
  });
  const rows = dataRes.data.values ?? [];
  console.log("\nData row count:", rows.length);
  const nonempty = rows.filter((r) =>
    r.some((c) => String(c ?? "").trim()),
  );
  console.log("Non-empty data rows:", nonempty.length);

  const locationVals = findValuesInLocationColumn(
    rows.map((r) => r.map((c) => String(c ?? ""))),
  );
  console.log("Location values:", JSON.stringify(locationVals, null, 2));

  const claimsHeader = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'Inventory Claims'!1:1",
    majorDimension: "ROWS",
  });
  console.log(
    "\nInventory Claims headers:",
    JSON.stringify(claimsHeader.data.values?.[0]),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
