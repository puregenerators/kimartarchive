/**
 * Batch upload / artwork-draft helpers.
 * Run: npx tsx lib/artwork/batch.test.ts
 */

import {
  appendFilesToBatch,
  artworkNeedsMetadata,
  clearProcessingForArtwork,
  fileIdentityKey,
  removeArtworkFromList,
  reorderArtworks,
  replaceArtworkImage,
  suggestTitleFromFilename,
  totalBatchBytes,
} from "./batch-files";
import {
  MAX_ARTWORKS_PER_BATCH,
  MAX_BATCH_BYTES,
  MAX_FILE_BYTES,
  remainingArtworkSlots,
  APPLYABLE_SHARED_FIELDS,
  applySharedDetailsToArtworks,
  createEmptyBatch,
  createArtworkDraft,
  type ArtworkDraft,
  type BatchSharedDetails,
} from "./types";
import {
  formatDimensions,
  hasBatchErrors,
  validateArtworkDraft,
  validateBatch,
} from "./validation";
import {
  deriveMediumChoice,
  deriveCustomMedium,
  resolveMediumValue,
  validateMediumValue,
} from "./medium";
import { batchDraftToSubmissionPayload } from "@/lib/submission/validate-input";
import { buildArtworkInventoryRow } from "@/lib/submission/inventory-row";
import { resolveArtworkMetadata } from "@/lib/submission/claim-logic";
import { ARTWORK_INVENTORY_HEADERS, artworkInventoryColumnIndex } from "@/lib/google/headers";
import { planFilenamesForArtwork } from "./filenames";
import {
  UNTITLED_TITLE,
  applyUntitledToSelectedArtworks,
  resolveArtworkTitle,
  setArtworkUntitled,
} from "./untitled";

type TestCase = {
  name: string;
  run: () => void;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(
      `${message}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`,
    );
  }
}

function makeFile(
  name: string,
  options?: { size?: number; type?: string; lastModified?: number },
): File {
  const size = options?.size ?? 1024;
  const buffer = new Uint8Array(Math.min(size, 64));
  const file = new File([buffer], name, {
    type: options?.type ?? "image/jpeg",
    lastModified: options?.lastModified ?? 1_700_000_000_000,
  });
  // Node's File may not honor byteLength from a smaller buffer; override size
  // for validation tests when needed via Object.defineProperty.
  if (size !== file.size) {
    Object.defineProperty(file, "size", { value: size });
  }
  return file;
}

function sharedDefaults(
  overrides?: Partial<BatchSharedDetails>,
): BatchSharedDetails {
  return {
    exhibition: "Spring Show",
    gallery: "Main Gallery",
    exhibitionYear: "2026",
    defaultArtworkYear: "2026",
    photographer: "Kim",
    defaultMedium: "Monotype",
    defaultDimensionUnit: "in",
    ...overrides,
  };
}

const tests: TestCase[] = [
  {
    name: "suggestTitleFromFilename replaces separators and title-cases",
    run: () => {
      assertEqual(
        suggestTitleFromFilename("Tulip-Tree.tif").title,
        "Tulip Tree",
        "hyphen",
      );
      assertEqual(
        suggestTitleFromFilename("Blue_Garden.jpg").title,
        "Blue Garden",
        "underscore",
      );
      assertEqual(
        suggestTitleFromFilename("KO_Blue_Garden.tif").title,
        "Blue Garden",
        "strips KO prefix",
      );
      assertEqual(
        suggestTitleFromFilename("KO_Blue_Garden.tif").removedArtistAlias,
        true,
        "alias removed flag",
      );
      assertEqual(
        suggestTitleFromFilename("123_Osgood_OpenSpace.tif").title,
        "Open Space",
        "studio scan filename",
      );
      assertEqual(
        suggestTitleFromFilename("OpenSpace.tif").title,
        "Open Space",
        "pascalCase filename",
      );
    },
  },
  {
    name: "selecting 12 files creates 12 artwork drafts with unique IDs and order",
    run: () => {
      const files = Array.from({ length: 12 }, (_, i) =>
        makeFile(`Artwork-${String(i + 1).padStart(2, "0")}.jpg`, {
          lastModified: 1_700_000_000_000 + i,
        }),
      );
      const batch = { ...createEmptyBatch(), shared: sharedDefaults() };
      const result = appendFilesToBatch(batch, files, {
        createPreviewUrls: false,
      });

      assertEqual(result.added.length, 12, "added count");
      assertEqual(result.batch.artworks.length, 12, "batch count");
      const ids = new Set(result.batch.artworks.map((a) => a.id));
      assertEqual(ids.size, 12, "unique ids");
      result.batch.artworks.forEach((artwork, index) => {
        assertEqual(
          artwork.image?.file.name,
          files[index]!.name,
          `order at ${index}`,
        );
        assert(artwork.id.length > 0, "stable id present");
      });
    },
  },
  {
    name: "selecting 13 files on an empty batch creates 13 drafts (not capped at 12)",
    run: () => {
      const files = Array.from({ length: 13 }, (_, i) =>
        makeFile(`Piece-${String(i + 1).padStart(2, "0")}.jpg`, {
          lastModified: 1_700_000_000_000 + i,
        }),
      );
      const result = appendFilesToBatch(createEmptyBatch(), files, {
        createPreviewUrls: false,
      });
      assertEqual(result.added.length, 13, "added count");
      assertEqual(result.batch.artworks.length, 13, "batch count");
      assertEqual(result.rejected.length, 0, "no rejections");
    },
  },
  {
    name: "selecting 24 files fills the batch; a 25th file is rejected",
    run: () => {
      const files = Array.from({ length: MAX_ARTWORKS_PER_BATCH + 1 }, (_, i) =>
        makeFile(`Cap-${String(i + 1).padStart(2, "0")}.jpg`, {
          lastModified: 1_700_000_000_000 + i,
        }),
      );
      const result = appendFilesToBatch(createEmptyBatch(), files, {
        createPreviewUrls: false,
      });
      assertEqual(result.added.length, MAX_ARTWORKS_PER_BATCH, "added count");
      assertEqual(
        result.batch.artworks.length,
        MAX_ARTWORKS_PER_BATCH,
        "batch count",
      );
      assertEqual(result.rejected.length, 1, "one count rejection");
      assertEqual(result.rejected[0]!.code, "batch_count", "count code");
      assert(
        result.rejected[0]!.message.includes(String(MAX_ARTWORKS_PER_BATCH)),
        "message uses shared cap",
      );
      assertEqual(remainingArtworkSlots(0), MAX_ARTWORKS_PER_BATCH, "empty slots");
      assertEqual(remainingArtworkSlots(MAX_ARTWORKS_PER_BATCH), 0, "full slots");
    },
  },
  {
    name: "a second selection can still fill remaining slots up to 24",
    run: () => {
      const firstFiles = Array.from({ length: 12 }, (_, i) =>
        makeFile(`First-${String(i + 1).padStart(2, "0")}.jpg`, {
          lastModified: 1_700_000_000_000 + i,
        }),
      );
      const first = appendFilesToBatch(createEmptyBatch(), firstFiles, {
        createPreviewUrls: false,
      });
      const secondFiles = Array.from({ length: 13 }, (_, i) =>
        makeFile(`Second-${String(i + 1).padStart(2, "0")}.jpg`, {
          lastModified: 1_800_000_000_000 + i,
        }),
      );
      const second = appendFilesToBatch(first.batch, secondFiles, {
        createPreviewUrls: false,
      });
      assertEqual(second.added.length, 12, "remaining slots filled");
      assertEqual(
        second.batch.artworks.length,
        MAX_ARTWORKS_PER_BATCH,
        "batch at cap",
      );
      assert(
        second.rejected.some((r) => r.code === "batch_count"),
        "overflow rejected",
      );
    },
  },
  {
    name: "shared defaults are inherited by newly created drafts",
    run: () => {
      const shared = sharedDefaults();
      const result = appendFilesToBatch(
        { shared, artworks: [] },
        [makeFile("Tulip-Tree.tif", { type: "image/tiff" })],
        { createPreviewUrls: false },
      );
      const draft = result.added[0]!;
      assertEqual(draft.year, "2026", "year");
      assertEqual(draft.medium, "Monotype", "medium");
      assertEqual(draft.dimensionUnit, "in", "unit");
      assertEqual(
        "location" in draft,
        false,
        "location removed from draft",
      );
      assertEqual(
        "status" in draft,
        false,
        "status removed from draft",
      );
      assertEqual(
        "edition" in draft,
        false,
        "edition removed from draft",
      );
      assertEqual(
        "series" in draft,
        false,
        "series removed from draft",
      );
      assertEqual(
        "defaultLocation" in shared,
        false,
        "defaultLocation removed from shared",
      );
      assertEqual(
        "defaultStatus" in shared,
        false,
        "defaultStatus removed from shared",
      );
      assertEqual(draft.title, "Tulip Tree", "suggested title");
      assertEqual(draft.titleSuggestedFromFilename, true, "suggested flag");
    },
  },
  {
    name: "appending files keeps previously entered shared details",
    run: () => {
      const first = appendFilesToBatch(
        createEmptyBatch(),
        [makeFile("One.jpg", { lastModified: 1 })],
        { createPreviewUrls: false },
      );
      const withShared = {
        ...first.batch,
        shared: sharedDefaults({
          exhibition: "Spring Show",
          gallery: "Blue Garden Gallery",
          exhibitionYear: "2003",
          photographer: "Studio",
        }),
      };
      const second = appendFilesToBatch(
        withShared,
        [makeFile("Two.jpg", { lastModified: 2 })],
        { createPreviewUrls: false },
      );
      assertEqual(
        second.batch.shared.exhibition,
        "Spring Show",
        "exhibition preserved",
      );
      assertEqual(
        second.batch.shared.gallery,
        "Blue Garden Gallery",
        "gallery preserved",
      );
      assertEqual(
        second.batch.shared.exhibitionYear,
        "2003",
        "exhibition year preserved",
      );
      assertEqual(
        second.batch.shared.photographer,
        "Studio",
        "photographer preserved",
      );
      assertEqual(second.batch.artworks.length, 2, "second artwork added");
      assertEqual(
        second.batch.artworks[1]!.year,
        "2026",
        "new draft inherits default year",
      );
    },
  },
  {
    name: "adding more files does not overwrite existing drafts",
    run: () => {
      const shared = sharedDefaults();
      const first = appendFilesToBatch(
        { shared, artworks: [] },
        [makeFile("One.jpg", { lastModified: 1 })],
        { createPreviewUrls: false },
      );
      const existingId = first.batch.artworks[0]!.id;
      const existingTitle = first.batch.artworks[0]!.title;

      const edited: ArtworkDraft = {
        ...first.batch.artworks[0]!,
        title: "Edited Title",
        titleSuggestedFromFilename: false,
        height: "30",
        width: "24",
      };
      const withEdit = {
        ...first.batch,
        artworks: [edited],
      };

      const second = appendFilesToBatch(
        withEdit,
        [makeFile("Two.jpg", { lastModified: 2 })],
        { createPreviewUrls: false },
      );

      assertEqual(second.batch.artworks.length, 2, "appended");
      assertEqual(second.batch.artworks[0]!.id, existingId, "id preserved");
      assertEqual(
        second.batch.artworks[0]!.title,
        "Edited Title",
        "title preserved",
      );
      assertEqual(second.batch.artworks[0]!.height, "30", "height preserved");
      assertEqual(
        second.batch.artworks[1]!.image?.file.name,
        "Two.jpg",
        "new file attached",
      );
      assert(existingTitle !== "Edited Title", "sanity");
    },
  },
  {
    name: "removing one artwork does not remove another artwork's image",
    run: () => {
      const shared = sharedDefaults();
      const result = appendFilesToBatch(
        { shared, artworks: [] },
        [
          makeFile("Keep.jpg", { lastModified: 1 }),
          makeFile("Drop.jpg", { lastModified: 2 }),
        ],
        { createPreviewUrls: false },
      );
      const keepId = result.batch.artworks[0]!.id;
      const dropId = result.batch.artworks[1]!.id;
      const { artworks } = removeArtworkFromList(result.batch.artworks, dropId);
      assertEqual(artworks.length, 1, "one remains");
      assertEqual(artworks[0]!.id, keepId, "kept id");
      assertEqual(artworks[0]!.image?.file.name, "Keep.jpg", "kept image");
    },
  },
  {
    name: "reordering preserves stable IDs",
    run: () => {
      const shared = sharedDefaults();
      const result = appendFilesToBatch(
        { shared, artworks: [] },
        [
          makeFile("A.jpg", { lastModified: 1 }),
          makeFile("B.jpg", { lastModified: 2 }),
          makeFile("C.jpg", { lastModified: 3 }),
        ],
        { createPreviewUrls: false },
      );
      const [a, b, c] = result.batch.artworks;
      const reordered = reorderArtworks(result.batch.artworks, b!.id, -1);
      assertEqual(reordered[0]!.id, b!.id, "b moved up");
      assertEqual(reordered[1]!.id, a!.id, "a shifted");
      assertEqual(reordered[2]!.id, c!.id, "c unchanged");
      assertEqual(reordered[0]!.image?.file.name, "B.jpg", "image follows id");
    },
  },
  {
    name: "one file maps to one artwork",
    run: () => {
      const result = appendFilesToBatch(
        createEmptyBatch(),
        [makeFile("Solo.png", { type: "image/png" })],
        { createPreviewUrls: false },
      );
      assertEqual(result.added.length, 1, "one draft");
      assert(result.added[0]!.image, "image attached");
      assertEqual(result.added[0]!.image!.file.name, "Solo.png", "same file");
    },
  },
  {
    name: "per-file size validation rejects oversized files",
    run: () => {
      const result = appendFilesToBatch(
        createEmptyBatch(),
        [makeFile("Huge.jpg", { size: MAX_FILE_BYTES + 1 })],
        { createPreviewUrls: false },
      );
      assertEqual(result.added.length, 0, "not added");
      assertEqual(result.rejected.length, 1, "rejected");
      assertEqual(result.rejected[0]!.code, "file_too_large", "size code");
    },
  },
  {
    name: "total batch-size validation rejects overflow",
    run: () => {
      const almostFull = createArtworkDraft(sharedDefaults(), {
        image: {
          file: makeFile("Already.jpg", {
            size: MAX_BATCH_BYTES - 1000,
          }),
          previewUrl: null,
          isTiff: false,
        },
      });
      const result = appendFilesToBatch(
        { shared: sharedDefaults(), artworks: [almostFull] },
        [makeFile("Extra.jpg", { size: 2000 })],
        { createPreviewUrls: false },
      );
      assertEqual(result.added.length, 0, "not added");
      assert(
        result.rejected.some((r) => r.code === "batch_too_large"),
        "batch too large",
      );
      assertEqual(
        totalBatchBytes(result.batch.artworks),
        MAX_BATCH_BYTES - 1000,
        "existing size unchanged",
      );
    },
  },
  {
    name: "validateBatch enforces count and total size limits",
    run: () => {
      const empty = validateBatch(createEmptyBatch());
      assert(hasBatchErrors(empty), "empty invalid");
      assert(empty.form?.includes("at least one"), "empty message");

      const tooMany = {
        shared: sharedDefaults(),
        artworks: Array.from({ length: MAX_ARTWORKS_PER_BATCH + 1 }, (_, i) =>
          createArtworkDraft(sharedDefaults(), {
            image: {
              file: makeFile(`F${i}.jpg`, { lastModified: i }),
              previewUrl: null,
              isTiff: false,
            },
          }),
        ),
      };
      const countResult = validateBatch(tooMany);
      assert(hasBatchErrors(countResult), "count invalid");
      assert(countResult.form?.includes("at most"), "count message");
    },
  },
  {
    name: "duplicate-file warning logic",
    run: () => {
      const file = makeFile("Same.jpg", { lastModified: 42, size: 4096 });
      const first = appendFilesToBatch(createEmptyBatch(), [file], {
        createPreviewUrls: false,
      });
      const second = appendFilesToBatch(first.batch, [file], {
        createPreviewUrls: false,
      });
      assertEqual(second.added.length, 0, "not auto-added");
      assertEqual(second.duplicates.length, 1, "duplicate reported");
      assertEqual(second.pendingDuplicates.length, 1, "pending");

      const forced = appendFilesToBatch(first.batch, [file], {
        allowDuplicates: true,
        createPreviewUrls: false,
      });
      assertEqual(forced.added.length, 1, "added anyway");
      assertEqual(forced.batch.artworks.length, 2, "two drafts");
      assertEqual(
        fileIdentityKey(forced.batch.artworks[0]!.image!.file),
        fileIdentityKey(forced.batch.artworks[1]!.image!.file),
        "same identity key",
      );
    },
  },
  {
    name: "replacing an image invalidates only that artwork's processing result",
    run: () => {
      const shared = sharedDefaults();
      const result = appendFilesToBatch(
        { shared, artworks: [] },
        [
          makeFile("A.jpg", { lastModified: 1 }),
          makeFile("B.jpg", { lastModified: 2 }),
        ],
        { createPreviewUrls: false },
      );
      const a = result.batch.artworks[0]!;
      const b = result.batch.artworks[1]!;
      const processing = {
        [a.id]: { status: "success" as const },
        [b.id]: { status: "success" as const },
      };

      const replaced = replaceArtworkImage(a, makeFile("A2.jpg", { lastModified: 9 }), {
        createPreviewUrl: false,
      });
      assert(replaced.ok, "replace ok");
      const nextProcessing = clearProcessingForArtwork(processing, a.id);
      assert(!(a.id in nextProcessing), "a cleared");
      assertEqual(nextProcessing[b.id]?.status, "success", "b preserved");
      assertEqual(
        replaced.artwork.image?.file.name,
        "A2.jpg",
        "new image on a",
      );
      assertEqual(b.image?.file.name, "B.jpg", "b image untouched");
    },
  },
  {
    name: "shared-detail application does not overwrite protected unique fields",
    run: () => {
      const shared = sharedDefaults({
        defaultArtworkYear: "2025",
        defaultMedium: "Watercolor",
        exhibition: "New Show",
        gallery: "West Wing",
        photographer: "Alex",
      });
      const artwork = createArtworkDraft(sharedDefaults(), {
        image: {
          file: makeFile("Keep.jpg"),
          previewUrl: null,
          isTiff: false,
        },
      });
      artwork.title = "My Title";
      artwork.titleSuggestedFromFilename = false;
      artwork.height = "40";
      artwork.width = "30";
      artwork.depth = "2";
      artwork.notes = "Private note";
      artwork.year = "2020";
      artwork.medium = "Painting";

      const applied = applySharedDetailsToArtworks(
        [artwork],
        shared,
        ["year", "medium", "exhibition", "gallery", "photographer"],
      )[0]!;

      assertEqual(applied.title, "My Title", "title protected");
      assertEqual(applied.height, "40", "height protected");
      assertEqual(applied.width, "30", "width protected");
      assertEqual(applied.depth, "2", "depth protected");
      assertEqual(applied.notes, "Private note", "notes protected");
      assertEqual(applied.image?.file.name, "Keep.jpg", "image protected");
      assertEqual(applied.year, "2025", "year applied");
      assertEqual(applied.medium, "Watercolor", "resolved custom medium applied");
      assertEqual(applied.overrides.exhibition, "New Show", "exhibition override");
      assertEqual(applied.overrides.gallery, "West Wing", "gallery override");
      assertEqual(
        applied.overrides.photographer,
        "Alex",
        "photographer override",
      );
    },
  },
  {
    name: "selective shared apply can omit fields",
    run: () => {
      const artwork = createArtworkDraft(sharedDefaults());
      artwork.year = "2019";
      artwork.medium = "Ink";
      const applied = applySharedDetailsToArtworks(
        [artwork],
        sharedDefaults({ defaultArtworkYear: "2026", defaultMedium: "Painting" }),
        ["year"],
      )[0]!;
      assertEqual(applied.year, "2026", "year applied");
      assertEqual(applied.medium, "Ink", "medium untouched");
    },
  },
  {
    name: "blank shared fields do not overwrite existing artwork values",
    run: () => {
      const shared = sharedDefaults({
        defaultArtworkYear: "2008",
        defaultMedium: "",
        exhibition: "   ",
        gallery: "",
        photographer: "",
      });
      const first = createArtworkDraft(sharedDefaults());
      first.year = "1999";
      first.medium = "Painting";
      first.overrides.exhibition = "Recent Monotypes";
      first.overrides.gallery = "East Gallery";
      first.overrides.photographer = "Alex";
      const second = createArtworkDraft(sharedDefaults());
      second.year = "2001";
      second.medium = "Ink";
      second.overrides.exhibition = "Northwest Works";
      second.overrides.gallery = "West Wing";
      second.overrides.photographer = "Sam";

      const [appliedFirst, appliedSecond] = applySharedDetailsToArtworks(
        [first, second],
        shared,
      );

      assertEqual(appliedFirst!.year, "2008", "year applied to first");
      assertEqual(appliedSecond!.year, "2008", "year applied to second");
      assertEqual(appliedFirst!.medium, "Painting", "blank medium skipped");
      assertEqual(appliedSecond!.medium, "Ink", "blank medium skipped");
      assertEqual(
        appliedFirst!.overrides.exhibition,
        "Recent Monotypes",
        "whitespace exhibition skipped",
      );
      assertEqual(
        appliedSecond!.overrides.exhibition,
        "Northwest Works",
        "whitespace exhibition skipped",
      );
      assertEqual(
        appliedFirst!.overrides.gallery,
        "East Gallery",
        "empty gallery skipped",
      );
      assertEqual(
        appliedSecond!.overrides.gallery,
        "West Wing",
        "empty gallery skipped",
      );
      assertEqual(
        appliedFirst!.overrides.photographer,
        "Alex",
        "empty photographer skipped",
      );
      assertEqual(
        appliedSecond!.overrides.photographer,
        "Sam",
        "empty photographer skipped",
      );
    },
  },
  {
    name: "shared custom medium is inherited by newly created drafts",
    run: () => {
      const shared = sharedDefaults({
        defaultMedium: resolveMediumValue("Other", "Watercolor"),
      });
      assertEqual(shared.defaultMedium, "Watercolor", "shared stores resolved");
      const result = appendFilesToBatch(
        { shared, artworks: [] },
        [makeFile("New.jpg")],
        { createPreviewUrls: false },
      );
      assertEqual(result.added[0]!.medium, "Watercolor", "inherited resolved");
    },
  },
  {
    name: "individual custom medium remains intact unless Medium is applied",
    run: () => {
      const artwork = createArtworkDraft(sharedDefaults());
      artwork.medium = "Collage";
      const applied = applySharedDetailsToArtworks(
        [artwork],
        sharedDefaults({ defaultMedium: "Monotype" }),
        ["year", "dimensionUnit"],
      )[0]!;
      assertEqual(applied.medium, "Collage", "custom medium preserved");
    },
  },
  {
    name: "existing custom medium loads as Other + custom text for UI",
    run: () => {
      assertEqual(deriveMediumChoice("Mixed media"), "Other", "choice");
      assertEqual(deriveCustomMedium("Mixed media"), "Mixed media", "custom");
      assertEqual(deriveMediumChoice("Monotype"), "Monotype", "primary");
      assertEqual(deriveMediumChoice("Painting"), "Painting", "painting");
    },
  },
  {
    name: "review uses resolved medium not Other",
    run: () => {
      const artwork = createArtworkDraft(
        sharedDefaults({ defaultMedium: "Watercolor" }),
      );
      assertEqual(artwork.medium, "Watercolor", "draft medium");
      assertEqual(artwork.medium === "Other", false, "not literal Other");
      assertEqual(validateMediumValue(artwork.medium), null, "valid for review");
    },
  },
  {
    name: "submission payload and Sheet row contain only the resolved medium",
    run: () => {
      const artwork = createArtworkDraft(
        sharedDefaults({ defaultMedium: "Monotype" }),
        {
          image: {
            file: makeFile("Payload.jpg"),
            previewUrl: null,
            isTiff: false,
          },
        },
      );
      artwork.title = "Resolved Medium Piece";
      artwork.height = "10";
      artwork.width = "8";
      artwork.medium = resolveMediumValue("Other", "Sculpture");

      const payload = batchDraftToSubmissionPayload({
        shared: sharedDefaults(),
        artworks: [artwork],
      });
      assertEqual(payload.artworks[0]!.medium, "Sculpture", "payload medium");
      assertEqual(
        Object.prototype.hasOwnProperty.call(payload.artworks[0]!, "mediumChoice"),
        false,
        "no mediumChoice in payload",
      );
      assertEqual(
        Object.prototype.hasOwnProperty.call(payload.artworks[0]!, "customMedium"),
        false,
        "no customMedium in payload",
      );

      const metadata = resolveArtworkMetadata(payload.artworks[0]!, {
        exhibition: "Show",
        gallery: "Venue",
        photographer: "Kim",
      });
      const row = buildArtworkInventoryRow({
        inventoryId: 1000,
        metadata,
        links: {
          masterFilename: "m.jpg",
          masterFileUrl: "https://drive/m",
          hrFilename: "h.jpg",
          hrFileUrl: "https://drive/h",
          webFilename: "w.jpg",
          webFileUrl: "https://drive/w",
          artworkFolderUrl: "https://drive/f",
        },
        thumbnailFormula:
          '=IMAGE("https://dl.dropboxusercontent.com/scl/fi/thumb.jpg?rlkey=k&raw=1", 1)',
        createdAt: "2026-08-03T12:00:00.000Z",
      });
      assertEqual(row.length, ARTWORK_INVENTORY_HEADERS.length, "schema width");
      assertEqual(row[artworkInventoryColumnIndex("Medium")], "Sculpture", "Sheet Medium column");
      assertEqual(ARTWORK_INVENTORY_HEADERS[artworkInventoryColumnIndex("Medium")], "Medium", "single Medium header");
      assertEqual(
        ARTWORK_INVENTORY_HEADERS.includes("Custom Medium" as never),
        false,
        "no Custom Medium column",
      );
    },
  },
  {
    name: "validation rejects empty Other and literal Other",
    run: () => {
      const emptyOther = createArtworkDraft(sharedDefaults(), {
        image: {
          file: makeFile("X.jpg"),
          previewUrl: null,
          isTiff: false,
        },
      });
      emptyOther.title = "T";
      emptyOther.height = "1";
      emptyOther.width = "1";
      emptyOther.medium = resolveMediumValue("Other", "");
      assertEqual(
        validateArtworkDraft(emptyOther).medium,
        "Medium is required.",
        "empty Other",
      );

      emptyOther.medium = "Other";
      assertEqual(
        validateArtworkDraft(emptyOther).medium,
        "Enter the specific medium.",
        "literal Other",
      );

      emptyOther.medium = "   ";
      assertEqual(
        validateArtworkDraft(emptyOther).medium,
        "Enter the specific medium.",
        "whitespace",
      );
    },
  },
  {
    name: "Apply Shared Details has no Location option",
    run: () => {
      assertEqual(
        APPLYABLE_SHARED_FIELDS.some((f) => f.key === "location"),
        false,
        "no location apply key",
      );
      assertEqual(
        APPLYABLE_SHARED_FIELDS.some((f) => f.label === "Location"),
        false,
        "no location label",
      );
    },
  },
  {
    name: "submission payload excludes Location",
    run: () => {
      const shared = sharedDefaults();
      const artwork = createArtworkDraft(shared, {
        image: {
          file: makeFile("Payload.jpg"),
          previewUrl: null,
          isTiff: false,
        },
      });
      artwork.title = "Payload Piece";
      artwork.height = "10";
      artwork.width = "8";
      const payload = batchDraftToSubmissionPayload({
        shared,
        artworks: [artwork],
      });
      assertEqual(
        "defaultLocation" in payload.shared,
        false,
        "shared has no defaultLocation",
      );
      assertEqual(
        "location" in payload.artworks[0]!,
        false,
        "artwork has no location",
      );
      assertEqual(payload.artworks[0]!.title, "Payload Piece", "title present");
      assertEqual(payload.shared.photographer, "Kim", "photographer present");
    },
  },
  {
    name: "validateBatch summary uses human-readable artwork messages",
    run: () => {
      const artwork = createArtworkDraft(sharedDefaults(), {
        image: {
          file: makeFile("X.jpg"),
          previewUrl: null,
          isTiff: false,
        },
      });
      artwork.title = "";
      artwork.height = "10";
      artwork.width = "10";
      const result = validateBatch({
        shared: sharedDefaults(),
        artworks: [artwork],
      });
      assert(result.form?.includes("Artwork 01: Title is required"), "summary");
    },
  },
  {
    name: "height, width, and depth are optional; invalid values still error",
    run: () => {
      const artwork = createArtworkDraft(sharedDefaults(), {
        image: {
          file: makeFile("Untitled.jpg"),
          previewUrl: null,
          isTiff: false,
        },
      });
      artwork.title = "Untitled";
      artwork.height = "";
      artwork.width = "";
      artwork.depth = "";

      const empty = validateArtworkDraft(artwork);
      assertEqual(empty.height, undefined, "empty height ok");
      assertEqual(empty.width, undefined, "empty width ok");
      assertEqual(empty.depth, undefined, "empty depth ok");
      assertEqual(Object.keys(empty).length, 0, "draft valid without dimensions");

      const batch = validateBatch({
        shared: sharedDefaults(),
        artworks: [artwork],
      });
      assertEqual(hasBatchErrors(batch), false, "batch valid without dimensions");
      assertEqual(artworkNeedsMetadata(artwork), false, "dimensions not metadata");

      artwork.height = "0";
      artwork.width = "-3";
      artwork.depth = "abc";
      const invalid = validateArtworkDraft(artwork);
      assertEqual(
        invalid.height,
        "Height must be a positive number when provided.",
        "zero height",
      );
      assertEqual(
        invalid.width,
        "Width must be a positive number when provided.",
        "negative width",
      );
      assertEqual(
        invalid.depth,
        "Depth must be a positive number when provided.",
        "non-numeric depth",
      );
    },
  },
  {
    name: "formatDimensions omits blank measurements",
    run: () => {
      assertEqual(
        formatDimensions({
          height: "",
          width: "",
          depth: "",
          dimensionUnit: "in",
        }),
        "",
        "all blank",
      );
      assertEqual(
        formatDimensions({
          height: "24",
          width: "18",
          depth: "",
          dimensionUnit: "in",
        }),
        "24 × 18 in",
        "height and width",
      );
      assertEqual(
        formatDimensions({
          height: "24",
          width: "18",
          depth: "2",
          dimensionUnit: "cm",
        }),
        "24 × 18 × 2 cm",
        "all three",
      );
    },
  },
  {
    name: "checking Missing / no known title resolves to Untitled and restores on uncheck",
    run: () => {
      const artwork = createArtworkDraft(sharedDefaults(), {
        image: {
          file: makeFile("Tulip-Tree.tif", { type: "image/tiff" }),
          previewUrl: null,
          isTiff: true,
        },
        title: "Tulip Tree",
        titleSuggestedFromFilename: true,
      });

      const marked = setArtworkUntitled(artwork, true);
      assertEqual(marked.isUntitled, true, "flag set");
      assertEqual(marked.title, "Tulip Tree", "typed title preserved");
      assertEqual(resolveArtworkTitle(marked), UNTITLED_TITLE, "resolved title");
      assertEqual(artworkNeedsMetadata(marked), false, "untitled satisfies title");

      const restored = setArtworkUntitled(marked, false);
      assertEqual(restored.isUntitled, false, "flag cleared");
      assertEqual(restored.title, "Tulip Tree", "prior title restored");
      assertEqual(resolveArtworkTitle(restored), "Tulip Tree", "resolved restored");
      assertEqual(
        restored.titleSuggestedFromFilename,
        true,
        "suggestion flag restored",
      );
    },
  },
  {
    name: "untitled checkbox overrides a filename-derived suggestion and does not refresh it",
    run: () => {
      const result = appendFilesToBatch(
        { shared: sharedDefaults(), artworks: [] },
        [makeFile("Tulip-Tree.tif", { type: "image/tiff" })],
        { createPreviewUrls: false },
      );
      const draft = result.added[0]!;
      assertEqual(draft.title, "Tulip Tree", "suggested");
      assertEqual(draft.titleSuggestedFromFilename, true, "suggested flag");

      const marked = setArtworkUntitled(draft, true);
      assertEqual(resolveArtworkTitle(marked), UNTITLED_TITLE, "overrides suggestion");

      const replaced = replaceArtworkImage(
        marked,
        makeFile("Blue_Garden.jpg", { lastModified: 9 }),
        { createPreviewUrl: false },
      );
      assert(replaced.ok, "replace ok");
      assertEqual(replaced.artwork.isUntitled, true, "still untitled");
      assertEqual(
        replaced.artwork.title,
        "Tulip Tree",
        "does not regenerate suggestion while untitled",
      );
      assertEqual(
        resolveArtworkTitle(replaced.artwork),
        UNTITLED_TITLE,
        "resolved stays Untitled",
      );

      const restored = setArtworkUntitled(replaced.artwork, false);
      assertEqual(restored.title, "Tulip Tree", "restores prior suggested title");
    },
  },
  {
    name: "blank normal title fails validation; untitled artwork passes",
    run: () => {
      const artwork = createArtworkDraft(sharedDefaults(), {
        image: {
          file: makeFile("X.jpg"),
          previewUrl: null,
          isTiff: false,
        },
      });
      artwork.title = "";
      assertEqual(
        validateArtworkDraft(artwork).title,
        "Title is required.",
        "blank fails",
      );
      assertEqual(resolveArtworkTitle(artwork), "", "blank is not Untitled");

      const marked = setArtworkUntitled(artwork, true);
      const untitledErrors = validateArtworkDraft(marked);
      assertEqual(untitledErrors.title, undefined, "untitled passes title");
      assertEqual(Object.keys(untitledErrors).length, 0, "draft valid");

      artwork.title = "Untitled";
      artwork.isUntitled = false;
      assertEqual(
        Object.keys(validateArtworkDraft(artwork)).length,
        0,
        "literal Untitled without checkbox is valid",
      );
    },
  },
  {
    name: "multiple untitled works share Title Untitled and stay unique by Inventory ID",
    run: () => {
      const shared = sharedDefaults();
      const first = createArtworkDraft(shared, {
        image: {
          file: makeFile("One.tif", { type: "image/tiff" }),
          previewUrl: null,
          isTiff: true,
        },
        title: "One",
      });
      const second = createArtworkDraft(shared, {
        image: {
          file: makeFile("Two.tif", { type: "image/tiff" }),
          previewUrl: null,
          isTiff: true,
        },
        title: "Two",
      });
      const untitled = [
        setArtworkUntitled(first, true),
        setArtworkUntitled(second, true),
      ];

      const payload = batchDraftToSubmissionPayload({
        shared,
        artworks: untitled,
      });
      assertEqual(payload.artworks[0]!.title, UNTITLED_TITLE, "first payload title");
      assertEqual(payload.artworks[1]!.title, UNTITLED_TITLE, "second payload title");
      assertEqual(payload.artworks[0]!.isUntitled, true, "first flag");
      assertEqual(payload.artworks[1]!.isUntitled, true, "second flag");

      const planA = planFilenamesForArtwork({
        year: 2026,
        inventoryId: 1047,
        title: resolveArtworkTitle(untitled[0]!),
        masterFilename: "One.tif",
      });
      const planB = planFilenamesForArtwork({
        year: 2026,
        inventoryId: 1048,
        title: resolveArtworkTitle(untitled[1]!),
        masterFilename: "Two.tif",
      });
      assertEqual(
        planA.master,
        "2026_KO_1047_Untitled_master_01.tif",
        "first filename",
      );
      assertEqual(
        planB.master,
        "2026_KO_1048_Untitled_master_01.tif",
        "second filename",
      );
      assert(planA.master !== planB.master, "filenames unique via inventory ID");

      const metadata = resolveArtworkMetadata(payload.artworks[0]!, {
        exhibition: "Show",
        gallery: "Venue",
        photographer: "Kim",
      });
      const row = buildArtworkInventoryRow({
        inventoryId: 1047,
        metadata,
        links: {
          masterFilename: planA.master,
          masterFileUrl: "https://drive/m",
          hrFilename: planA.hr,
          hrFileUrl: "https://drive/h",
          webFilename: planA.web,
          webFileUrl: "https://drive/w",
          artworkFolderUrl: "https://drive/f",
        },
        thumbnailFormula:
          '=IMAGE("https://dl.dropboxusercontent.com/scl/fi/thumb.jpg?rlkey=k&raw=1", 1)',
        createdAt: "2026-08-19T12:00:00.000Z",
      });
      assertEqual(row[artworkInventoryColumnIndex("Title")], UNTITLED_TITLE, "Sheet Title is Untitled");
      assertEqual(row.length, ARTWORK_INVENTORY_HEADERS.length, "no extra column");
      assertEqual(ARTWORK_INVENTORY_HEADERS[artworkInventoryColumnIndex("Title")], "Title", "Title column only");
      assertEqual(
        ARTWORK_INVENTORY_HEADERS.includes("Missing Title" as never),
        false,
        "no Missing Title column",
      );
      assertEqual(
        ARTWORK_INVENTORY_HEADERS.includes("isUntitled" as never),
        false,
        "no isUntitled column",
      );
    },
  },
  {
    name: "batch Untitled apply does not overwrite titled works without confirmation",
    run: () => {
      const blank = createArtworkDraft(sharedDefaults(), { title: "" });
      const titled = createArtworkDraft(sharedDefaults(), {
        title: "Blue Garden",
        titleSuggestedFromFilename: false,
      });
      const already = setArtworkUntitled(
        createArtworkDraft(sharedDefaults(), { title: "Kept" }),
        true,
      );

      const blocked = applyUntitledToSelectedArtworks(
        [blank, titled, already],
        [blank.id, titled.id, already.id],
      );
      assertEqual(blocked.blocked.length, 1, "titled work blocked");
      assertEqual(blocked.blocked[0]!.id, titled.id, "blocked id");
      assertEqual(blocked.artworks[0]!.isUntitled, false, "blank not applied");
      assertEqual(blocked.artworks[1]!.isUntitled, false, "titled not overwritten");
      assertEqual(blocked.artworks[1]!.title, "Blue Garden", "title intact");
      assertEqual(blocked.artworks[2]!.isUntitled, true, "already untitled");

      const blankOnly = applyUntitledToSelectedArtworks(
        [blank, titled],
        [blank.id],
      );
      assertEqual(blankOnly.blocked.length, 0, "blank apply allowed");
      assertEqual(blankOnly.artworks[0]!.isUntitled, true, "blank marked");
      assertEqual(blankOnly.artworks[1]!.title, "Blue Garden", "titled untouched");
      assertEqual(resolveArtworkTitle(blankOnly.artworks[0]!), UNTITLED_TITLE, "resolved");

      const confirmed = applyUntitledToSelectedArtworks(
        [blank, titled],
        [titled.id],
        { overwriteTitled: true },
      );
      assertEqual(confirmed.blocked.length, 0, "confirmed");
      assertEqual(confirmed.artworks[1]!.isUntitled, true, "titled marked after confirm");
      assertEqual(confirmed.artworks[1]!.title, "Blue Garden", "prior title kept for restore");
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

console.log(`\nAll ${tests.length} batch workflow tests passed.`);
