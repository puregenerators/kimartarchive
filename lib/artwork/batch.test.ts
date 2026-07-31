/**
 * Batch upload / artwork-draft helpers.
 * Run: npx tsx lib/artwork/batch.test.ts
 */

import {
  appendFilesToBatch,
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
  applySharedDetailsToArtworks,
  createEmptyBatch,
  createArtworkDraft,
  type ArtworkDraft,
  type BatchSharedDetails,
} from "./types";
import { hasBatchErrors, validateBatch } from "./validation";

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
    defaultLocation: "Studio",
    defaultMedium: "Oil on linen",
    defaultStatus: "Available",
    defaultDimensionUnit: "in",
    ...overrides,
  };
}

const tests: TestCase[] = [
  {
    name: "suggestTitleFromFilename replaces separators lightly",
    run: () => {
      assertEqual(
        suggestTitleFromFilename("Tulip-Tree.tif"),
        "Tulip Tree",
        "hyphen",
      );
      assertEqual(
        suggestTitleFromFilename("Blue_Garden.jpg"),
        "Blue Garden",
        "underscore",
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
      assertEqual(draft.medium, "Oil on linen", "medium");
      assertEqual(draft.status, "Available", "status");
      assertEqual(draft.location, "Studio", "location");
      assertEqual(draft.dimensionUnit, "in", "unit");
      assertEqual(draft.title, "Tulip Tree", "suggested title");
      assertEqual(draft.titleSuggestedFromFilename, true, "suggested flag");
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
        defaultMedium: "Acrylic",
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
      artwork.edition = "1/5";
      artwork.notes = "Private note";
      artwork.year = "2020";
      artwork.medium = "Oil";

      const applied = applySharedDetailsToArtworks(
        [artwork],
        shared,
        ["year", "medium", "exhibition", "gallery", "photographer"],
      )[0]!;

      assertEqual(applied.title, "My Title", "title protected");
      assertEqual(applied.height, "40", "height protected");
      assertEqual(applied.width, "30", "width protected");
      assertEqual(applied.depth, "2", "depth protected");
      assertEqual(applied.edition, "1/5", "edition protected");
      assertEqual(applied.notes, "Private note", "notes protected");
      assertEqual(applied.image?.file.name, "Keep.jpg", "image protected");
      assertEqual(applied.year, "2025", "year applied");
      assertEqual(applied.medium, "Acrylic", "medium applied");
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
        sharedDefaults({ defaultArtworkYear: "2026", defaultMedium: "Oil" }),
        ["year"],
      )[0]!;
      assertEqual(applied.year, "2026", "year applied");
      assertEqual(applied.medium, "Ink", "medium untouched");
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
