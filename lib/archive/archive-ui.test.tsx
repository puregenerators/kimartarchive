/**
 * Presentation tests for the read-only artwork archive UI.
 * Static markup only — no browser, no new test framework.
 * Run: npx tsx lib/archive/archive-ui.test.tsx
 */

import { renderToStaticMarkup } from "react-dom/server";

import { AppNavView } from "@/components/AppNav";
import { ArchiveArtworkCard } from "@/components/archive/ArchiveArtworkCard";
import { ArchiveDeleteControlView } from "@/components/archive/ArchiveDeleteControlView";
import { ArchivePreviewImage } from "@/components/archive/ArchivePreviewImage";
import { ArchiveYearNav } from "@/components/archive/ArchiveYearNav";
import { ArchiveYearSections } from "@/components/archive/ArchiveYearSections";
import { ArtworkDetailView } from "@/components/archive/ArtworkDetailView";
import { ArtworksArchiveHeader } from "@/components/archive/ArtworksArchiveHeader";
import { ArtworksArchiveView } from "@/components/archive/ArtworksArchiveView";
import { webFileDisplayUrlFromCanonical } from "@/lib/archive/dropbox-display-url";
import {
  ARCHIVE_DELETE_CONFIRMATION_BODY,
  applySuccessfulArchiveDelete,
  archiveDeleteConfirmationTitle,
} from "@/lib/archive/delete-logic";
import {
  formatYearArtworkCount,
  uniqueYearsDescending,
  yearSectionId,
} from "@/lib/archive/presentation";
import {
  groupArtworksByYear,
  searchArchiveArtworks,
} from "@/lib/archive/records";
import {
  ARCHIVE_RESOURCE_LINK_COPY,
  archiveResourceLinks,
  productionSpreadsheetHref,
} from "@/lib/archive/resource-links";
import type { ArchiveArtwork } from "@/lib/archive/types";
import { UNTITLED_TITLE } from "@/lib/artwork/untitled";
import { DROPBOX_ARCHIVE_ROOT_WEB_URL } from "@/lib/dropbox/types";

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

function assertDeepEqual(actual: unknown, expected: unknown, message: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${message}\n  expected: ${e}\n  actual:   ${a}`);
  }
}

const SAMPLE_WEB_URL =
  "https://www.dropbox.com/scl/fi/abc123/tulip_web_01.jpg?rlkey=secretkey&dl=0";

function artwork(overrides: Partial<ArchiveArtwork> = {}): ArchiveArtwork {
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

function headingText(markup: string, tag: "h1" | "h2" | "h3"): string[] {
  const matches = markup.matchAll(new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, "g"));
  return [...matches].map((match) => match[1] ?? "");
}

const tests: TestCase[] = [
  {
    name: "inventory ID always renders on the artwork card",
    run: () => {
      const markup = renderToStaticMarkup(
        <ArchiveArtworkCard
          artwork={artwork({ medium: "", webFileDisplayUrl: null, webFileUrl: "" })}
        />,
      );
      assert(markup.includes(">1004<"), "inventory ID visible");
      assert(!markup.includes("INV-1004"), "no invented prefix");
      assert(markup.includes("/artworks/1004"), "links to detail");
    },
  },
  {
    name: "card hierarchy is title, inventory ID, then medium",
    run: () => {
      const markup = renderToStaticMarkup(
        <ArchiveArtworkCard artwork={artwork()} />,
      );
      const titleAt = markup.indexOf("Tulip Tree");
      const idAt = markup.indexOf(">1004<");
      const mediumAt = markup.indexOf("Monotype");
      assert(titleAt >= 0 && idAt > titleAt, "title before ID");
      assert(mediumAt > idAt, "ID before medium");
      assert(markup.includes("View artwork →"), "keyboard/hover affordance present");
    },
  },
  {
    name: "Untitled renders exactly as Untitled",
    run: () => {
      const untitled = artwork({ title: UNTITLED_TITLE, inventoryId: 1006 });
      const card = renderToStaticMarkup(<ArchiveArtworkCard artwork={untitled} />);
      const detail = renderToStaticMarkup(<ArtworkDetailView artwork={untitled} />);
      assertEqual(headingText(card, "h3")[0], "Untitled", "card title");
      assertEqual(headingText(detail, "h1")[0], "Untitled", "detail title");
      assert(!card.includes("Untitled ("), "no decorated Untitled");
    },
  },
  {
    name: "natural image ratio is not intentionally cropped",
    run: () => {
      const markup = renderToStaticMarkup(
        <ArchiveArtworkCard artwork={artwork()} />,
      );
      assert(!markup.includes("aspect-[4/5]"), "no forced 4:5 frame");
      assert(!markup.includes("object-cover"), "no cover crop");
      assert(markup.includes("object-contain"), "contain, not crop");
      assert(markup.includes("h-auto"), "height follows the image");
      assert(markup.includes("loading=\"lazy\""), "grid images lazy-load");
    },
  },
  {
    name: "missing image shows a placeholder while title and ID remain",
    run: () => {
      const record = artwork({
        webFileDisplayUrl: null,
        webFileUrl: "",
        title: "Spring Birds",
        inventoryId: 1005,
      });
      const markup = renderToStaticMarkup(
        <ArchiveArtworkCard artwork={record} />,
      );
      assert(markup.includes("Image unavailable"), "placeholder copy");
      assert(markup.includes("Spring Birds"), "title remains");
      assert(markup.includes(">1005<"), "inventory ID remains");
      assert(!markup.includes("<img"), "no broken image tag");
    },
  },
  {
    name: "year navigation is generated from records",
    run: () => {
      const records = [
        artwork({ year: "2024", inventoryId: 1001 }),
        artwork({ year: "2026", inventoryId: 1004 }),
        artwork({ year: "2025", inventoryId: 1002 }),
      ];
      const years = uniqueYearsDescending(records);
      const markup = renderToStaticMarkup(<ArchiveYearNav years={years} />);
      assert(markup.includes("aria-label=\"Artwork years\""), "accessible nav");
      assert(markup.includes(`href="#${yearSectionId("2026")}"`), "2026 link");
      assert(markup.includes(`href="#${yearSectionId("2025")}"`), "2025 link");
      assert(markup.includes(`href="#${yearSectionId("2024")}"`), "2024 link");
      assert(!markup.includes("2023"), "does not invent years");
      assert(!markup.includes("More"), "no More for three years");
    },
  },
  {
    name: "year navigation collapses older years into More",
    run: () => {
      const years = ["2026", "2025", "2024", "2023", "2022", "2018", "2012"];
      const markup = renderToStaticMarkup(<ArchiveYearNav years={years} />);
      assert(markup.includes("More"), "More control");
      assert(markup.includes(`href="#${yearSectionId("2018")}"`), "older year kept");
      assert(markup.includes("<details"), "More is expandable");
    },
  },
  {
    name: "search preserves visual year-grouped cards instead of a table",
    run: () => {
      const records = [
        artwork({ inventoryId: 1004, title: "Tulip Tree", exhibition: "Abundance" }),
        artwork({
          inventoryId: 1005,
          title: "Blue Garden",
          year: "2025",
          exhibition: "Other",
        }),
      ];
      const results = searchArchiveArtworks(records, "Abundance");
      const markup = renderToStaticMarkup(
        <ArchiveYearSections groups={groupArtworksByYear(results)} />,
      );
      assert(!markup.includes("<table"), "no table layout");
      assert(markup.includes("Tulip Tree"), "matching title shown");
      assert(markup.includes(">1004<"), "matching ID shown");
      assert(!markup.includes("Blue Garden"), "non-matching work omitted");
      assert(markup.includes(`id="${yearSectionId("2026")}"`), "year section kept");
      assert(markup.includes("grid"), "visual grid kept");
    },
  },
  {
    name: "blank metadata is omitted on the detail page",
    run: () => {
      const markup = renderToStaticMarkup(
        <ArtworkDetailView
          artwork={artwork({
            exhibition: "Abundance",
            gallery: "",
            photographer: "",
            notes: "",
            medium: "Monotype",
          })}
        />,
      );
      assert(markup.includes("Abundance"), "exhibition kept");
      assert(markup.includes("Exhibition"), "exhibition label");
      assert(!markup.includes("Gallery / Venue"), "blank gallery omitted");
      assert(!markup.includes("Photographer"), "blank photographer omitted");
      assert(!markup.includes("Notes"), "blank notes omitted");
      assert(!markup.includes("Collection Information"), "empty collection omitted");
      assert(markup.includes("2026"), "year kept");
      assert(markup.includes("Monotype"), "medium kept");
      assert(markup.includes("30 × 22 in"), "dimensions kept");
    },
  },
  {
    name: "detail page file links use canonical stored URLs",
    run: () => {
      const record = artwork({
        artworkFolderUrl: "https://www.dropbox.com/scl/fo/folder?rlkey=f&dl=0",
        masterFileUrl: "https://www.dropbox.com/scl/fi/master?rlkey=m&dl=0",
        hrFileUrl: "https://www.dropbox.com/scl/fi/hr?rlkey=h&dl=0",
        webFileUrl: SAMPLE_WEB_URL,
      });
      const markup = renderToStaticMarkup(<ArtworkDetailView artwork={record} />);
      const fileHrefs = [...markup.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(
        (match) => ({
          href: (match[1] ?? "").replaceAll("&amp;", "&"),
          label: match[2] ?? "",
        }),
      );
      assertDeepEqual(
        fileHrefs.map((link) => link.label),
        [
          "View image folder in Dropbox",
          "Master TIFF",
          "High Resolution JPG",
          "Web JPG",
        ],
        "file labels",
      );
      assertEqual(fileHrefs[0]!.href, record.artworkFolderUrl, "folder canonical");
      assertEqual(fileHrefs[1]!.href, record.masterFileUrl, "master canonical");
      assertEqual(fileHrefs[2]!.href, record.hrFileUrl, "hr canonical");
      assertEqual(fileHrefs[3]!.href, record.webFileUrl, "web canonical stored URL");
      assert(
        fileHrefs.every((link) => link.href !== record.webFileDisplayUrl),
        "file links are not the derived display URL",
      );
    },
  },
  {
    name: "detail preview image is not forced into a cropped frame",
    run: () => {
      const markup = renderToStaticMarkup(
        <ArtworkDetailView artwork={artwork()} />,
      );
      assert(!markup.includes("aspect-[4/5]"), "no 4:5 crop box");
      assert(!markup.includes("object-cover"), "no cover crop");
      assert(markup.includes("object-contain"), "natural contain");
    },
  },
  {
    name: "preview image placeholder renders for a missing display URL",
    run: () => {
      const markup = renderToStaticMarkup(
        <ArchivePreviewImage displayUrl={null} alt="Tulip Tree, 1004" />,
      );
      assert(markup.includes("Image unavailable"), "placeholder");
      assert(!markup.includes("<img"), "no img when unavailable");
    },
  },
  {
    name: "desktop navigation is hidden on mobile and a menu control is present",
    run: () => {
      const markup = renderToStaticMarkup(
        <AppNavView
          pathname="/artworks"
          menuOpen={false}
          onMenuToggle={() => {}}
        />,
      );
      assert(markup.includes("Kim Osgood Archive"), "archive name");
      assert(
        markup.includes('aria-label="Open navigation"'),
        "mobile menu button",
      );
      assert(markup.includes('aria-expanded="false"'), "collapsed state");
      assert(markup.includes("md:hidden"), "menu button hidden on desktop");
      assert(markup.includes("hidden"), "desktop nav hidden by default");
      assert(markup.includes("md:flex"), "desktop nav at md+");
      assert(
        !markup.includes('aria-expanded="true"'),
        "menu is not expanded",
      );
    },
  },
  {
    name: "mobile menu contains expected navigation links",
    run: () => {
      const markup = renderToStaticMarkup(
        <AppNavView
          pathname="/artworks"
          menuOpen={true}
          onMenuToggle={() => {}}
        />,
      );
      assert(markup.includes('aria-expanded="true"'), "expanded state");
      const expected = [
        { href: "/", label: "Home" },
        { href: "/artworks", label: "View Archive" },
        { href: "/new-artwork", label: "Add New Artwork" },
        { href: "/setup/archive", label: "Settings" },
      ];
      for (const item of expected) {
        assert(markup.includes(`href="${item.href}"`), `${item.label} href`);
        assert(markup.includes(`>${item.label}<`), `${item.label} label`);
      }
    },
  },
  {
    name: "navigation includes a logout control when provided",
    run: () => {
      const markup = renderToStaticMarkup(
        <AppNavView
          pathname="/artworks"
          menuOpen={true}
          onMenuToggle={() => {}}
          desktopLogout={<button type="submit">Log out</button>}
          mobileLogout={<button type="submit">Log out</button>}
        />,
      );
      assert(markup.includes("Log out"), "logout label");
      assert(markup.includes('type="submit"'), "logout submits");
    },
  },
  {
    name: "empty years are not rendered as content sections",
    run: () => {
      const groups = [
        ...groupArtworksByYear([
          artwork({ year: "2026", inventoryId: 1004 }),
          artwork({ year: "2024", inventoryId: 1010, title: "Blue Garden" }),
        ]),
        { year: "2025", artworks: [] },
      ];
      const markup = renderToStaticMarkup(
        <ArchiveYearSections groups={groups} />,
      );
      assert(markup.includes(`id="${yearSectionId("2026")}"`), "2026 section");
      assert(markup.includes(`id="${yearSectionId("2024")}"`), "2024 section");
      assert(
        !markup.includes(`id="${yearSectionId("2025")}"`),
        "empty 2025 omitted",
      );
      assert(markup.includes("1 artwork"), "mobile artwork count");
      assertEqual(
        formatYearArtworkCount(1),
        "1 artwork",
        "singular count helper",
      );
    },
  },
  {
    name: "archive grid stays one column until the md breakpoint",
    run: () => {
      const markup = renderToStaticMarkup(
        <ArchiveYearSections
          groups={groupArtworksByYear([artwork()])}
        />,
      );
      assert(markup.includes("grid-cols-1"), "one column by default");
      assert(markup.includes("md:grid-cols-2"), "two columns from md");
      assert(markup.includes("lg:grid-cols-3"), "three columns from lg");
      assert(markup.includes("xl:grid-cols-4"), "four columns from xl");
      assert(!markup.includes("min-[480px]"), "no 480px two-column switch");
    },
  },
  {
    name: "year headings stay a light serif label with tighter space above",
    run: () => {
      const markup = renderToStaticMarkup(
        <ArchiveYearSections
          groups={groupArtworksByYear([
            artwork({ year: "2026", inventoryId: 1004 }),
            artwork({ year: "2025", inventoryId: 1005, title: "Blue Garden" }),
          ])}
        />,
      );
      assert(markup.includes("font-display"), "serif year heading");
      assert(markup.includes("text-[1.75rem]"), "slightly larger year");
      assert(markup.includes("md:text-[2.2rem]"), "slightly larger year on md");
      assert(!markup.includes("font-bold"), "year is not bold");
      assert(markup.includes("gap-[4.5rem]"), "reduced space above year");
      assert(markup.includes("md:gap-20"), "reduced space above year on md");
      assert(markup.includes("gap-8"), "space below year preserved");
      assert(markup.includes(`id="${yearSectionId("2026")}"`), "2026 section");
      assert(markup.includes(`id="${yearSectionId("2025")}"`), "2025 section");
    },
  },
  {
    name: "search keeps an accessible label and inventory IDs stay visible",
    run: () => {
      const markup = renderToStaticMarkup(
        <ArtworksArchiveView
          artworks={[
            artwork(),
            artwork({
              inventoryId: 1005,
              title: "Blue Garden",
              year: "2025",
              medium: "Painting",
            }),
          ]}
          warnings={[]}
        />,
      );
      assert(markup.includes('id="archive-search"'), "search input");
      assert(markup.includes('for="archive-search"'), "label associated with input");
      assert(markup.includes("Search"), "search label text");
      assert(markup.includes("Year"), "year filter label");
      assert(markup.includes("Medium"), "medium filter label");
      assert(markup.includes(">1004<"), "inventory ID visible");
      assert(markup.includes(">1005<"), "second inventory ID visible");
      assert(
        markup.includes("Search by title, inventory number, exhibition..."),
        "search placeholder",
      );
    },
  },
  {
    name: "delete action is available on an artwork card and detail view",
    run: () => {
      const card = renderToStaticMarkup(
        <ArchiveArtworkCard artwork={artwork()} />,
      );
      const detail = renderToStaticMarkup(
        <ArtworkDetailView artwork={artwork()} />,
      );
      assert(card.includes('aria-label="Artwork actions"'), "card overflow");
      assert(card.includes("•••"), "card ellipsis");
      assert(detail.includes('aria-label="Artwork actions"'), "detail overflow");
      assert(!card.includes("Delete artwork"), "card confirm button hidden");
      assert(!detail.includes("Delete artwork"), "detail confirm button hidden");
    },
  },
  {
    name: "clicking Delete opens confirmation rather than deleting immediately",
    run: () => {
      const menu = renderToStaticMarkup(
        <ArchiveDeleteControlView title="Tulip Tree" phase="menu" />,
      );
      const confirm = renderToStaticMarkup(
        <ArchiveDeleteControlView title="Tulip Tree" phase="confirm" />,
      );
      assert(menu.includes(">Delete<"), "menu shows Delete");
      assert(!menu.includes("Delete artwork"), "menu is not the confirm action");
      assert(!menu.includes(ARCHIVE_DELETE_CONFIRMATION_BODY), "no dialog yet");
      assert(
        confirm.includes(archiveDeleteConfirmationTitle("Tulip Tree")),
        "confirm title",
      );
      assert(
        confirm.includes(ARCHIVE_DELETE_CONFIRMATION_BODY),
        "confirm body",
      );
      assert(confirm.includes(">Cancel<"), "cancel button");
      assert(confirm.includes(">Delete artwork<"), "destructive button");
      assert(confirm.includes("role=\"dialog\""), "dialog role");
    },
  },
  {
    name: "Cancel leaves the artwork visible and closes confirmation",
    run: () => {
      const cancelled = renderToStaticMarkup(
        <ArchiveArtworkCard
          artwork={artwork()}
          deleteControl={
            <ArchiveDeleteControlView title="Tulip Tree" phase="idle" />
          }
        />,
      );
      assert(cancelled.includes("Tulip Tree"), "title remains");
      assert(cancelled.includes(">1004<"), "inventory ID remains");
      assert(!cancelled.includes("Delete artwork"), "confirm closed");
      assert(!cancelled.includes(ARCHIVE_DELETE_CONFIRMATION_BODY), "no dialog");
    },
  },
  {
    name: "deleted artwork disappears from the /artworks grid",
    run: () => {
      const records = [
        artwork({ inventoryId: 1004, title: "Tulip Tree" }),
        artwork({
          inventoryId: 1005,
          title: "Blue Garden",
          year: "2025",
        }),
      ];
      const remaining = applySuccessfulArchiveDelete(records, 1004);
      const markup = renderToStaticMarkup(
        <ArchiveYearSections groups={groupArtworksByYear(remaining)} />,
      );
      assert(!markup.includes("Tulip Tree"), "deleted title gone");
      assert(!markup.includes(">1004<"), "deleted id gone");
      assert(markup.includes("Blue Garden"), "other title kept");
      assert(markup.includes(">1005<"), "other id kept");
    },
  },
  {
    name: "failed deletion displays an error and keeps the artwork",
    run: () => {
      const markup = renderToStaticMarkup(
        <ArchiveArtworkCard
          artwork={artwork()}
          deleteControl={
            <ArchiveDeleteControlView
              title="Tulip Tree"
              phase="confirm"
              error="The artwork could not be deleted."
            />
          }
        />,
      );
      assert(markup.includes("Tulip Tree"), "title remains");
      assert(markup.includes(">1004<"), "id remains");
      assert(markup.includes("/artworks/1004"), "detail link remains");
      assert(
        markup.includes("The artwork could not be deleted."),
        "error shown",
      );
      assert(markup.includes('role="alert"'), "alert role");
    },
  },
  {
    name: "production spreadsheet href uses the canonical browser URL helper",
    run: () => {
      const toBrowserUrl = (spreadsheetId: string) =>
        `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
      assertEqual(
        productionSpreadsheetHref("  prod-sheet-id  ", toBrowserUrl),
        "https://docs.google.com/spreadsheets/d/prod-sheet-id/edit",
        "trims GOOGLE_SHEET_ID and reuses the spreadsheet URL helper",
      );
      assertEqual(
        productionSpreadsheetHref("   ", toBrowserUrl),
        null,
        "omits the spreadsheet link when the production sheet ID is blank",
      );
      assertEqual(
        productionSpreadsheetHref(undefined, toBrowserUrl),
        null,
        "omits the spreadsheet link when the production sheet ID is unset",
      );
    },
  },
  {
    name: "archive resource links reuse the Dropbox App Folder web URL",
    run: () => {
      const links = archiveResourceLinks({
        spreadsheetHref:
          "https://docs.google.com/spreadsheets/d/prod-sheet-id/edit",
      });
      assertDeepEqual(
        links.map((link) => link.key),
        ["spreadsheet", "dropbox"],
        "spreadsheet then Dropbox",
      );
      assertEqual(
        links[1]!.href,
        DROPBOX_ARCHIVE_ROOT_WEB_URL,
        "Dropbox href is the canonical archive folder web URL",
      );
      assert(
        !links[1]!.href.includes("Apps/Kim Art Archive/"),
        "does not invent a Dropbox URL from the display folder path",
      );
      assertEqual(
        archiveResourceLinks({ spreadsheetHref: null }).length,
        1,
        "Dropbox remains when the spreadsheet is unconfigured",
      );
    },
  },
  {
    name: "archive heading keeps resource links as compact external shortcuts",
    run: () => {
      const spreadsheetHref =
        "https://docs.google.com/spreadsheets/d/prod-sheet-id/edit";
      const markup = renderToStaticMarkup(
        <ArtworksArchiveHeader spreadsheetHref={spreadsheetHref} />,
      );
      const headingAt = markup.indexOf("Kim&#x27;s Artwork Archive");
      const navAt = markup.indexOf('aria-label="Archive resources"');
      const spreadsheetAt = markup.indexOf(ARCHIVE_RESOURCE_LINK_COPY.spreadsheet);
      const dropboxAt = markup.indexOf(ARCHIVE_RESOURCE_LINK_COPY.dropbox);
      assert(headingAt >= 0, "archive heading");
      assert(navAt > headingAt, "links sit under the heading");
      assert(spreadsheetAt > navAt, "spreadsheet label in the resource nav");
      assert(dropboxAt > spreadsheetAt, "Dropbox follows spreadsheet");
      assert(markup.includes(`href="${spreadsheetHref}"`), "production sheet URL");
      assert(
        markup.includes(`href="${DROPBOX_ARCHIVE_ROOT_WEB_URL}"`),
        "canonical Dropbox folder URL",
      );
      assert(markup.includes('target="_blank"'), "opens in a new tab");
      assert(markup.includes('rel="noopener noreferrer"'), "external link safety");
      assert(markup.includes(ARCHIVE_RESOURCE_LINK_COPY.externalArrow), "subtle arrow");
      assert(markup.includes("flex-wrap"), "links wrap on narrow screens");
      assert(markup.includes("uppercase"), "utility label casing");
      assert(markup.includes("tracking-[0.14em]"), "letter spacing matches archive labels");
      assert(!markup.includes("<button"), "not buttons");
      assert(!markup.includes("bg-[var(--surface"), "no filled background");
      assert(!markup.includes("border border-"), "no card or large border");
      assert(!markup.includes("rounded"), "no card container");
    },
  },
  {
    name: "archive resource links are not placed in global navigation",
    run: () => {
      const markup = renderToStaticMarkup(
        <AppNavView
          pathname="/artworks"
          menuOpen={true}
          onMenuToggle={() => {}}
        />,
      );
      assert(
        !markup.includes(ARCHIVE_RESOURCE_LINK_COPY.spreadsheet),
        "spreadsheet stays off global nav",
      );
      assert(
        !markup.includes(ARCHIVE_RESOURCE_LINK_COPY.dropbox),
        "Dropbox stays off global nav",
      );
    },
  },
  {
    name: "detail delete confirmation is the same action as the card",
    run: () => {
      const markup = renderToStaticMarkup(
        <ArtworkDetailView
          artwork={artwork()}
          deleteControl={
            <ArchiveDeleteControlView
              title="Tulip Tree"
              phase="confirm"
              variant="detail"
            />
          }
        />,
      );
      assert(
        markup.includes(archiveDeleteConfirmationTitle("Tulip Tree")),
        "same confirm title",
      );
      assert(markup.includes(">Delete artwork<"), "same destructive button");
      assert(markup.includes("Tulip Tree"), "artwork still on the page");
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

console.log(`\nAll ${tests.length} archive UI presentation tests passed.`);
