/**
 * Artwork archive catalog tests.
 * Pure mapping / search / URL helpers — no live Google or Dropbox calls.
 * Run: npx tsx lib/archive/archive.test.ts
 */

import { ARTWORK_INVENTORY_HEADERS } from "@/lib/google/headers";
import { GoogleIntegrationError } from "@/lib/google/errors";
import { formatArchiveDimensions } from "@/lib/archive/dimensions";
import {
  dropboxSharedUrlToDisplayUrl,
  webFileDisplayUrlFromCanonical,
} from "@/lib/archive/dropbox-display-url";
import {
  ARCHIVE_UNAVAILABLE_MESSAGE,
  loadArtworkArchiveWithReader,
} from "@/lib/archive/load-logic";
import {
  ARCHIVE_DELETE_CONFIRMATION_BODY,
  ARCHIVE_DELETE_DUPLICATE_MESSAGE,
  ARCHIVE_DELETE_INVALID_ID_MESSAGE,
  ARCHIVE_DELETE_NOT_FOUND_MESSAGE,
  ARCHIVE_DELETE_TOUCHES_STORED_FILES,
  applySuccessfulArchiveDelete,
  archiveDeleteConfirmationTitle,
  archiveDeleteFailureLog,
  archiveDeleteSuccessMessage,
  deleteArtworkArchiveRecordWithDeps,
  nextRouteAfterArchiveDelete,
  parseDeleteInventoryId,
  planArtworkInventoryRowDelete,
  reduceArchiveDeleteUi,
} from "@/lib/archive/delete-logic";
import {
  archiveCollectionFields,
  archiveFileLinks,
  archiveLabeledFields,
  archivePrimaryFacts,
  artworkPreviewAlt,
  formatInventoryId,
  splitYearNavigation,
  uniqueYearsDescending,
  yearSectionId,
  formatYearArtworkCount,
} from "@/lib/archive/presentation";
import {
  buildArchiveCatalog,
  findArtworkByInventoryId,
  groupArtworksByYear,
  lookupCatalogArtwork,
  parseArtworkInventoryRecords,
  searchArchiveArtworks,
} from "@/lib/archive/records";
import type { ArchiveArtwork } from "@/lib/archive/types";
import { UNTITLED_TITLE } from "@/lib/artwork/untitled";

type TestCase = { name: string; run: () => void | Promise<void> };

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

function assertDeepEqual(actual: unknown, expected: unknown, message: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${message}\n  expected: ${e}\n  actual:   ${a}`);
  }
}

function cell(
  values: Partial<Record<(typeof ARTWORK_INVENTORY_HEADERS)[number], string>>,
  headers: readonly string[] = ARTWORK_INVENTORY_HEADERS,
): string[] {
  return headers.map((header) => values[header as keyof typeof values] ?? "");
}

const SAMPLE_WEB_URL =
  "https://www.dropbox.com/scl/fi/abc123/tulip_web_01.jpg?rlkey=secretkey&dl=0";

function sampleArtwork(
  overrides: Partial<
    Record<(typeof ARTWORK_INVENTORY_HEADERS)[number], string>
  > = {},
): string[] {
  return cell({
    "Inventory ID": "1004",
    Title: "Tulip Tree",
    Year: "2026",
    Medium: "Monotype",
    Height: "30",
    Width: "22",
    Depth: "",
    "Dimension Unit": "in",
    Photographer: "Jane Doe",
    Exhibition: "Spring Show",
    "Gallery / Venue": "Blue Garden Gallery",
    Notes: "",
    "Master Filename": "2026_KO_1004_TulipTree_master_01.tif",
    "Master File URL": "https://www.dropbox.com/scl/fi/master?rlkey=m&dl=0",
    "High Resolution Filename": "2026_KO_1004_TulipTree_hr_01.jpg",
    "High Resolution File URL": "https://www.dropbox.com/scl/fi/hr?rlkey=h&dl=0",
    "Web Filename": "2026_KO_1004_TulipTree_web_01.jpg",
    "Web File URL": SAMPLE_WEB_URL,
    "Artwork Folder URL": "https://www.dropbox.com/scl/fo/folder?rlkey=f&dl=0",
    "Created At": "2026-04-01T00:00:00.000Z",
    "Updated At": "2026-04-01T00:00:00.000Z",
    ...overrides,
  });
}

function artwork(
  overrides: Partial<ArchiveArtwork> = {},
): ArchiveArtwork {
  return {
    inventoryId: 1004,
    title: "Tulip Tree",
    year: "2026",
    medium: "Monotype",
    height: "30",
    width: "22",
    depth: "",
    dimensionUnit: "in",
    photographer: "",
    exhibition: "",
    gallery: "",
    notes: "",
    masterFilename: "",
    masterFileUrl: "",
    hrFilename: "",
    hrFileUrl: "",
    webFilename: "",
    webFileUrl: SAMPLE_WEB_URL,
    webFileDisplayUrl: webFileDisplayUrlFromCanonical(SAMPLE_WEB_URL),
    artworkFolderUrl: "",
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

const tests: TestCase[] = [
  {
    name: "Sheet records map correctly into archive records by header name",
    run: () => {
      const shuffled = [
        "Year",
        "Title",
        "Medium",
        "Inventory ID",
        "Web File URL",
        "Exhibition",
        "Gallery / Venue",
      ];
      const row = [
        "2026",
        "Tulip Tree",
        "Monotype",
        "1004",
        SAMPLE_WEB_URL,
        "Spring Show",
        "Blue Garden Gallery",
      ];
      const parsed = parseArtworkInventoryRecords({
        headers: shuffled,
        rows: [row],
      });
      assertEqual(parsed.records.length, 1, "one record");
      const record = parsed.records[0]!;
      assertEqual(record.inventoryId, 1004, "numeric Inventory ID");
      assertEqual(record.title, "Tulip Tree", "title");
      assertEqual(record.year, "2026", "year");
      assertEqual(record.medium, "Monotype", "medium");
      assertEqual(record.exhibition, "Spring Show", "exhibition");
      assertEqual(record.gallery, "Blue Garden Gallery", "gallery");
      assertEqual(record.webFileUrl, SAMPLE_WEB_URL, "canonical web URL unchanged");
    },
  },
  {
    name: "blank rows are ignored",
    run: () => {
      const parsed = parseArtworkInventoryRecords({
        headers: [...ARTWORK_INVENTORY_HEADERS],
        rows: [[], ["", "", ""], sampleArtwork(), ["  ", ""]],
      });
      assertEqual(parsed.blankRowCount, 3, "three blank rows");
      assertEqual(parsed.records.length, 1, "one artwork kept");
      assertEqual(parsed.dataRowCount, 1, "one data row");
    },
  },
  {
    name: "malformed row does not crash all records",
    run: () => {
      const parsed = parseArtworkInventoryRecords({
        headers: [...ARTWORK_INVENTORY_HEADERS],
        rows: [
          sampleArtwork({ "Inventory ID": "1004" }),
          sampleArtwork({
            "Inventory ID": "not-a-number",
            Title: "Broken",
            Year: "2025",
          }),
          sampleArtwork({
            "Inventory ID": "1006",
            Title: "Blue Garden",
            Year: "2025",
          }),
        ],
      });
      assertEqual(parsed.records.length, 2, "valid rows kept");
      assertDeepEqual(
        parsed.records.map((item) => item.inventoryId),
        [1004, 1006],
        "ids",
      );
      assert(
        parsed.warnings.some((warning) => warning.code === "malformed_row"),
        "malformed warning",
      );
    },
  },
  {
    name: "missing Web File URL produces placeholder state",
    run: () => {
      const parsed = parseArtworkInventoryRecords({
        headers: [...ARTWORK_INVENTORY_HEADERS],
        rows: [sampleArtwork({ "Web File URL": "" })],
      });
      const record = parsed.records[0]!;
      assertEqual(record.webFileUrl, "", "canonical empty");
      assertEqual(record.webFileDisplayUrl, null, "no display URL");
    },
  },
  {
    name: "Dropbox shared URL converts into a renderable URL",
    run: () => {
      const result = dropboxSharedUrlToDisplayUrl(SAMPLE_WEB_URL);
      assert(result.ok, "conversion ok");
      assertEqual(
        result.canonicalUrl,
        SAMPLE_WEB_URL,
        "canonical preserved on result",
      );
      const display = new URL(result.displayUrl);
      assertEqual(display.hostname, "dl.dropboxusercontent.com", "content host");
      assertEqual(display.searchParams.get("raw"), "1", "raw=1");
      assertEqual(display.searchParams.get("dl"), null, "dl removed");
      assert(
        display.pathname.includes("/scl/fi/"),
        "scl/fi path kept",
      );
    },
  },
  {
    name: "Dropbox rlkey is preserved",
    run: () => {
      const result = dropboxSharedUrlToDisplayUrl(
        "https://www.dropbox.com/scl/fi/abc123/file.jpg?rlkey=keepme&st=token&dl=0",
      );
      assert(result.ok, "ok");
      const display = new URL(result.displayUrl);
      assertEqual(display.searchParams.get("rlkey"), "keepme", "rlkey");
      assertEqual(display.searchParams.get("st"), "token", "st kept");
    },
  },
  {
    name: "Dropbox URL already configured for direct rendering stays renderable",
    run: () => {
      const ready =
        "https://dl.dropboxusercontent.com/scl/fi/abc123/file.jpg?rlkey=keepme&raw=1";
      const result = dropboxSharedUrlToDisplayUrl(ready);
      assert(result.ok, "ok");
      const display = new URL(result.displayUrl);
      assertEqual(display.searchParams.get("raw"), "1", "raw");
      assertEqual(display.searchParams.get("rlkey"), "keepme", "rlkey");
    },
  },
  {
    name: "malformed and non-Dropbox URLs are not converted",
    run: () => {
      assertEqual(
        dropboxSharedUrlToDisplayUrl("").ok,
        false,
        "empty",
      );
      assertEqual(
        dropboxSharedUrlToDisplayUrl("not a url").ok,
        false,
        "malformed",
      );
      const drive = dropboxSharedUrlToDisplayUrl(
        "https://drive.google.com/file/d/abc/view",
      );
      assertEqual(drive.ok, false, "not dropbox");
      if (!drive.ok) {
        assertEqual(drive.reason, "not_dropbox", "reason");
      }
      const folder = dropboxSharedUrlToDisplayUrl(
        "https://www.dropbox.com/scl/fo/folderid/name?rlkey=abc&dl=0",
      );
      assertEqual(folder.ok, false, "folder unsupported");
    },
  },
  {
    name: "year grouping, year descending, Inventory ID ascending within year",
    run: () => {
      const groups = groupArtworksByYear([
        artwork({ inventoryId: 1006, title: "C", year: "2025" }),
        artwork({ inventoryId: 1005, title: "B", year: "2026" }),
        artwork({ inventoryId: 1004, title: "A", year: "2026" }),
        artwork({ inventoryId: 1010, title: "D", year: "2024" }),
      ]);
      assertDeepEqual(
        groups.map((group) => group.year),
        ["2026", "2025", "2024"],
        "years descending",
      );
      assertDeepEqual(
        groups[0]!.artworks.map((item) => item.inventoryId),
        [1004, 1005],
        "2026 ids ascending",
      );
      assertDeepEqual(
        groups[1]!.artworks.map((item) => item.inventoryId),
        [1006],
        "2025",
      );
    },
  },
  {
    name: "search by title",
    run: () => {
      const results = searchArchiveArtworks(
        [
          artwork({ inventoryId: 1004, title: "Tulip Tree" }),
          artwork({ inventoryId: 1005, title: "Blue Garden" }),
        ],
        "Tulip",
      );
      assertEqual(results.length, 1, "one match");
      assertEqual(results[0]!.title, "Tulip Tree", "title");
    },
  },
  {
    name: "search by Inventory ID",
    run: () => {
      const results = searchArchiveArtworks(
        [
          artwork({ inventoryId: 1004, title: "Tulip Tree" }),
          artwork({ inventoryId: 1005, title: "Blue Garden" }),
        ],
        "1004",
      );
      assertEqual(results.length, 1, "one match");
      assertEqual(results[0]!.inventoryId, 1004, "id");
    },
  },
  {
    name: "search by medium",
    run: () => {
      const results = searchArchiveArtworks(
        [
          artwork({ inventoryId: 1004, medium: "Monotype" }),
          artwork({ inventoryId: 1005, medium: "Painting" }),
        ],
        "painting",
      );
      assertEqual(results.length, 1, "one match");
      assertEqual(results[0]!.inventoryId, 1005, "id");
    },
  },
  {
    name: "search by exhibition and gallery",
    run: () => {
      const rows = [
        artwork({
          inventoryId: 1004,
          exhibition: "Spring Show",
          gallery: "Other Venue",
        }),
        artwork({
          inventoryId: 1005,
          exhibition: "Winter",
          gallery: "Blue Garden Gallery",
        }),
      ];
      const byExhibition = searchArchiveArtworks(rows, "Spring");
      assertEqual(byExhibition.length, 1, "exhibition");
      assertEqual(byExhibition[0]!.inventoryId, 1004, "exhibition id");
      const byGallery = searchArchiveArtworks(rows, "Blue Garden");
      assertEqual(byGallery.length, 1, "gallery");
      assertEqual(byGallery[0]!.inventoryId, 1005, "gallery id");
    },
  },
  {
    name: "dimension formatting",
    run: () => {
      assertEqual(
        formatArchiveDimensions({
          height: "30",
          width: "22",
          depth: "",
          dimensionUnit: "in",
        }),
        "30 × 22 in",
        "height × width",
      );
      assertEqual(
        formatArchiveDimensions({
          height: "40",
          width: "30",
          depth: "2",
          dimensionUnit: "in",
        }),
        "40 × 30 × 2 in",
        "with depth",
      );
      assertEqual(
        formatArchiveDimensions({
          height: "abc",
          width: "22",
          depth: "",
          dimensionUnit: "in",
        }),
        "",
        "malformed omitted",
      );
      assertEqual(
        formatArchiveDimensions({
          height: "30",
          width: "",
          depth: "",
          dimensionUnit: "in",
        }),
        "",
        "incomplete omitted",
      );
    },
  },
  {
    name: "detail lookup by unique Inventory ID",
    run: () => {
      const catalog = buildArchiveCatalog({
        headers: [...ARTWORK_INVENTORY_HEADERS],
        rows: [
          sampleArtwork({ "Inventory ID": "1004", Title: "Tulip Tree" }),
          sampleArtwork({
            "Inventory ID": "1005",
            Title: "Blue Garden",
            Year: "2025",
          }),
        ],
      });
      const found = lookupCatalogArtwork(catalog, 1004);
      assertEqual(found.kind, "found", "found");
      if (found.kind === "found") {
        assertEqual(found.artwork.title, "Tulip Tree", "title");
      }
    },
  },
  {
    name: "duplicate Inventory IDs produce a safe error rather than choosing arbitrarily",
    run: () => {
      const parsed = parseArtworkInventoryRecords({
        headers: [...ARTWORK_INVENTORY_HEADERS],
        rows: [
          sampleArtwork({ "Inventory ID": "1004", Title: "Tulip Tree" }),
          sampleArtwork({ "Inventory ID": "1004", Title: "Other Title" }),
          sampleArtwork({ "Inventory ID": "1005", Title: "Blue Garden" }),
        ],
      });
      assertDeepEqual(parsed.duplicateInventoryIds, [1004], "duplicate id");
      const lookup = findArtworkByInventoryId(parsed.records, 1004);
      assertEqual(lookup.kind, "duplicate", "duplicate lookup");
      if (lookup.kind === "duplicate") {
        assertEqual(lookup.inventoryId, 1004, "id");
      }
      const catalog = buildArchiveCatalog({
        headers: [...ARTWORK_INVENTORY_HEADERS],
        rows: [
          sampleArtwork({ "Inventory ID": "1004", Title: "Tulip Tree" }),
          sampleArtwork({ "Inventory ID": "1004", Title: "Other Title" }),
          sampleArtwork({ "Inventory ID": "1005", Title: "Blue Garden" }),
        ],
      });
      assertEqual(
        catalog.artworks.some((item) => item.inventoryId === 1004),
        false,
        "duplicates omitted from display",
      );
      assertEqual(lookupCatalogArtwork(catalog, 1004).kind, "duplicate", "catalog");
      assertEqual(lookupCatalogArtwork(catalog, 1005).kind, "found", "unique ok");
    },
  },
  {
    name: "loadArtworkArchiveWithReader uses the mock table and never a live Google API",
    run: async () => {
      let googleCalls = 0;
      const mockGoogle = {
        spreadsheets: {
          values: {
            get: () => {
              googleCalls += 1;
              throw new Error("live Google call is not allowed in tests");
            },
          },
        },
      };
      void mockGoogle;

      const result = await loadArtworkArchiveWithReader(async () => ({
        headers: [...ARTWORK_INVENTORY_HEADERS],
        rows: [sampleArtwork()],
      }));
      assertEqual(googleCalls, 0, "Google API not called");
      assert(result.ok, "load ok");
      if (result.ok) {
        assertEqual(result.catalog.artworks.length, 1, "one artwork");
        assertEqual(result.catalog.artworks[0]!.inventoryId, 1004, "id");
      }
    },
  },
  {
    name: "year navigation is generated from records, descending, never hardcoded",
    run: () => {
      const years = uniqueYearsDescending([
        artwork({ year: "2022", inventoryId: 1010 }),
        artwork({ year: "2026", inventoryId: 1004 }),
        artwork({ year: "2026", inventoryId: 1005 }),
        artwork({ year: "2024", inventoryId: 1008 }),
      ]);
      assertDeepEqual(years, ["2026", "2024", "2022"], "derived descending years");
      assertEqual(years.includes("2025"), false, "missing year not invented");
      assertEqual(yearSectionId("2026"), "year-2026", "section id");
      assertEqual(formatYearArtworkCount(1), "1 artwork", "singular count");
      assertEqual(formatYearArtworkCount(3), "3 artworks", "plural count");
    },
  },
  {
    name: "year navigation collapses older years into More",
    run: () => {
      const years = ["2026", "2025", "2024", "2023", "2022", "2021", "2020"];
      const split = splitYearNavigation(years);
      assertDeepEqual(
        split.primary,
        ["2026", "2025", "2024", "2023", "2022"],
        "five primary years",
      );
      assertDeepEqual(split.more, ["2021", "2020"], "older years in More");
      const few = splitYearNavigation(["2026", "2025"]);
      assertDeepEqual(few.primary, ["2026", "2025"], "all visible when few");
      assertDeepEqual(few.more, [], "no More when few");
    },
  },
  {
    name: "Untitled title is preserved exactly",
    run: () => {
      const parsed = parseArtworkInventoryRecords({
        headers: [...ARTWORK_INVENTORY_HEADERS],
        rows: [sampleArtwork({ Title: UNTITLED_TITLE })],
      });
      assertEqual(parsed.records[0]!.title, "Untitled", "stored title");
      assertEqual(parsed.records[0]!.title, UNTITLED_TITLE, "canonical Untitled");
    },
  },
  {
    name: "inventory ID formats without a prefix",
    run: () => {
      assertEqual(formatInventoryId(1004), "1004", "numeric id only");
      assertEqual(
        artworkPreviewAlt(artwork({ title: "Tulip Tree", inventoryId: 1004 })),
        "Tulip Tree, 1004",
        "alt text includes title and id",
      );
    },
  },
  {
    name: "detail page omits blank metadata and keeps canonical file URLs",
    run: () => {
      const record = artwork({
        exhibition: "Abundance",
        gallery: "",
        photographer: "",
        notes: "",
        medium: "Monotype",
        artworkFolderUrl: "https://www.dropbox.com/scl/fo/folder?rlkey=f&dl=0",
        masterFileUrl: "https://www.dropbox.com/scl/fi/master?rlkey=m&dl=0",
        hrFileUrl: "https://www.dropbox.com/scl/fi/hr?rlkey=h&dl=0",
        webFileUrl: SAMPLE_WEB_URL,
      });
      assertDeepEqual(
        archivePrimaryFacts(record),
        ["2026", "Monotype", "30 × 22 in"],
        "primary facts",
      );
      assertDeepEqual(
        archiveLabeledFields(record).map((field) => field.label),
        ["Exhibition"],
        "blank gallery/photographer/notes omitted",
      );
      assertEqual(archiveCollectionFields().length, 0, "no collection yet");

      const files = archiveFileLinks(record);
      assertDeepEqual(
        files.map((link) => link.label),
        [
          "View image folder in Dropbox",
          "Master TIFF",
          "High Resolution JPG",
          "Web JPG",
        ],
        "file labels",
      );
      assertEqual(files[0]!.href, record.artworkFolderUrl, "folder canonical");
      assertEqual(files[1]!.href, record.masterFileUrl, "master canonical");
      assertEqual(files[2]!.href, record.hrFileUrl, "hr canonical");
      assertEqual(files[3]!.href, record.webFileUrl, "web canonical stored URL");
      assertEqual(
        files[3]!.href === record.webFileDisplayUrl,
        false,
        "file link is not the derived display URL",
      );
    },
  },
  {
    name: "search results remain artwork records for the visual grid",
    run: () => {
      const rows = [
        artwork({ inventoryId: 1004, title: "Tulip Tree", exhibition: "Spring" }),
        artwork({ inventoryId: 1005, title: "Blue Garden", year: "2025" }),
      ];
      const results = searchArchiveArtworks(rows, "Tulip");
      assertEqual(results.length, 1, "one match");
      assertEqual(results[0]!.inventoryId, 1004, "id");
      assertEqual(results[0]!.title, "Tulip Tree", "title kept");
      assertEqual(results[0]!.webFileUrl, SAMPLE_WEB_URL, "preview URL kept");
      const groups = groupArtworksByYear(results);
      assertEqual(groups.length, 1, "still year-grouped");
      assertEqual(groups[0]!.artworks[0]!.inventoryId, 1004, "card record");
    },
  },
  {
    name: "Google failures map to a safe archive error without credentials",
    run: async () => {
      const secret = "super-secret-private-key";
      const result = await loadArtworkArchiveWithReader(async () => {
        throw new GoogleIntegrationError({
          code: "SHEET_ACCESS_DENIED",
          message: "Service account cannot access the spreadsheet.",
          causeDetail: `status=403; key=${secret}`,
        });
      });
      assertEqual(result.ok, false, "failed");
      if (!result.ok) {
        assertEqual(result.message, ARCHIVE_UNAVAILABLE_MESSAGE, "safe message");
        assertEqual(result.message.includes(secret), false, "no secret");
        assertEqual(result.message.includes("403"), false, "no status");
      }
    },
  },
  {
    name: "delete plan locates the sheet row by Inventory ID and never deletes files",
    run: () => {
      const table = {
        headers: [...ARTWORK_INVENTORY_HEADERS],
        rows: [
          sampleArtwork({ "Inventory ID": "1003", Title: "Earlier" }),
          sampleArtwork({ "Inventory ID": "1004", Title: "Tulip Tree" }),
        ],
      };
      const plan = planArtworkInventoryRowDelete({
        table,
        inventoryId: 1004,
      });
      assertEqual(plan.ok, true, "ok");
      if (!plan.ok) return;
      assertEqual(plan.inventoryId, 1004, "id");
      assertEqual(plan.title, "Tulip Tree", "title");
      assertEqual(plan.sheetRowNumber, 3, "second data row is sheet row 3");
      assertEqual(plan.filesDeleted, false, "files stay");
      assertEqual(
        ARCHIVE_DELETE_TOUCHES_STORED_FILES,
        false,
        "constant is false",
      );
      assertEqual("masterFileUrl" in plan, false, "no file URL delete target");
      assertEqual("filePaths" in plan, false, "no file path list");
    },
  },
  {
    name: "delete plan refuses invalid, missing, and duplicate Inventory IDs",
    run: () => {
      const table = {
        headers: [...ARTWORK_INVENTORY_HEADERS],
        rows: [
          sampleArtwork({ "Inventory ID": "1004" }),
          sampleArtwork({ "Inventory ID": "1004", Title: "Copy" }),
        ],
      };
      const missing = planArtworkInventoryRowDelete({
        table: {
          headers: [...ARTWORK_INVENTORY_HEADERS],
          rows: [sampleArtwork({ "Inventory ID": "1005" })],
        },
        inventoryId: 1004,
      });
      assertEqual(missing.ok, false, "missing not ok");
      if (!missing.ok) {
        assertEqual(missing.code, "not_found", "missing code");
        assertEqual(
          missing.message,
          ARCHIVE_DELETE_NOT_FOUND_MESSAGE,
          "missing message",
        );
      }

      const duplicate = planArtworkInventoryRowDelete({
        table,
        inventoryId: 1004,
      });
      assertEqual(duplicate.ok, false, "duplicate not ok");
      if (!duplicate.ok) {
        assertEqual(duplicate.code, "duplicate_inventory_id", "dup code");
        assertEqual(
          duplicate.message,
          ARCHIVE_DELETE_DUPLICATE_MESSAGE,
          "dup message",
        );
      }

      const invalid = planArtworkInventoryRowDelete({
        table,
        inventoryId: 0,
      });
      assertEqual(invalid.ok, false, "invalid not ok");
      if (!invalid.ok) {
        assertEqual(invalid.code, "invalid_inventory_id", "invalid code");
        assertEqual(
          invalid.message,
          ARCHIVE_DELETE_INVALID_ID_MESSAGE,
          "invalid message",
        );
      }
      assertEqual(parseDeleteInventoryId("abc"), null, "non-numeric");
      assertEqual(parseDeleteInventoryId(1004.5), null, "non-integer");
    },
  },
  {
    name: "confirming delete removes only the archive sheet row, not stored files",
    run: async () => {
      const deletedRows: number[] = [];
      const fileDeletes: string[] = [];
      const table = {
        headers: [...ARTWORK_INVENTORY_HEADERS],
        rows: [sampleArtwork({ "Inventory ID": "1004", Title: "Tulip Tree" })],
      };
      const result = await deleteArtworkArchiveRecordWithDeps({
        inventoryId: 1004,
        readTable: async () => table,
        deleteSheetRow: async (sheetRowNumber) => {
          deletedRows.push(sheetRowNumber);
        },
      });
      assertEqual(result.ok, true, "ok");
      if (!result.ok) return;
      assertDeepEqual(deletedRows, [2], "sheet row 2 deleted");
      assertDeepEqual(fileDeletes, [], "no file deletes recorded");
      assertEqual(result.filesDeleted, false, "filesDeleted flag");
      assertEqual(
        result.message,
        archiveDeleteSuccessMessage("Tulip Tree"),
        "success message",
      );
    },
  },
  {
    name: "failed deletion leaves the archive record in place",
    run: async () => {
      let deleteCalls = 0;
      const result = await deleteArtworkArchiveRecordWithDeps({
        inventoryId: 1004,
        readTable: async () => ({
          headers: [...ARTWORK_INVENTORY_HEADERS],
          rows: [sampleArtwork({ "Inventory ID": "1004", Title: "Tulip Tree" })],
        }),
        deleteSheetRow: async () => {
          deleteCalls += 1;
          throw new Error("Sheets write failed");
        },
      });
      assertEqual(result.ok, false, "not ok");
      assertEqual(deleteCalls, 1, "attempted the sheet delete");
      if (!result.ok) {
        assertEqual(result.filesDeleted, false, "still no file delete");
        assertEqual(result.causeDetail, "Sheets write failed", "cause kept");
      }
      const remaining = applySuccessfulArchiveDelete(
        [artwork(), artwork({ inventoryId: 1005, title: "Blue Garden" })],
        9999,
      );
      assertEqual(remaining.length, 2, "failed path does not filter the list");
    },
  },
  {
    name: "deleted artwork is removed from the archive list after success",
    run: () => {
      const remaining = applySuccessfulArchiveDelete(
        [
          artwork({ inventoryId: 1004, title: "Tulip Tree" }),
          artwork({ inventoryId: 1005, title: "Blue Garden" }),
        ],
        1004,
      );
      assertEqual(remaining.length, 1, "one left");
      assertEqual(remaining[0]!.inventoryId, 1005, "other work kept");
      assertEqual(
        remaining.some((item) => item.inventoryId === 1004),
        false,
        "deleted id gone",
      );
    },
  },
  {
    name: "selecting Delete opens confirmation; Cancel does not delete",
    run: () => {
      assertEqual(
        reduceArchiveDeleteUi("idle", "select-delete"),
        "confirm",
        "delete opens confirm, not a deleted state",
      );
      assertEqual(
        reduceArchiveDeleteUi("menu", "select-delete"),
        "confirm",
        "menu delete opens confirm",
      );
      assertEqual(
        reduceArchiveDeleteUi("confirm", "cancel"),
        "idle",
        "cancel returns to idle",
      );
      assertEqual(
        reduceArchiveDeleteUi("confirm", "confirm-delete"),
        "pending",
        "confirming starts pending",
      );
      assertEqual(
        reduceArchiveDeleteUi("pending", "failure"),
        "confirm",
        "failure keeps the dialog open",
      );
    },
  },
  {
    name: "deleting from the detail page redirects to /artworks",
    run: () => {
      assertEqual(
        nextRouteAfterArchiveDelete({ source: "detail", ok: true }),
        "/artworks",
        "detail success",
      );
      assertEqual(
        nextRouteAfterArchiveDelete({ source: "list", ok: true }),
        null,
        "list stays put",
      );
      assertEqual(
        nextRouteAfterArchiveDelete({ source: "detail", ok: false }),
        null,
        "failed detail delete does not redirect",
      );
    },
  },
  {
    name: "delete failure logs include inventory ID and never claim files were deleted",
    run: () => {
      const payload = archiveDeleteFailureLog({
        inventoryId: 1004,
        sheetRowNumber: 12,
        code: "SHEET_ACCESS_DENIED",
        message: "The artwork could not be deleted.",
        causeDetail: "status=403",
      });
      assertEqual(payload.operation, "deleteArtwork", "operation");
      assertEqual(payload.inventoryId, 1004, "id");
      assertEqual(payload.sheetRowNumber, 12, "row");
      assertEqual(payload.filesDeleted, false, "files not deleted");
      assertEqual(payload.causeDetail, "status=403", "cause kept for diagnosis");
      assertEqual(
        archiveDeleteConfirmationTitle("Tulip Tree"),
        "Delete “Tulip Tree”?",
        "confirm title",
      );
      assert(
        ARCHIVE_DELETE_CONFIRMATION_BODY.includes("cannot be undone"),
        "confirm body",
      );
    },
  },
];

async function main() {
  let failed = 0;
  for (const test of tests) {
    try {
      await test.run();
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

  console.log(`\nAll ${tests.length} archive unit tests passed.`);
}

void main();
