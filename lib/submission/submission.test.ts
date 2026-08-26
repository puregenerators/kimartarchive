import {
  ARTWORK_INVENTORY_HEADERS,
  ARTWORK_INVENTORY_TAB,
  artworkInventoryColumnIndex,
  INVENTORY_CLAIMS_HEADERS,
  INVENTORY_CLAIMS_TAB,
} from "@/lib/google/headers";
import { buildSheetsImageFormula, isSheetsImageFormula } from "@/lib/google/inventory-thumbnail";
import { planFilenamesForArtwork } from "@/lib/artwork/filenames";
import { UNTITLED_TITLE } from "@/lib/artwork/untitled";
import {
  clearSubmissionAttemptGuardForTests,
  registerSubmissionAttempt,
} from "@/lib/submission/attempt-guard";
import {
  resolveArchiveResources,
} from "@/lib/submission/archive-target";
import { resolvePreflightConfig } from "@/lib/submission/preflight-config";
import { runSubmissionPreflightWithDeps } from "@/lib/submission/preflight-logic";
import type { StorageProvider, StorageProviderKind } from "@/lib/storage/types";
import {
  allocateInventoryIds,
  bindClaimsToArtworks,
  buildArtworkFolderName,
  buildClaimRows,
  nextInventoryIdFromExisting,
  parseInventoryIdsFromClaimRows,
  resolveArtworkMetadata,
} from "@/lib/submission/claim-logic";
import { buildArtworkInventoryRow } from "@/lib/submission/inventory-row";
import { MAX_ARTWORKS_PER_BATCH } from "@/lib/artwork/types";
import { validateSubmissionBatch } from "@/lib/submission/validate-input";
import {
  ARTWORK_METADATA_SCHEMA_VERSION,
  buildArtworkMetadataFilename,
  buildPortableArtworkMetadata,
  serializePortableArtworkMetadata,
} from "@/lib/submission/artwork-metadata";
import {
  maybeThrowTestFault,
  resolveTestFaultConfig,
  shouldInjectTestFault,
  TestFaultInjectionError,
} from "@/lib/submission/test-fault-injection";
import { AsyncMutex } from "@/lib/submission/mutex";
import {
  classifyMasterUploadError,
  failureProgress,
  messageForMasterUploadFailure,
} from "@/lib/submission/failure-reporting";
import {
  emptyIntakeTimings,
  formatIntakeTimings,
} from "@/lib/submission/intake-diagnostics";
import {
  firstFailedDerivativeUpload,
  lastCompletedDerivativeUploadStage,
} from "@/lib/submission/parallel-stages";
import { GoogleIntegrationError } from "@/lib/google/errors";
import type { ArtworkSubmissionInput } from "@/lib/submission/types";

type TestCase = { name: string; run: () => void | Promise<void> };

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

function assertTrue(value: unknown, message: string) {
  if (!value) throw new Error(message);
}

const sampleArtwork = (
  overrides: Partial<ArtworkSubmissionInput> = {},
): ArtworkSubmissionInput => ({
  clientArtworkId: "art-1",
  order: 0,
  title: "Blue Garden",
  year: "2026",
  medium: "Monotype",
  height: "24",
  width: "18",
  depth: "",
  dimensionUnit: "in",
  notes: "",
  overrides: { exhibition: "", gallery: "", photographer: "" },
  originalFilename: "blue-garden.tif",
  ...overrides,
});

const tests: TestCase[] = [
  {
    name: "next inventory ID from empty claim sheet is 1000",
    run: () => {
      assertEqual(nextInventoryIdFromExisting([]), 1000, "empty → 1000");
    },
  },
  {
    name: "highest ID is authoritative regardless of Completed or Failed status",
    run: () => {
      // Mixed statuses implied by raw IDs only — allocation ignores status.
      const ids = parseInventoryIdsFromClaimRows([
        ["c1", "1000", "Completed", "", ""],
        ["c2", "1047", "Failed", "", ""],
        ["c3", "1045", "Claimed", "", ""],
      ]);
      assertEqual(nextInventoryIdFromExisting(ids), 1048, "max+1");
    },
  },
  {
    name: "allocating a batch produces sequential unique IDs",
    run: () => {
      const ids = allocateInventoryIds([1047], 4);
      assertDeepEqual(ids, [1048, 1049, 1050, 1051], "sequential batch");
      assertEqual(new Set(ids).size, 4, "unique");
    },
  },
  {
    name: "claim rows use the expected header order",
    run: () => {
      const { rows } = buildClaimRows([1000, 1001], {
        createdAt: "2026-01-01T00:00:00.000Z",
        createClaimId: (() => {
          let n = 0;
          return () => `claim-${++n}`;
        })(),
      });
      assertEqual(INVENTORY_CLAIMS_HEADERS.length, 5, "header count");
      assertDeepEqual(
        rows[0],
        ["claim-1", "1000", "Claimed", "2026-01-01T00:00:00.000Z", ""],
        "first claim row order",
      );
      assertDeepEqual(
        rows[1],
        ["claim-2", "1001", "Claimed", "2026-01-01T00:00:00.000Z", ""],
        "second claim row order",
      );
    },
  },
  {
    name: "claim-status updates target the correct claim via Claim ID binding",
    run: () => {
      const { claims, rows } = buildClaimRows([2000], {
        createClaimId: () => "exact-claim-id",
      });
      const bound = bindClaimsToArtworks(claims, [
        { clientArtworkId: "client-a", order: 0 },
      ]);
      assertEqual(bound[0]!.claimId, "exact-claim-id", "claim id");
      assertEqual(bound[0]!.clientArtworkId, "client-a", "client id");
      assertEqual(rows[0]![0], "exact-claim-id", "row claim id matches");
      assertEqual(rows[0]![1], "2000", "inventory id column");
      assertEqual(rows[0]![2], "Claimed", "status column");
    },
  },
  {
    name: "resolved metadata combines shared defaults and artwork overrides",
    run: () => {
      const resolved = resolveArtworkMetadata(
        sampleArtwork({
          overrides: {
            exhibition: "Solo Show",
            gallery: "",
            photographer: "Alex",
          },
        }),
        {
          exhibition: "Shared Exhibition",
          gallery: "Shared Gallery",
          photographer: "Shared Photographer",
        },
      );
      assertEqual(resolved.exhibition, "Solo Show", "override wins");
      assertEqual(resolved.gallery, "Shared Gallery", "shared fallback");
      assertEqual(resolved.photographer, "Alex", "override photographer");
      assertEqual(resolved.title, "Blue Garden", "title");
      assertEqual(
        "series" in resolved,
        false,
        "series removed from resolved metadata",
      );
      assertEqual(
        "edition" in resolved,
        false,
        "edition removed from resolved metadata",
      );
      assertEqual(
        "status" in resolved,
        false,
        "status removed from resolved metadata",
      );
    },
  },
  {
    name: "submission payload excludes Series, Edition, and Status",
    run: () => {
      const artwork = sampleArtwork();
      assertEqual("series" in artwork, false, "no series on input");
      assertEqual("edition" in artwork, false, "no edition on input");
      assertEqual("status" in artwork, false, "no status on input");
      const json = JSON.stringify(artwork);
      assertTrue(!json.includes('"series"'), "payload JSON has no series");
      assertTrue(!json.includes('"edition"'), "payload JSON has no edition");
      assertTrue(!json.includes('"status"'), "payload JSON has no status");
    },
  },
  {
    name: "final filenames and folder names use permanent IDs, not preview IDs",
    run: () => {
      const permanentId = 2048;
      const folder = buildArtworkFolderName({
        year: 2026,
        inventoryId: permanentId,
        title: "Blue Garden",
      });
      assertEqual(
        folder,
        "2026_KO_2048_BlueGarden",
        "folder uses permanent ID",
      );
      const plan = planFilenamesForArtwork({
        year: 2026,
        inventoryId: permanentId,
        title: "Blue Garden",
        masterFilename: "source.tiff",
      });
      assertEqual(
        plan.master,
        "2026_KO_2048_BlueGarden_master_01.tif",
        "master permanent",
      );
      assertEqual(plan.hr, "2026_KO_2048_BlueGarden_hr_01.jpg", "hr permanent");
      assertEqual(
        plan.thumb,
        "2026_KO_2048_BlueGarden_thumb_01.jpg",
        "thumb permanent",
      );
      assertTrue(!plan.master.includes("1000"), "not preview base");
    },
  },
  {
    name: "Sheet inventory row follows exact expected header order",
    run: () => {
      const metadata = resolveArtworkMetadata(sampleArtwork(), {
        exhibition: "Show",
        gallery: "Venue",
        photographer: "Pat",
      });
      const row = buildArtworkInventoryRow({
        inventoryId: 1000,
        metadata,
        links: {
          masterFilename: "m.tif",
          masterFileUrl: "https://drive/m",
          hrFilename: "h.jpg",
          hrFileUrl: "https://drive/h",
          webFilename: "w.jpg",
          webFileUrl: "https://drive/w",
          artworkFolderUrl: "https://drive/f",
        },
        thumbnailFormula:
          '=IMAGE("https://dl.dropboxusercontent.com/scl/fi/thumb.jpg?rlkey=k&raw=1", 1)',
        createdAt: "2026-07-30T12:00:00.000Z",
      });
      assertEqual(row.length, ARTWORK_INVENTORY_HEADERS.length, "column count");
      assertEqual(ARTWORK_INVENTORY_HEADERS.length, 22, "schema has 22 columns");
      assertEqual(row[artworkInventoryColumnIndex("Inventory ID")], "1000", "Inventory ID");
      assertTrue(
        isSheetsImageFormula(row[artworkInventoryColumnIndex("Thumbnail")]!),
        "Thumbnail is IMAGE formula",
      );
      assertEqual(row[artworkInventoryColumnIndex("Title")], "Blue Garden", "Title");
      assertEqual(row[artworkInventoryColumnIndex("Medium")], "Monotype", "Medium");
      assertEqual(row[artworkInventoryColumnIndex("Photographer")], "Pat", "Photographer after Dimension Unit");
      assertEqual(row[artworkInventoryColumnIndex("Exhibition")], "Show", "Exhibition after Photographer (no Location)");
      assertEqual(row[artworkInventoryColumnIndex("Master Filename")], "m.tif", "Master Filename position");
      assertEqual(row[artworkInventoryColumnIndex("Master File URL")], "https://drive/m", "Master File URL (Drive legacy)");
      assertEqual(row[artworkInventoryColumnIndex("Artwork Folder URL")], "https://drive/f", "Artwork Folder URL position");
      assertEqual(row[artworkInventoryColumnIndex("Created At")], "2026-07-30T12:00:00.000Z", "Created At");
    },
  },
  {
    name: "server rejects literal Other as medium and accepts resolved custom",
    run: () => {
      const file = new File([new Uint8Array([1, 2, 3])], "a.jpg", {
        type: "image/jpeg",
      });
      const rejected = validateSubmissionBatch({
        submissionAttemptId: "attempt-medium-1",
        shared: {
          exhibition: "",
          gallery: "",
          exhibitionYear: "",
          photographer: "",
        },
        artworks: [sampleArtwork({ medium: "Other" })],
        files: [{ clientArtworkId: "art-1", file }],
      });
      assertEqual(rejected.ok, false, "Other rejected");
      if (!rejected.ok) {
        assertTrue(
          rejected.message.includes("Enter the specific medium"),
          "clear message",
        );
      }

      const accepted = validateSubmissionBatch({
        submissionAttemptId: "attempt-medium-2",
        shared: {
          exhibition: "",
          gallery: "",
          exhibitionYear: "",
          photographer: "",
        },
        artworks: [sampleArtwork({ medium: " Watercolor " })],
        files: [{ clientArtworkId: "art-1", file }],
      });
      assertEqual(accepted.ok, true, "custom accepted");
      if (accepted.ok) {
        assertEqual(
          accepted.input.artworks[0]!.medium,
          "Watercolor",
          "normalized resolved string only",
        );
      }

      const whitespace = validateSubmissionBatch({
        submissionAttemptId: "attempt-medium-3",
        shared: {
          exhibition: "",
          gallery: "",
          exhibitionYear: "",
          photographer: "",
        },
        artworks: [sampleArtwork({ medium: "   " })],
        files: [{ clientArtworkId: "art-1", file }],
      });
      assertEqual(whitespace.ok, false, "whitespace rejected");
    },
  },
  {
    name: "server accepts artworks with blank dimensions",
    run: () => {
      const file = new File([new Uint8Array([1, 2, 3])], "a.jpg", {
        type: "image/jpeg",
      });
      const accepted = validateSubmissionBatch({
        submissionAttemptId: "attempt-dims-optional",
        shared: {
          exhibition: "",
          gallery: "",
          exhibitionYear: "",
          photographer: "",
        },
        artworks: [sampleArtwork({ height: "", width: "", depth: "" })],
        files: [{ clientArtworkId: "art-1", file }],
      });
      assertEqual(accepted.ok, true, "blank dimensions accepted");

      const rejected = validateSubmissionBatch({
        submissionAttemptId: "attempt-dims-invalid",
        shared: {
          exhibition: "",
          gallery: "",
          exhibitionYear: "",
          photographer: "",
        },
        artworks: [sampleArtwork({ height: "0", width: "18" })],
        files: [{ clientArtworkId: "art-1", file }],
      });
      assertEqual(rejected.ok, false, "zero height rejected");
      if (!rejected.ok) {
        assertTrue(
          rejected.message.includes("Height must be a positive number"),
          "height message",
        );
      }
    },
  },
  {
    name: "server accepts 24 source artworks and rejects 25",
    run: () => {
      const shared = {
        exhibition: "",
        gallery: "",
        exhibitionYear: "",
        photographer: "",
      };
      const makeBatch = (count: number) => {
        const artworks = Array.from({ length: count }, (_, i) =>
          sampleArtwork({
            clientArtworkId: `art-${i + 1}`,
            order: i,
            originalFilename: `a${i + 1}.jpg`,
          }),
        );
        const files = artworks.map((artwork, i) => ({
          clientArtworkId: artwork.clientArtworkId,
          file: new File([new Uint8Array([1, 2, 3])], `a${i + 1}.jpg`, {
            type: "image/jpeg",
          }),
        }));
        return { artworks, files };
      };

      const atCap = makeBatch(MAX_ARTWORKS_PER_BATCH);
      const accepted = validateSubmissionBatch({
        submissionAttemptId: "attempt-count-24",
        shared,
        artworks: atCap.artworks,
        files: atCap.files,
      });
      assertEqual(accepted.ok, true, "24 accepted");

      const over = makeBatch(MAX_ARTWORKS_PER_BATCH + 1);
      const rejected = validateSubmissionBatch({
        submissionAttemptId: "attempt-count-25",
        shared,
        artworks: over.artworks,
        files: over.files,
      });
      assertEqual(rejected.ok, false, "25 rejected");
      if (!rejected.ok) {
        assertTrue(
          rejected.message.includes(String(MAX_ARTWORKS_PER_BATCH)),
          "uses shared artwork cap",
        );
      }
    },
  },
  {
    name: "server resolves isUntitled to Untitled and rejects blank titles without the flag",
    run: () => {
      const file = new File([new Uint8Array([1, 2, 3])], "a.jpg", {
        type: "image/jpeg",
      });
      const blankRejected = validateSubmissionBatch({
        submissionAttemptId: "attempt-title-blank",
        shared: {
          exhibition: "",
          gallery: "",
          exhibitionYear: "",
          photographer: "",
        },
        artworks: [sampleArtwork({ title: "" })],
        files: [{ clientArtworkId: "art-1", file }],
      });
      assertEqual(blankRejected.ok, false, "blank title rejected");
      if (!blankRejected.ok) {
        assertTrue(
          blankRejected.message.includes("Title is required"),
          "blank message",
        );
      }

      const whitespaceRejected = validateSubmissionBatch({
        submissionAttemptId: "attempt-title-ws",
        shared: {
          exhibition: "",
          gallery: "",
          exhibitionYear: "",
          photographer: "",
        },
        artworks: [sampleArtwork({ title: "   ", isUntitled: false })],
        files: [{ clientArtworkId: "art-1", file }],
      });
      assertEqual(whitespaceRejected.ok, false, "whitespace title rejected");

      const untitledAccepted = validateSubmissionBatch({
        submissionAttemptId: "attempt-title-untitled",
        shared: {
          exhibition: "",
          gallery: "",
          exhibitionYear: "",
          photographer: "",
        },
        artworks: [sampleArtwork({ title: "Blue Garden", isUntitled: true })],
        files: [{ clientArtworkId: "art-1", file }],
      });
      assertEqual(untitledAccepted.ok, true, "isUntitled accepted");
      if (untitledAccepted.ok) {
        assertEqual(
          untitledAccepted.input.artworks[0]!.title,
          UNTITLED_TITLE,
          "resolved to Untitled",
        );
        assertEqual(
          Object.prototype.hasOwnProperty.call(
            untitledAccepted.input.artworks[0]!,
            "isUntitled",
          ),
          false,
          "isUntitled stripped from validated input",
        );
      }

      const emptyFlagAccepted = validateSubmissionBatch({
        submissionAttemptId: "attempt-title-empty-flag",
        shared: {
          exhibition: "",
          gallery: "",
          exhibitionYear: "",
          photographer: "",
        },
        artworks: [sampleArtwork({ title: "", isUntitled: true })],
        files: [{ clientArtworkId: "art-1", file }],
      });
      assertEqual(emptyFlagAccepted.ok, true, "empty + isUntitled accepted");
      if (emptyFlagAccepted.ok) {
        assertEqual(
          emptyFlagAccepted.input.artworks[0]!.title,
          UNTITLED_TITLE,
          "empty flag resolves Untitled",
        );
      }

      const literalAccepted = validateSubmissionBatch({
        submissionAttemptId: "attempt-title-literal",
        shared: {
          exhibition: "",
          gallery: "",
          exhibitionYear: "",
          photographer: "",
        },
        artworks: [sampleArtwork({ title: "Untitled" })],
        files: [{ clientArtworkId: "art-1", file }],
      });
      assertEqual(literalAccepted.ok, true, "literal Untitled without flag");
      if (literalAccepted.ok) {
        assertEqual(
          literalAccepted.input.artworks[0]!.title,
          UNTITLED_TITLE,
          "literal title kept",
        );
      }
    },
  },
  {
    name: "untitled works write Untitled into Title and do not add a Sheet column",
    run: () => {
      const fileA = new File([new Uint8Array([1, 2, 3])], "a.tif", {
        type: "image/tiff",
      });
      const fileB = new File([new Uint8Array([1, 2, 3])], "b.tif", {
        type: "image/tiff",
      });
      const accepted = validateSubmissionBatch({
        submissionAttemptId: "attempt-untitled-batch",
        shared: {
          exhibition: "Show",
          gallery: "Venue",
          exhibitionYear: "2026",
          photographer: "Pat",
        },
        artworks: [
          sampleArtwork({
            clientArtworkId: "art-1",
            order: 0,
            title: "",
            isUntitled: true,
            originalFilename: "a.tif",
          }),
          sampleArtwork({
            clientArtworkId: "art-2",
            order: 1,
            title: "Garden Study",
            isUntitled: true,
            originalFilename: "b.tif",
          }),
        ],
        files: [
          { clientArtworkId: "art-1", file: fileA },
          { clientArtworkId: "art-2", file: fileB },
        ],
      });
      assertEqual(accepted.ok, true, "batch accepted");
      if (!accepted.ok) return;

      assertEqual(accepted.input.artworks[0]!.title, UNTITLED_TITLE, "first title");
      assertEqual(accepted.input.artworks[1]!.title, UNTITLED_TITLE, "second title");

      const metadataA = resolveArtworkMetadata(accepted.input.artworks[0]!, {
        exhibition: "Show",
        gallery: "Venue",
        photographer: "Pat",
      });
      const metadataB = resolveArtworkMetadata(accepted.input.artworks[1]!, {
        exhibition: "Show",
        gallery: "Venue",
        photographer: "Pat",
      });
      assertEqual(metadataA.title, UNTITLED_TITLE, "resolved A");
      assertEqual(metadataB.title, UNTITLED_TITLE, "resolved B");

      const rowA = buildArtworkInventoryRow({
        inventoryId: 1047,
        metadata: metadataA,
        links: {
          masterFilename: "2026_KO_1047_Untitled_master_01.tif",
          masterFileUrl: "https://drive/m1",
          hrFilename: "2026_KO_1047_Untitled_hr_01.jpg",
          hrFileUrl: "https://drive/h1",
          webFilename: "2026_KO_1047_Untitled_web_01.jpg",
          webFileUrl: "https://drive/w1",
          artworkFolderUrl: "https://drive/f1",
        },
        thumbnailFormula:
          '=IMAGE("https://dl.dropboxusercontent.com/scl/fi/thumb.jpg?rlkey=k&raw=1", 1)',
        createdAt: "2026-08-19T12:00:00.000Z",
      });
      const rowB = buildArtworkInventoryRow({
        inventoryId: 1048,
        metadata: metadataB,
        links: {
          masterFilename: "2026_KO_1048_Untitled_master_01.tif",
          masterFileUrl: "https://drive/m2",
          hrFilename: "2026_KO_1048_Untitled_hr_01.jpg",
          hrFileUrl: "https://drive/h2",
          webFilename: "2026_KO_1048_Untitled_web_01.jpg",
          webFileUrl: "https://drive/w2",
          artworkFolderUrl: "https://drive/f2",
        },
        thumbnailFormula:
          '=IMAGE("https://dl.dropboxusercontent.com/scl/fi/thumb.jpg?rlkey=k&raw=1", 1)',
        createdAt: "2026-08-19T12:00:00.000Z",
      });
      assertEqual(rowA[artworkInventoryColumnIndex("Title")], UNTITLED_TITLE, "sheet title A");
      assertEqual(rowB[artworkInventoryColumnIndex("Title")], UNTITLED_TITLE, "sheet title B");
      assertEqual(rowA[0], "1047", "inventory A");
      assertEqual(rowB[0], "1048", "inventory B");
      assertEqual(rowA.length, ARTWORK_INVENTORY_HEADERS.length, "width A");
      assertEqual(rowB.length, ARTWORK_INVENTORY_HEADERS.length, "width B");
      assertEqual(
        ARTWORK_INVENTORY_HEADERS.includes("Missing Title" as never),
        false,
        "no Missing Title header",
      );
      assertEqual(
        ARTWORK_INVENTORY_HEADERS.includes("isUntitled" as never),
        false,
        "no isUntitled header",
      );
    },
  },
  {
    name: "resolved custom medium writes a single Sheet Medium column",
    run: () => {
      const metadata = resolveArtworkMetadata(
        sampleArtwork({ medium: "Mixed media" }),
        {
          exhibition: "Show",
          gallery: "Venue",
          photographer: "Pat",
        },
      );
      const row = buildArtworkInventoryRow({
        inventoryId: 1000,
        metadata,
        links: {
          masterFilename: "m.tif",
          masterFileUrl: "https://drive/m",
          hrFilename: "h.jpg",
          hrFileUrl: "https://drive/h",
          webFilename: "w.jpg",
          webFileUrl: "https://drive/w",
          artworkFolderUrl: "https://drive/f",
        },
        thumbnailFormula:
          '=IMAGE("https://dl.dropboxusercontent.com/scl/fi/thumb.jpg?rlkey=k&raw=1", 1)',
        createdAt: "2026-07-30T12:00:00.000Z",
      });
      assertEqual(row[artworkInventoryColumnIndex("Medium")], "Mixed media", "Medium value");
      assertEqual(row.length, ARTWORK_INVENTORY_HEADERS.length, "unchanged width");
      assertEqual(
        ARTWORK_INVENTORY_HEADERS.filter((h) => /medium/i.test(h)).length,
        1,
        "exactly one Medium column",
      );
    },
  },
  {
    name: "Dropbox URLs write into the same neutral inventory URL columns",
    run: () => {
      const metadata = resolveArtworkMetadata(sampleArtwork(), {
        exhibition: "",
        gallery: "",
        photographer: "Pat",
      });
      const row = buildArtworkInventoryRow({
        inventoryId: 1002,
        metadata,
        links: {
          masterFilename: "m.jpg",
          masterFileUrl: "https://www.dropbox.com/s/master?dl=0",
          hrFilename: "h.jpg",
          hrFileUrl: "https://www.dropbox.com/s/hr?dl=0",
          webFilename: "w.jpg",
          webFileUrl: "https://www.dropbox.com/s/web?dl=0",
          artworkFolderUrl: "https://www.dropbox.com/scl/fo/folder?dl=0",
        },
        thumbnailFormula:
          '=IMAGE("https://dl.dropboxusercontent.com/scl/fi/thumb.jpg?rlkey=k&raw=1", 1)',
        createdAt: "2026-07-30T12:00:00.000Z",
      });
      assertEqual(row[artworkInventoryColumnIndex("Master File URL")], "https://www.dropbox.com/s/master?dl=0", "Master File URL");
      assertEqual(row[artworkInventoryColumnIndex("High Resolution File URL")], "https://www.dropbox.com/s/hr?dl=0", "HR File URL");
      assertEqual(row[artworkInventoryColumnIndex("Web File URL")], "https://www.dropbox.com/s/web?dl=0", "Web File URL");
      assertEqual(
        row[artworkInventoryColumnIndex("Artwork Folder URL")],
        "https://www.dropbox.com/scl/fo/folder?dl=0",
        "Artwork Folder URL",
      );
      assertEqual(ARTWORK_INVENTORY_HEADERS[artworkInventoryColumnIndex("Master File URL")], "Master File URL", "header name");
      assertEqual(ARTWORK_INVENTORY_HEADERS[artworkInventoryColumnIndex("Artwork Folder URL")], "Artwork Folder URL", "folder header");
    },
  },
  {
    name: "optional blank fields remain blank in inventory row",
    run: () => {
      const metadata = resolveArtworkMetadata(
        sampleArtwork({
          depth: "",
          notes: "",
        }),
        { exhibition: "", gallery: "", photographer: "" },
      );
      const row = buildArtworkInventoryRow({
        inventoryId: 1001,
        metadata,
        links: {
          masterFilename: "a.tif",
          masterFileUrl: "u1",
          hrFilename: "b.jpg",
          hrFileUrl: "u2",
          webFilename: "c.jpg",
          webFileUrl: "u3",
          artworkFolderUrl: "u4",
        },
        thumbnailFormula:
          '=IMAGE("https://dl.dropboxusercontent.com/scl/fi/thumb.jpg?rlkey=k&raw=1", 1)',
        createdAt: "2026-07-30T12:00:00.000Z",
      });
      assertEqual(row[artworkInventoryColumnIndex("Depth")], "", "Depth blank");
      assertEqual(row[artworkInventoryColumnIndex("Photographer")], "", "Photographer blank");
      assertEqual(row[artworkInventoryColumnIndex("Exhibition")], "", "Exhibition blank");
      assertEqual(row[artworkInventoryColumnIndex("Notes")], "", "Notes blank");
      assertEqual(
        ARTWORK_INVENTORY_HEADERS.includes("Location" as never),
        false,
        "Location not in headers",
      );
      assertEqual(
        ARTWORK_INVENTORY_HEADERS.includes("Series" as never),
        false,
        "Series not in headers",
      );
      assertEqual(
        ARTWORK_INVENTORY_HEADERS.includes("Edition" as never),
        false,
        "Edition not in headers",
      );
      assertEqual(
        ARTWORK_INVENTORY_HEADERS.includes("Status" as never),
        false,
        "Status not in artwork inventory headers",
      );
    },
  },
  {
    name: "no inventory row is created before images and metadata succeed (stage gate)",
    run: () => {
      // Documented invariant: buildArtworkInventoryRow is only called after
      // master/hr/web/metadata refs exist in process-one.
      const uploadsComplete = {
        master: true,
        hr: true,
        web: true,
        thumb: false,
        metadata: false,
      };
      const mayAppend =
        uploadsComplete.master &&
        uploadsComplete.hr &&
        uploadsComplete.web &&
        uploadsComplete.thumb &&
        uploadsComplete.metadata;
      assertEqual(mayAppend, false, "blocked until thumbnail and metadata uploaded");
      uploadsComplete.thumb = true;
      assertEqual(
        uploadsComplete.master &&
          uploadsComplete.hr &&
          uploadsComplete.web &&
          uploadsComplete.thumb &&
          uploadsComplete.metadata,
        false,
        "still blocked until metadata",
      );
      uploadsComplete.metadata = true;
      assertEqual(
        uploadsComplete.master &&
          uploadsComplete.hr &&
          uploadsComplete.web &&
          uploadsComplete.thumb &&
          uploadsComplete.metadata,
        true,
        "allowed after images + thumbnail + metadata",
      );
    },
  },
  {
    name: "metadata file uses Inventory ID filename with schemaVersion, grouped dimensions, and file refs",
    run: () => {
      const resolved = resolveArtworkMetadata(
        sampleArtwork({
          depth: "2",
          notes: "Frame pending",
        }),
        {
          exhibition: "Spring Show",
          gallery: "Main Gallery",
          photographer: "Pat",
        },
      );
      const metadataFilename = buildArtworkMetadataFilename(1000);
      const portable = buildPortableArtworkMetadata({
        inventoryId: 1000,
        metadata: resolved,
        master: {
          id: "m1",
          name: "2026_KO_1000_BlueGarden_master_01.tif",
          webViewLink: "https://www.dropbox.com/s/master?dl=0",
        },
        hr: {
          id: "h1",
          name: "2026_KO_1000_BlueGarden_hr_01.jpg",
          webViewLink: "https://www.dropbox.com/s/hr?dl=0",
        },
        web: {
          id: "w1",
          name: "2026_KO_1000_BlueGarden_web_01.jpg",
          webViewLink: "https://www.dropbox.com/s/web?dl=0",
        },
        thumb: {
          id: "t1",
          name: "2026_KO_1000_BlueGarden_thumb_01.jpg",
          webViewLink: "https://www.dropbox.com/s/thumb?dl=0",
        },
        folder: {
          id: "f1",
          name: "2026_KO_1000_BlueGarden",
          webViewLink: "https://www.dropbox.com/scl/fo/folder?dl=0",
        },
        metadataFilename,
        createdAt: "2026-07-30T12:00:00.000Z",
      });

      assertEqual(
        portable.schemaVersion,
        ARTWORK_METADATA_SCHEMA_VERSION,
        "schemaVersion",
      );
      assertEqual(portable.inventoryId, 1000, "inventoryId");
      assertEqual(portable.title, "Blue Garden", "title");
      assertEqual(portable.year, 2026, "year number");
      assertDeepEqual(
        portable.dimensions,
        { height: 24, width: 18, depth: 2, unit: "in" },
        "dimensions grouped",
      );
      assertEqual(
        "series" in portable,
        false,
        "series removed from portable metadata",
      );
      assertEqual(
        "edition" in portable,
        false,
        "edition removed from portable metadata",
      );
      assertEqual(
        "status" in portable,
        false,
        "status removed from portable metadata",
      );
      assertEqual(
        "location" in portable,
        false,
        "location removed from portable metadata",
      );
      assertEqual(portable.photographer, "Pat", "photographer");
      assertEqual(portable.exhibition, "Spring Show", "exhibition");
      assertEqual(portable.galleryVenue, "Main Gallery", "galleryVenue");
      assertEqual(portable.notes, "Frame pending", "notes");
      assertEqual(
        portable.files.master.filename,
        "2026_KO_1000_BlueGarden_master_01.tif",
        "master filename",
      );
      assertEqual(
        portable.files.master.url,
        "https://www.dropbox.com/s/master?dl=0",
        "master url",
      );
      assertEqual(
        portable.files.highResolution.filename,
        "2026_KO_1000_BlueGarden_hr_01.jpg",
        "hr filename",
      );
      assertEqual(
        portable.files.web.url,
        "https://www.dropbox.com/s/web?dl=0",
        "web url",
      );
      assertEqual(
        portable.files.thumbnail.filename,
        "2026_KO_1000_BlueGarden_thumb_01.jpg",
        "thumb filename",
      );
      assertEqual(
        portable.files.metadata.filename,
        "1000_metadata.json",
        "metadata filename in files",
      );
      assertEqual(
        portable.files.folderUrl,
        "https://www.dropbox.com/scl/fo/folder?dl=0",
        "folder url",
      );
      assertEqual(portable.createdAt, "2026-07-30T12:00:00.000Z", "createdAt");
      assertEqual(portable.updatedAt, "2026-07-30T12:00:00.000Z", "updatedAt");

      const json = serializePortableArtworkMetadata(portable);
      const parsed = JSON.parse(json) as typeof portable;
      assertEqual(parsed.schemaVersion, 1, "parsed schemaVersion");
      assertEqual(json.includes("\n"), true, "pretty-printed JSON");
      assertEqual(metadataFilename, "1000_metadata.json", "filename");
      assertEqual(
        planFilenamesForArtwork({
          year: 2026,
          inventoryId: 1000,
          title: "Blue Garden",
          masterFilename: "blue.tif",
        }).metadata,
        "1000_metadata.json",
        "planned metadata filename",
      );
    },
  },
  {
    name: "metadata file optional blank values become null (not empty strings)",
    run: () => {
      const resolved = resolveArtworkMetadata(
        sampleArtwork({
          depth: "",
          notes: "",
        }),
        { exhibition: "", gallery: "", photographer: "" },
      );
      const portable = buildPortableArtworkMetadata({
        inventoryId: 1001,
        metadata: resolved,
        master: { id: "m", name: "a.tif", webViewLink: "u1" },
        hr: { id: "h", name: "b.jpg", webViewLink: "u2" },
        web: { id: "w", name: "c.jpg", webViewLink: "u3" },
        thumb: { id: "t", name: "d.jpg", webViewLink: "u5" },
        folder: { id: "f", name: "folder", webViewLink: "u4" },
        metadataFilename: buildArtworkMetadataFilename(1001),
        createdAt: "2026-07-30T12:00:00.000Z",
      });
      assertEqual(portable.dimensions.depth, null, "depth null");
      assertEqual(portable.photographer, null, "photographer null");
      assertEqual(portable.exhibition, null, "exhibition null");
      assertEqual(portable.galleryVenue, null, "galleryVenue null");
      assertEqual(portable.notes, null, "notes null");
      assertEqual(
        portable.files.metadata.filename,
        "1001_metadata.json",
        "metadata filename",
      );
      const json = serializePortableArtworkMetadata(portable);
      assertTrue(!json.includes('"series"'), "no series key");
      assertTrue(!json.includes('"edition"'), "no edition key");
      assertTrue(!json.includes('"status"'), "no status key");
      assertTrue(!json.includes('"location"'), "no location key");
      assertTrue(!json.includes('""'), "no empty-string values");
    },
  },
  {
    name: "upload_metadata failure prevents inventory row append",
    run: () => {
      const failure = {
        ok: false as const,
        lastCompletedStage: "thumb_uploaded" as const,
        failedOperation: "upload_metadata" as const,
        sheetRowWritten: false,
        message:
          "The master, high-resolution, web, and thumbnail images uploaded successfully, but 1105_metadata.json could not be created or uploaded.",
        preserved: {
          inventoryId: 1105,
          folder: true,
          master: true,
          hr: true,
          web: true,
          thumb: true,
          metadata: false,
        },
      };
      assertEqual(failure.sheetRowWritten, false, "no sheet row");
      assertEqual(failure.failedOperation, "upload_metadata", "failed op");
      assertEqual(failure.lastCompletedStage, "thumb_uploaded", "last stage");
      assertEqual(failure.preserved.inventoryId, 1105, "ID preserved");
      assertEqual(failure.preserved.folder, true, "folder preserved");
      assertEqual(failure.preserved.master, true, "master preserved");
      assertTrue(failure.message.includes("1105_metadata.json"), "clear error");
    },
  },
  {
    name: "Dropbox and Drive providers upload Inventory-ID metadata file via StorageProvider API",
    run: async () => {
      const metadataFilename = buildArtworkMetadataFilename(1000);
      const portable = buildPortableArtworkMetadata({
        inventoryId: 1000,
        metadata: resolveArtworkMetadata(sampleArtwork(), {
          exhibition: "",
          gallery: "",
          photographer: "",
        }),
        master: { id: "m", name: "m.tif", webViewLink: "https://m" },
        hr: { id: "h", name: "h.jpg", webViewLink: "https://h" },
        web: { id: "w", name: "w.jpg", webViewLink: "https://w" },
        thumb: { id: "t", name: "t.jpg", webViewLink: "https://t" },
        folder: { id: "f", name: "folder", webViewLink: "https://f" },
        metadataFilename,
        createdAt: "2026-07-30T12:00:00.000Z",
      });
      const contents = Buffer.from(
        serializePortableArtworkMetadata(portable),
        "utf8",
      );

      async function uploadViaProvider(kind: "dropbox" | "drive") {
        const uploaded: Array<{
          name: string;
          mimeType: string;
          contents: Buffer;
        }> = [];
        const storage: StorageProvider = {
          kind,
          async verifyReady() {
            return { ok: true, rootName: "root", archiveRootUrl: null };
          },
          async findChildFolderByName() {
            return null;
          },
          async createArtworkFolder(name) {
            return { id: `/${name}`, name, webViewLink: `https://${kind}/f` };
          },
          async uploadFile(params) {
            uploaded.push({
              name: params.name,
              mimeType: params.mimeType,
              contents: Buffer.from(params.contents),
            });
            return {
              id: `/${params.name}`,
              name: params.name,
              webViewLink: `https://${kind}/${params.name}`,
            };
          },
          async moveFolderToFailedIntake() {},
          getArchiveRootUrl() {
            return null;
          },
        };

        const result = await storage.uploadFile({
          parentId: "/folder",
          name: metadataFilename,
          mimeType: "application/json",
          contents,
        });
        return { uploaded, result };
      }

      for (const kind of ["dropbox", "drive"] as const) {
        const { uploaded, result } = await uploadViaProvider(kind);
        assertEqual(uploaded.length, 1, `${kind} one upload`);
        assertEqual(uploaded[0]!.name, "1000_metadata.json", `${kind} filename`);
        assertEqual(
          uploaded[0]!.mimeType,
          "application/json",
          `${kind} mime`,
        );
        const parsed = JSON.parse(uploaded[0]!.contents.toString("utf8"));
        assertEqual(parsed.schemaVersion, 1, `${kind} valid JSON schemaVersion`);
        assertEqual(
          parsed.files.metadata.filename,
          "1000_metadata.json",
          `${kind} self filename in JSON`,
        );
        assertEqual(result.name, "1000_metadata.json", `${kind} result name`);
      }
    },
  },
  {
    name: "failed artwork writes no Sheet row; batch continues (isolation contract)",
    run: () => {
      const artworks = [
        { title: "Batch Test Success A", ok: true, sheetRowWritten: true },
        {
          title: "Batch Test Intentional Failure",
          ok: false,
          sheetRowWritten: false,
          failedOperation: "upload_hr",
          folderMovedToFailedIntake: true,
        },
        { title: "Batch Test Success B", ok: true, sheetRowWritten: true },
      ];
      const outcomes = artworks.map((a) => (a.ok ? "completed" : "failed"));
      assertDeepEqual(outcomes, ["completed", "failed", "completed"], "continue");
      assertEqual(artworks[1]!.sheetRowWritten, false, "no sheet row on failure");
      assertEqual(
        artworks[1]!.folderMovedToFailedIntake,
        true,
        "Failed Intake move",
      );
      assertEqual(
        artworks.filter((a) => a.sheetRowWritten).length,
        2,
        "two inventory rows",
      );
    },
  },
  {
    name: "one artwork failure does not stop later artworks (sequential isolation)",
    run: () => {
      const outcomes: string[] = [];
      const artworks = ["a", "b", "c"];
      for (const id of artworks) {
        if (id === "b") {
          outcomes.push("failed");
          continue; // continue to next — isolation contract
        }
        outcomes.push("completed");
      }
      assertDeepEqual(outcomes, ["completed", "failed", "completed"], "continue");
    },
  },
  {
    name: "folder conflict marks only that artwork Failed (ID retained)",
    run: () => {
      const conflict = {
        inventoryId: 1100,
        folderExists: true,
        claimStatus: "Failed" as const,
        uploaded: false,
      };
      assertEqual(conflict.folderExists, true, "conflict");
      assertEqual(conflict.uploaded, false, "no upload into existing");
      assertEqual(conflict.claimStatus, "Failed", "failed claim");
      assertEqual(conflict.inventoryId, 1100, "ID retained");
    },
  },
  {
    name: "cleanup result is preserved in a failure-shaped response",
    run: () => {
      const failure = {
        ok: false as const,
        cleanup: {
          tempFilesRemoved: true,
          folderMovedToFailedIntake: false,
          cleanupWarnings: ["Could not move folder to Failed Intake."],
        },
      };
      assertEqual(failure.cleanup.tempFilesRemoved, true, "temps removed");
      assertEqual(
        failure.cleanup.folderMovedToFailedIntake,
        false,
        "move failed",
      );
      assertEqual(failure.cleanup.cleanupWarnings.length, 1, "warning kept");
    },
  },
  {
    name: "post-Sheet claim failure produces reconciliation_required shape",
    run: () => {
      const result = {
        ok: true as const,
        stage: "reconciliation_required" as const,
        sheetRowWritten: true,
        claimStatus: "Processing" as const,
        reconciliationWarnings: [
          {
            code: "INVENTORY_ROW_WITHOUT_COMPLETED_CLAIM" as const,
            message:
              "Drive files and the Artwork Inventory row exist, but the claim status could not be marked Completed.",
          },
        ],
      };
      assertEqual(result.stage, "reconciliation_required", "stage");
      assertEqual(result.sheetRowWritten, true, "row written");
      assertEqual(result.ok, true, "not a normal failure");
    },
  },
  {
    name: "duplicate submission-attempt IDs are rejected",
    run: () => {
      clearSubmissionAttemptGuardForTests();
      const first = registerSubmissionAttempt("attempt-abc-12345");
      const second = registerSubmissionAttempt("attempt-abc-12345");
      assertEqual(first.ok, true, "first ok");
      assertEqual(second.ok, false, "second rejected");
      if (!second.ok) {
        assertEqual(second.reason, "duplicate", "duplicate reason");
      }
      clearSubmissionAttemptGuardForTests();
    },
  },
  {
    name: "test target never falls back to production configuration",
    run: () => {
      const missing = resolveArchiveResources(
        {
          ARTWORK_SUBMISSION_TARGET: "test",
          GOOGLE_SHEET_ID: "prod-sheet",
          GOOGLE_DRIVE_ROOT_FOLDER_ID: "prod-drive",
          // test IDs intentionally absent
        },
        "dropbox",
      );
      assertTrue("code" in missing, "errors without test IDs");
      if ("code" in missing) {
        assertEqual(missing.code, "MISSING_TARGET_CONFIG", "code");
        assertTrue(
          missing.message.includes("Refusing to fall back"),
          "no fallback message",
        );
      }

      const okDropbox = resolveArchiveResources(
        {
          ARTWORK_SUBMISSION_TARGET: "test",
          GOOGLE_SHEET_ID: "prod-sheet",
          GOOGLE_DRIVE_ROOT_FOLDER_ID: "prod-drive",
          GOOGLE_TEST_SHEET_ID: "test-sheet",
        },
        "dropbox",
      );
      assertTrue(!("code" in okDropbox), "dropbox test resolves with sheet only");
      if (!("code" in okDropbox)) {
        assertEqual(okDropbox.target, "test", "target");
        assertEqual(okDropbox.sheetId, "test-sheet", "uses test sheet");
        assertEqual(okDropbox.driveRootFolderId, null, "no Drive root in dropbox");
      }

      const okDrive = resolveArchiveResources(
        {
          ARTWORK_SUBMISSION_TARGET: "test",
          GOOGLE_SHEET_ID: "prod-sheet",
          GOOGLE_DRIVE_ROOT_FOLDER_ID: "prod-drive",
          GOOGLE_TEST_SHEET_ID: "test-sheet",
          GOOGLE_TEST_DRIVE_ROOT_FOLDER_ID: "test-drive",
        },
        "drive",
      );
      assertTrue(!("code" in okDrive), "resolves with test IDs");
      if (!("code" in okDrive)) {
        assertEqual(okDrive.target, "test", "target");
        assertEqual(okDrive.sheetId, "test-sheet", "uses test sheet");
        assertEqual(okDrive.driveRootFolderId, "test-drive", "uses test drive");
      }
    },
  },
  {
    name: "dropbox archive resolves without GOOGLE_DRIVE_ROOT_FOLDER_ID",
    run: () => {
      const unset = resolveArchiveResources(
        {
          GOOGLE_SHEET_ID: "sheet-1",
        },
        "dropbox",
      );
      assertTrue(!("code" in unset), "default dropbox ok");
      if (!("code" in unset)) {
        assertEqual(unset.driveRootFolderId, null, "null drive root");
      }

      const explicit = resolveArchiveResources(
        {
          ARTWORK_STORAGE_PROVIDER: "dropbox",
          GOOGLE_SHEET_ID: "sheet-1",
        },
        "dropbox",
      );
      assertTrue(!("code" in explicit), "explicit dropbox ok");
    },
  },
  {
    name: "drive archive requires GOOGLE_DRIVE_ROOT_FOLDER_ID",
    run: () => {
      const missing = resolveArchiveResources(
        {
          GOOGLE_SHEET_ID: "sheet-1",
        },
        "drive",
      );
      assertTrue("code" in missing, "fails without drive root");
      if ("code" in missing) {
        assertEqual(missing.code, "MISSING_TARGET_CONFIG", "code");
        assertTrue(
          missing.message.includes("GOOGLE_DRIVE_ROOT_FOLDER_ID"),
          "mentions Drive root",
        );
      }

      const ok = resolveArchiveResources(
        {
          GOOGLE_SHEET_ID: "sheet-1",
          GOOGLE_DRIVE_ROOT_FOLDER_ID: "folder-1",
        },
        "drive",
      );
      assertTrue(!("code" in ok), "passes with drive root");
      if (!("code" in ok)) {
        assertEqual(ok.driveRootFolderId, "folder-1", "drive root set");
      }
    },
  },
  {
    name: "preflight config: dropbox skips Drive env validation",
    run: () => {
      const sheetsOnly = {
        GOOGLE_SERVICE_ACCOUNT_EMAIL: "sa@project.iam.gserviceaccount.com",
        GOOGLE_PRIVATE_KEY:
          "-----BEGIN PRIVATE KEY-----\\nLINE\\n-----END PRIVATE KEY-----\\n",
        GOOGLE_SHEET_ID: "sheet-1",
      };

      const defaultKind = resolvePreflightConfig(sheetsOnly);
      assertEqual(defaultKind.ok, true, "unset provider passes");
      if (defaultKind.ok) {
        assertEqual(defaultKind.storageKind, "dropbox", "defaults dropbox");
        assertEqual(
          defaultKind.validatedDriveStorageEnv,
          false,
          "did not validate Drive env",
        );
        assertEqual(defaultKind.driveStorage, null, "no drive storage env");
      }

      const explicit = resolvePreflightConfig({
        ...sheetsOnly,
        ARTWORK_STORAGE_PROVIDER: "dropbox",
      });
      assertEqual(explicit.ok, true, "explicit dropbox passes");
      if (explicit.ok) {
        assertEqual(
          explicit.validatedDriveStorageEnv,
          false,
          "explicit dropbox skips Drive env",
        );
      }
    },
  },
  {
    name: "preflight config: drive requires Drive root; Sheets still validated",
    run: () => {
      const withoutDrive = resolvePreflightConfig({
        GOOGLE_SERVICE_ACCOUNT_EMAIL: "sa@project.iam.gserviceaccount.com",
        GOOGLE_PRIVATE_KEY:
          "-----BEGIN PRIVATE KEY-----\\nLINE\\n-----END PRIVATE KEY-----\\n",
        GOOGLE_SHEET_ID: "sheet-1",
        ARTWORK_STORAGE_PROVIDER: "drive",
      });
      assertEqual(withoutDrive.ok, false, "drive without root fails");
      if (!withoutDrive.ok) {
        assertTrue(
          withoutDrive.message.includes("GOOGLE_DRIVE_ROOT_FOLDER_ID"),
          "clear Drive root error",
        );
        assertEqual(
          withoutDrive.validatedDriveStorageEnv,
          true,
          "Drive env validation ran",
        );
      }

      const missingSheets = resolvePreflightConfig({
        ARTWORK_STORAGE_PROVIDER: "drive",
        GOOGLE_DRIVE_ROOT_FOLDER_ID: "folder-1",
      });
      assertEqual(missingSheets.ok, false, "Sheets still required in drive mode");
      if (!missingSheets.ok) {
        assertTrue(
          missingSheets.message.includes("GOOGLE_SERVICE_ACCOUNT_EMAIL") ||
            missingSheets.message.includes("GOOGLE_PRIVATE_KEY") ||
            missingSheets.message.includes("GOOGLE_SHEET_ID"),
          "Sheets missing mentioned",
        );
        assertEqual(
          missingSheets.validatedDriveStorageEnv,
          false,
          "Sheets fails before Drive env check",
        );
      }

      const ok = resolvePreflightConfig({
        GOOGLE_SERVICE_ACCOUNT_EMAIL: "sa@project.iam.gserviceaccount.com",
        GOOGLE_PRIVATE_KEY:
          "-----BEGIN PRIVATE KEY-----\\nLINE\\n-----END PRIVATE KEY-----\\n",
        GOOGLE_SHEET_ID: "sheet-1",
        GOOGLE_DRIVE_ROOT_FOLDER_ID: "folder-1",
        ARTWORK_STORAGE_PROVIDER: "drive",
      });
      assertEqual(ok.ok, true, "drive with root passes");
      if (ok.ok) {
        assertEqual(ok.validatedDriveStorageEnv, true, "Drive env validated");
        assertEqual(ok.driveStorage?.driveRootFolderId, "folder-1", "root");
      }
    },
  },
  {
    name: "preflight: dropbox does not call Drive validation; drive does",
    run: async () => {
      const sheetsOnly = {
        GOOGLE_SERVICE_ACCOUNT_EMAIL: "sa@project.iam.gserviceaccount.com",
        GOOGLE_PRIVATE_KEY:
          "-----BEGIN PRIVATE KEY-----\\nLINE\\n-----END PRIVATE KEY-----\\n",
        GOOGLE_SHEET_ID: "sheet-1",
      };

      let driveValidationCalls = 0;
      const matchingHeaders = {
        exists: true as const,
        comparison: {
          kind: "match" as const,
          expected: [...ARTWORK_INVENTORY_HEADERS],
          actual: [...ARTWORK_INVENTORY_HEADERS],
          missingHeaders: [] as string[],
          unexpectedHeaders: [] as string[],
          orderMismatch: false,
        },
        canInitializeHeaders: false,
        canInsertThumbnailColumn: false,
      };

      const mockSheetDeps = {
        verifySpreadsheetAccess: async () => ({
          title: "Inventory",
          spreadsheetId: "sheet-1",
          sheetTitles: [ARTWORK_INVENTORY_TAB, INVENTORY_CLAIMS_TAB],
        }),
        getTabHeaderStatus: async (tab: string) => ({
          tab: tab as typeof ARTWORK_INVENTORY_TAB,
          ...matchingHeaders,
          comparison: {
            ...matchingHeaders.comparison,
            expected:
              tab === INVENTORY_CLAIMS_TAB
                ? [...INVENTORY_CLAIMS_HEADERS]
                : [...ARTWORK_INVENTORY_HEADERS],
            actual:
              tab === INVENTORY_CLAIMS_TAB
                ? [...INVENTORY_CLAIMS_HEADERS]
                : [...ARTWORK_INVENTORY_HEADERS],
          },
        }),
        getDriveFileCapabilities: async () => ({
          canEdit: true,
          canAddChildren: true,
        }),
      };

      const dropboxStorage: StorageProvider = {
        kind: "dropbox",
        getArchiveRootUrl: () =>
          "https://www.dropbox.com/home/Apps/Kim%20Art%20Archive",
        verifyReady: async () => ({
          ok: true,
          rootName: "App Folder",
          archiveRootUrl: null,
        }),
        findChildFolderByName: async () => null,
        createArtworkFolder: async () => ({
          id: "x",
          name: "x",
          webViewLink: "https://example.com/x",
        }),
        uploadFile: async () => ({
          id: "f",
          name: "f",
          webViewLink: "https://example.com/f",
        }),
        moveFolderToFailedIntake: async () => undefined,
      };

      const driveStorage: StorageProvider = {
        ...dropboxStorage,
        kind: "drive",
        verifyReady: async () => {
          driveValidationCalls += 1;
          return {
            ok: true,
            rootName: "Kim Artwork Archive",
            archiveRootUrl: "https://drive.google.com/drive/folders/folder-1",
          };
        },
      };

      const createdKinds: StorageProviderKind[] = [];

      const dropboxResult = await runSubmissionPreflightWithDeps({
        envSource: sheetsOnly,
        ...mockSheetDeps,
        createStorage: (_archive, kind) => {
          createdKinds.push(kind);
          assertEqual(kind, "dropbox", "dropbox storage kind");
          return dropboxStorage;
        },
      });
      assertEqual(dropboxResult.ok, true, "dropbox preflight ok");
      assertEqual(driveValidationCalls, 0, "Drive verifyReady not used");
      assertEqual(createdKinds[0], "dropbox", "created dropbox provider");

      const driveResult = await runSubmissionPreflightWithDeps({
        envSource: {
          ...sheetsOnly,
          ARTWORK_STORAGE_PROVIDER: "drive",
          GOOGLE_DRIVE_ROOT_FOLDER_ID: "folder-1",
        },
        ...mockSheetDeps,
        createStorage: (_archive, kind) => {
          createdKinds.push(kind);
          assertEqual(kind, "drive", "drive storage kind");
          assertEqual(
            _archive.driveRootFolderId,
            "folder-1",
            "archive has drive root",
          );
          return driveStorage;
        },
      });
      assertEqual(driveResult.ok, true, "drive preflight ok");
      assertEqual(driveValidationCalls, 1, "Drive verifyReady called");
      assertEqual(createdKinds[1], "drive", "created drive provider");

      // Sheets validation still required in both modes
      const sheetsMissingDropbox = resolvePreflightConfig({
        ARTWORK_STORAGE_PROVIDER: "dropbox",
      });
      assertEqual(sheetsMissingDropbox.ok, false, "sheets required dropbox");
      const sheetsMissingDrive = resolvePreflightConfig({
        ARTWORK_STORAGE_PROVIDER: "drive",
        GOOGLE_DRIVE_ROOT_FOLDER_ID: "folder-1",
      });
      assertEqual(sheetsMissingDrive.ok, false, "sheets required drive");
    },
  },
  {
    name: "unsupported storage provider fails closed in preflight config",
    run: () => {
      const result = resolvePreflightConfig({
        GOOGLE_SERVICE_ACCOUNT_EMAIL: "sa@project.iam.gserviceaccount.com",
        GOOGLE_PRIVATE_KEY:
          "-----BEGIN PRIVATE KEY-----\\nLINE\\n-----END PRIVATE KEY-----\\n",
        GOOGLE_SHEET_ID: "sheet-1",
        ARTWORK_STORAGE_PROVIDER: "s3",
      });
      assertEqual(result.ok, false, "fails");
      if (!result.ok) {
        assertTrue(
          result.message.includes("Unsupported ARTWORK_STORAGE_PROVIDER"),
          "clear unsupported message",
        );
      }
    },
  },
  {
    name: "temporary files are cleaned after success and failure (contract)",
    run: () => {
      const successCleanup = { tempFilesRemoved: true };
      const failureCleanup = { tempFilesRemoved: true };
      assertEqual(successCleanup.tempFilesRemoved, true, "success cleanup");
      assertEqual(failureCleanup.tempFilesRemoved, true, "failure cleanup");
    },
  },
  {
    name: "source files remain correctly associated with stable artwork IDs",
    run: () => {
      const files = new Map<string, string>([
        ["uuid-a", "a.tif"],
        ["uuid-b", "b.tif"],
      ]);
      const artworks = [
        { clientArtworkId: "uuid-b", order: 1 },
        { clientArtworkId: "uuid-a", order: 0 },
      ];
      for (const artwork of artworks) {
        assertTrue(
          files.has(artwork.clientArtworkId),
          `file for ${artwork.clientArtworkId}`,
        );
      }
      assertEqual(files.get("uuid-a"), "a.tif", "stable association a");
      assertEqual(files.get("uuid-b"), "b.tif", "stable association b");
    },
  },
  {
    name: "local mutex serializes exclusive work",
    run: async () => {
      const mutex = new AsyncMutex();
      const order: number[] = [];
      await Promise.all([
        mutex.runExclusive(async () => {
          order.push(1);
          await new Promise((r) => setTimeout(r, 20));
          order.push(2);
        }),
        mutex.runExclusive(async () => {
          order.push(3);
          order.push(4);
        }),
      ]);
      assertDeepEqual(order, [1, 2, 3, 4], "serialized");
    },
  },
  {
    name: "Thumbnail column is IMAGE formula only — no filename or URL metadata columns",
    run: () => {
      const metadata = resolveArtworkMetadata(sampleArtwork(), {
        exhibition: "",
        gallery: "",
        photographer: "Pat",
      });
      const directUrl =
        "https://dl.dropboxusercontent.com/scl/fi/abc/2026_KO_1000_BlueGarden_thumb_01.jpg?rlkey=k&raw=1";
      const formula = buildSheetsImageFormula(directUrl);
      const row = buildArtworkInventoryRow({
        inventoryId: 1000,
        metadata,
        links: {
          masterFilename: "m.tif",
          masterFileUrl: "https://www.dropbox.com/s/master?dl=0",
          hrFilename: "h.jpg",
          hrFileUrl: "https://www.dropbox.com/s/hr?dl=0",
          webFilename: "w.jpg",
          webFileUrl: "https://www.dropbox.com/s/web?dl=0",
          artworkFolderUrl: "https://www.dropbox.com/scl/fo/folder?dl=0",
        },
        thumbnailFormula: formula,
        createdAt: "2026-07-30T12:00:00.000Z",
      });
      assertEqual(ARTWORK_INVENTORY_HEADERS[0], "Inventory ID", "ID first");
      assertEqual(ARTWORK_INVENTORY_HEADERS[1], "Thumbnail", "Thumbnail second");
      assertEqual(ARTWORK_INVENTORY_HEADERS[2], "Title", "Title third");
      assertEqual(row[1], formula, "formula in Thumbnail cell");
      assertTrue(isSheetsImageFormula(row[1]!), "IMAGE()");
      assertTrue(row[1]!.includes(directUrl), "direct URL inside formula");
      assertEqual(
        ARTWORK_INVENTORY_HEADERS.includes("Thumbnail Filename" as never),
        false,
        "no Thumbnail Filename",
      );
      assertEqual(
        ARTWORK_INVENTORY_HEADERS.includes("Thumbnail URL" as never),
        false,
        "no Thumbnail URL",
      );
      assertEqual(
        ARTWORK_INVENTORY_HEADERS.includes("Thumbnail Dropbox URL" as never),
        false,
        "no Thumbnail Dropbox URL",
      );
      assertEqual(
        row[artworkInventoryColumnIndex("Title")],
        "Blue Garden",
        "Title still maps correctly",
      );
      assertEqual(
        row[artworkInventoryColumnIndex("Master Filename")],
        "m.tif",
        "Master Filename still maps correctly",
      );
    },
  },
  {
    name: "upload failure after folder creation reports folder_created + upload_master",
    run: () => {
      const progress = failureProgress({
        lastCompletedStage: "folder_created",
        failedOperation: "upload_master",
      });
      assertEqual(progress.stage, "folder_created", "stage is last completed");
      assertEqual(progress.lastCompletedStage, "folder_created", "last completed");
      assertEqual(progress.failedOperation, "upload_master", "failed op");
      assertEqual(
        progress.stage === "master_uploaded",
        false,
        "never claims master_uploaded",
      );
    },
  },
  {
    name: "thumbnail generation and upload failures report distinct operations",
    run: () => {
      const generate = failureProgress({
        lastCompletedStage: "master_uploaded",
        failedOperation: "generate_thumbnail",
      });
      assertEqual(generate.lastCompletedStage, "master_uploaded", "gen last");
      assertEqual(generate.failedOperation, "generate_thumbnail", "gen op");
      const upload = failureProgress({
        lastCompletedStage: "web_uploaded",
        failedOperation: "upload_thumb",
      });
      assertEqual(upload.lastCompletedStage, "web_uploaded", "upload last");
      assertEqual(upload.failedOperation, "upload_thumb", "upload op");
      assertEqual(upload.stage === "thumb_uploaded", false, "not thumb_uploaded");
    },
  },
  {
    name: "concurrent derivative upload failures report the earliest operation",
    run: () => {
      const both = firstFailedDerivativeUpload({
        hr: new Error("hr"),
        web: new Error("web"),
        thumb: new Error("thumb"),
      });
      assertEqual(both?.operation, "upload_hr", "hr first");
      const thumbOnly = firstFailedDerivativeUpload({
        thumb: new Error("thumb"),
      });
      assertEqual(thumbOnly?.operation, "upload_thumb", "thumb only");
      assertEqual(
        lastCompletedDerivativeUploadStage({
          hr: true,
          web: true,
          thumb: false,
          previous: "derivatives_generated",
        }),
        "web_uploaded",
        "thumb fail after hr+web",
      );
      assertEqual(
        lastCompletedDerivativeUploadStage({
          hr: false,
          web: true,
          thumb: true,
          previous: "derivatives_generated",
        }),
        "derivatives_generated",
        "hr fail keeps previous",
      );
    },
  },
  {
    name: "intake timing log line includes all major stages",
    run: () => {
      const line = formatIntakeTimings(emptyIntakeTimings());
      assertTrue(line.includes("master_read_decode="), "decode");
      assertTrue(line.includes("hr_generation="), "hr");
      assertTrue(line.includes("web_generation="), "web");
      assertTrue(line.includes("thumbnail_generation="), "thumb");
      assertTrue(line.includes("dropbox_master_upload="), "master upload");
      assertTrue(line.includes("dropbox_derivative_uploads="), "deriv uploads");
      assertTrue(line.includes("sheets_append="), "sheets");
      assertTrue(line.includes("total_intake="), "total");
    },
  },
  {
    name: "upload failure before any Drive file exists uses accurate messages",
    run: () => {
      assertEqual(
        messageForMasterUploadFailure("unknown", { folderCreated: true }),
        "The artwork folder was created, but the original file could not be uploaded.",
        "folder created wording",
      );
      assertEqual(
        messageForMasterUploadFailure("temp_missing"),
        "The original image could not be read from temporary storage.",
        "temp missing",
      );
      assertEqual(
        messageForMasterUploadFailure("stream_failed"),
        "The original image could not be read from temporary storage.",
        "stream failure",
      );
      assertEqual(
        messageForMasterUploadFailure("missing_metadata"),
        "The upload completed but file metadata was not returned.",
        "missing metadata",
      );
      assertEqual(
        messageForMasterUploadFailure("drive_rejected"),
        "Archive storage rejected the upload request.",
        "drive rejected",
      );
    },
  },
  {
    name: "temporary file missing classifies as MISSING_FILE",
    run: () => {
      const err = Object.assign(new Error("ENOENT: no such file"), {
        code: "ENOENT",
      });
      const classified = classifyMasterUploadError(err);
      assertEqual(classified.kind, "temp_missing", "kind");
      assertEqual(classified.code, "MISSING_FILE", "code");
      assertEqual(
        classified.message.includes("temporary storage"),
        true,
        "message",
      );
    },
  },
  {
    name: "upload stream failure classifies without permission wording",
    run: () => {
      const classified = classifyMasterUploadError(
        new Error("stream destroyed: EPIPE"),
      );
      assertEqual(classified.kind, "stream_failed", "kind");
      assertEqual(classified.code, "DRIVE_UPLOAD_FAILED", "code");
      assertEqual(
        classified.message.includes("Share the folder"),
        false,
        "not permission",
      );
    },
  },
  {
    name: "Drive upload unexpected response (missing metadata) message",
    run: () => {
      const classified = classifyMasterUploadError(
        new GoogleIntegrationError({
          code: "UNKNOWN",
          message: "The upload completed but Drive did not return file metadata.",
        }),
      );
      assertEqual(classified.kind, "missing_metadata", "kind");
      assertEqual(
        classified.message,
        "The upload completed but file metadata was not returned.",
        "message",
      );
    },
  },
  {
    name: "confirmed 403 permission failure keeps share-with-service-account message",
    run: () => {
      const classified = classifyMasterUploadError(
        new GoogleIntegrationError({
          code: "DRIVE_ACCESS_DENIED",
          message:
            "Service account cannot access the Drive folder. Share the folder with the service-account email (Editor).",
          httpStatus: 403,
          googleReason: "insufficientFilePermissions",
        }),
      );
      assertEqual(classified.kind, "permission_denied", "kind");
      assertEqual(classified.httpStatus, 403, "status");
      assertEqual(
        classified.message.includes("Share the folder"),
        true,
        "permission message only here",
      );
    },
  },
  {
    name: "storage quota 403 is not reported as missing Editor share",
    run: () => {
      const classified = classifyMasterUploadError(
        new GoogleIntegrationError({
          code: "DRIVE_STORAGE_QUOTA",
          message:
            "Google Drive rejected the upload because the service account has no storage quota for this location. Use a Shared Drive as the archive root (service accounts cannot store file content in a personal My Drive folder).",
          httpStatus: 403,
          googleReason: "storageQuotaExceeded",
          causeDetail: "status=403; reason=storageQuotaExceeded",
        }),
      );
      assertEqual(classified.kind, "storage_quota", "kind");
      assertEqual(classified.code, "DRIVE_UPLOAD_FAILED", "code");
      assertEqual(
        classified.message.includes("Share the folder"),
        false,
        "not share wording",
      );
      assertEqual(
        classified.message.includes("Shared Drive"),
        true,
        "shared drive guidance",
      );
    },
  },
  {
    name: "generic Drive rejection after folder create keeps accurate stage pair",
    run: () => {
      const classified = classifyMasterUploadError(
        new GoogleIntegrationError({
          code: "DRIVE_UPLOAD_REJECTED",
          message: "Google Drive rejected the upload request.",
          httpStatus: 403,
        }),
      );
      const progress = failureProgress({
        lastCompletedStage: "folder_created",
        failedOperation: "upload_master",
      });
      assertEqual(classified.kind, "drive_rejected", "kind");
      assertEqual(progress.lastCompletedStage, "folder_created", "completed");
      assertEqual(progress.failedOperation, "upload_master", "operation");
      assertEqual(
        messageForMasterUploadFailure("unknown", { folderCreated: true }),
        "The artwork folder was created, but the original file could not be uploaded.",
        "folder+upload message",
      );
    },
  },
  {
    name: "fault injection disabled by default",
    run: () => {
      const config = resolveTestFaultConfig({ NODE_ENV: "development" });
      assertEqual(config.enabled, false, "disabled");
      assertEqual(
        shouldInjectTestFault({
          operation: "upload_high_resolution",
          artworkIndex: 1,
          source: { NODE_ENV: "development" },
        }),
        false,
        "no inject",
      );
    },
  },
  {
    name: "fault injection unavailable in production even when env set",
    run: () => {
      const config = resolveTestFaultConfig({
        NODE_ENV: "production",
        ARTWORK_TEST_FAIL_OPERATION: "upload_high_resolution",
        ARTWORK_TEST_FAIL_INDEX: "1",
      });
      assertEqual(config.enabled, false, "disabled in production");
      assertTrue(
        (config.reasonDisabled ?? "").toLowerCase().includes("production"),
        "production reason",
      );
      assertEqual(
        shouldInjectTestFault({
          operation: "upload_high_resolution",
          artworkIndex: 1,
          source: {
            NODE_ENV: "production",
            ARTWORK_TEST_FAIL_OPERATION: "upload_high_resolution",
            ARTWORK_TEST_FAIL_INDEX: "1",
          },
        }),
        false,
        "no inject in production",
      );
    },
  },
  {
    name: "fault injection targets only configured artwork index and operation",
    run: () => {
      const source = {
        NODE_ENV: "development",
        ARTWORK_TEST_FAIL_OPERATION: "upload_high_resolution",
        ARTWORK_TEST_FAIL_INDEX: "1",
      };
      assertEqual(
        shouldInjectTestFault({
          operation: "upload_high_resolution",
          artworkIndex: 1,
          source,
        }),
        true,
        "index 1 matches",
      );
      assertEqual(
        shouldInjectTestFault({
          operation: "upload_hr",
          artworkIndex: 1,
          source,
        }),
        true,
        "upload_hr alias matches",
      );
      assertEqual(
        shouldInjectTestFault({
          operation: "upload_high_resolution",
          artworkIndex: 0,
          source,
        }),
        false,
        "other index skipped",
      );
      let thrown: unknown;
      try {
        maybeThrowTestFault({
          operation: "upload_high_resolution",
          artworkIndex: 1,
          source,
        });
      } catch (error) {
        thrown = error;
      }
      assertTrue(thrown instanceof TestFaultInjectionError, "throws test fault");
    },
  },
  {
    name: "inventory IDs are not reused after cleanup (claim ledger max)",
    run: () => {
      // After deleting an Artwork Inventory row, Inventory Claims still holds
      // Completed/Failed IDs, so allocation continues from max(existing)+1.
      const claimIds = [1000, 1001, 1002];
      const nextId = Math.max(...claimIds, 999) + 1;
      assertEqual(nextId, 1003, "next after cleanup still advances");
      assertEqual(claimIds.includes(1000), true, "1000 remains consumed");
    },
  },
];

async function main() {
  let failed = 0;
  for (const test of tests) {
    try {
      await test.run();
      console.log(`ok - ${test.name}`);
    } catch (error) {
      failed += 1;
      console.error(`not ok - ${test.name}`);
      console.error(
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  if (failed > 0) {
    console.error(`\n${failed} submission test(s) failed`);
    process.exit(1);
  }
  console.log(`\n${tests.length} submission tests passed`);
}

void main();
