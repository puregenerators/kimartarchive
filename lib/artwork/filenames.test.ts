import {
  buildArtworkFilename,
  buildArtworkMetadataFilename,
  normalizeMasterExtension,
  planFilenamesForArtwork,
  planFilenamesForMasters,
  sanitizeTitleForFilename,
} from "./filenames";

type TestCase = {
  name: string;
  run: () => void;
};

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

const tests: TestCase[] = [
  {
    name: "Blue Garden → PascalCase",
    run: () => {
      assertEqual(sanitizeTitleForFilename("Blue Garden"), "BlueGarden", "sanitize");
      assertEqual(
        buildArtworkFilename({
          year: 2026,
          inventoryId: 1000,
          title: "Blue Garden",
          assetType: "master",
          sequence: 1,
          extension: ".tif",
        }),
        "2026_KO_1000_BlueGarden_master_01.tif",
        "master filename",
      );
      assertEqual(
        buildArtworkFilename({
          year: 2026,
          inventoryId: 1000,
          title: "Blue Garden",
          assetType: "hr",
          sequence: 1,
          extension: ".jpg",
        }),
        "2026_KO_1000_BlueGarden_hr_01.jpg",
        "hr filename",
      );
      assertEqual(
        buildArtworkFilename({
          year: 2026,
          inventoryId: 1000,
          title: "Blue Garden",
          assetType: "web",
          sequence: 1,
          extension: ".jpg",
        }),
        "2026_KO_1000_BlueGarden_web_01.jpg",
        "web filename",
      );
    },
  },
  {
    name: "punctuation is removed",
    run: () => {
      assertEqual(
        sanitizeTitleForFilename("Blue, Garden! (Study)"),
        "BlueGardenStudy",
        "punctuation",
      );
    },
  },
  {
    name: "accented characters are normalized",
    run: () => {
      assertEqual(
        sanitizeTitleForFilename("Café Résumé"),
        "CafeResume",
        "accents",
      );
    },
  },
  {
    name: "repeated spaces collapse",
    run: () => {
      assertEqual(
        sanitizeTitleForFilename("  Blue    Garden  "),
        "BlueGarden",
        "spaces",
      );
    },
  },
  {
    name: "title with only symbols becomes Untitled",
    run: () => {
      assertEqual(sanitizeTitleForFilename("@@@ ###"), "Untitled", "symbols only");
      assertEqual(
        buildArtworkFilename({
          year: 2026,
          inventoryId: 1000,
          title: "***",
          assetType: "master",
          sequence: 1,
          extension: ".png",
        }),
        "2026_KO_1000_Untitled_master_01.png",
        "untitled master",
      );
    },
  },
  {
    name: "jpeg→jpg and tiff→tif extension normalization",
    run: () => {
      assertEqual(normalizeMasterExtension("photo.JPEG"), ".jpg", "JPEG upper");
      assertEqual(normalizeMasterExtension("photo.jpeg"), ".jpg", "jpeg lower");
      assertEqual(normalizeMasterExtension("photo.jpg"), ".jpg", "jpg");
      assertEqual(normalizeMasterExtension("scan.tiff"), ".tif", "tiff → tif");
      assertEqual(normalizeMasterExtension("scan.tif"), ".tif", "tif preserved");
    },
  },
  {
    name: "metadata filename is Inventory-ID based",
    run: () => {
      assertEqual(
        buildArtworkMetadataFilename(1000),
        "1000_metadata.json",
        "1000",
      );
      assertEqual(
        buildArtworkMetadataFilename(2048),
        "2048_metadata.json",
        "2048",
      );
    },
  },
  {
    name: "one artwork always uses sequence 01",
    run: () => {
      const plan = planFilenamesForArtwork({
        year: 2026,
        inventoryId: 1001,
        title: "Blue Garden",
        masterFilename: "scan.jpeg",
      });

      assertDeepEqual(
        plan,
        {
          sequence: "01",
          master: "2026_KO_1001_BlueGarden_master_01.jpg",
          hr: "2026_KO_1001_BlueGarden_hr_01.jpg",
          web: "2026_KO_1001_BlueGarden_web_01.jpg",
          metadata: "1001_metadata.json",
        },
        "single artwork plan",
      );
    },
  },
  {
    name: "batch preview inventory IDs map to distinct filename plans",
    run: () => {
      const titles = ["One", "Two", "Three", "Four", "Five"];
      titles.forEach((title, index) => {
        const inventoryId = 1000 + index;
        const plan = planFilenamesForArtwork({
          year: 2026,
          inventoryId,
          title,
          masterFilename: `${title}.tif`,
        });
        assertEqual(plan.sequence, "01", `${title} sequence`);
        assertEqual(
          plan.master,
          `2026_KO_${inventoryId}_${title}_master_01.tif`,
          `${title} master`,
        );
        assertEqual(
          plan.metadata,
          `${inventoryId}_metadata.json`,
          `${title} metadata`,
        );
      });
    },
  },
  {
    name: "legacy multi-file helper still aligns sequences",
    run: () => {
      const plan = planFilenamesForMasters({
        year: 2026,
        inventoryId: 1000,
        title: "Blue Garden",
        masterFilenames: ["a.tif", "b.jpeg", "c.PNG"],
      });

      assertDeepEqual(
        plan,
        [
          {
            sequence: "01",
            master: "2026_KO_1000_BlueGarden_master_01.tif",
            hr: "2026_KO_1000_BlueGarden_hr_01.jpg",
            web: "2026_KO_1000_BlueGarden_web_01.jpg",
            metadata: "1000_metadata.json",
          },
          {
            sequence: "02",
            master: "2026_KO_1000_BlueGarden_master_02.jpg",
            hr: "2026_KO_1000_BlueGarden_hr_02.jpg",
            web: "2026_KO_1000_BlueGarden_web_02.jpg",
            metadata: "1000_metadata.json",
          },
          {
            sequence: "03",
            master: "2026_KO_1000_BlueGarden_master_03.png",
            hr: "2026_KO_1000_BlueGarden_hr_03.jpg",
            web: "2026_KO_1000_BlueGarden_web_03.jpg",
            metadata: "1000_metadata.json",
          },
        ],
        "multi-file plan",
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

console.log(`\nAll ${tests.length} filename tests passed.`);
