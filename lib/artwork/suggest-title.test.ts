/**
 * Filename → suggested title (artist alias stripping + cleanup).
 * Run: npx tsx lib/artwork/suggest-title.test.ts
 */

import { DEFAULT_ARTIST_PROFILE } from "./artist-profile";
import {
  isRomanNumeral,
  normalizeFilenameKey,
  stripArtistAliases,
  suggestTitleFromFilename,
  titleCasePhrase,
  titleCaseWord,
} from "./suggest-title";

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

function assertSuggestion(
  filename: string,
  expectedTitle: string,
  expectedRemoved: boolean,
  message: string,
) {
  const result = suggestTitleFromFilename(filename);
  assertEqual(result.title, expectedTitle, `${message} title`);
  assertEqual(
    result.removedArtistAlias,
    expectedRemoved,
    `${message} removedArtistAlias`,
  );
}

const tests: TestCase[] = [
  {
    name: "KO prefix",
    run: () => {
      assertSuggestion("KO_Blue_Garden.tif", "Blue Garden", true, "KO_");
      assertSuggestion("KO-Blue-Garden.tif", "Blue Garden", true, "KO-");
      assertSuggestion("ko_blue_garden.tif", "Blue Garden", true, "ko lower");
    },
  },
  {
    name: "Kim Osgood prefix variants",
    run: () => {
      assertSuggestion(
        "Kim Osgood Blue Garden.tif",
        "Blue Garden",
        true,
        "spaces",
      );
      assertSuggestion(
        "Kim_Osgood_Blue_Garden.tif",
        "Blue Garden",
        true,
        "underscores",
      );
      assertSuggestion(
        "Kim-Osgood-Blue-Garden.tif",
        "Blue Garden",
        true,
        "hyphens",
      );
      assertSuggestion(
        "kim_osgood_blue_garden.tif",
        "Blue Garden",
        true,
        "lower underscores",
      );
      assertSuggestion(
        "kim-osgood-blue-garden.tif",
        "Blue Garden",
        true,
        "lower hyphens",
      );
    },
  },
  {
    name: "suffix aliases",
    run: () => {
      assertSuggestion("Blue_Garden_KO.tif", "Blue Garden", true, "KO suffix");
      assertSuggestion(
        "Blue_Garden_Kim_Osgood.tif",
        "Blue Garden",
        true,
        "Kim Osgood suffix",
      );
      assertSuggestion(
        "Blue-Garden-K.O..tif",
        "Blue Garden",
        true,
        "K.O. suffix",
      );
    },
  },
  {
    name: "mixed delimiters and continuous forms",
    run: () => {
      assertSuggestion(
        "Kim.Osgood.Blue.Garden.tif",
        "Blue Garden",
        true,
        "period delimiters",
      );
      assertSuggestion(
        "kimosgood_Blue_Garden.tif",
        "Blue Garden",
        true,
        "kimosgood",
      );
      assertSuggestion(
        "KO_Kim_Osgood_Blue_Garden.tif",
        "Blue Garden",
        true,
        "stacked aliases",
      );
    },
  },
  {
    name: "case-insensitive matches",
    run: () => {
      assertSuggestion("ko_BLUE_garden.TIF", "Blue Garden", true, "mixed case");
      assertSuggestion(
        "KIM_OSGOOD_Summer_Study.JPG",
        "Summer Study",
        true,
        "upper Kim Osgood",
      );
      assertSuggestion("k.o._pond.tif", "Pond", true, "k.o. lower");
    },
  },
  {
    name: "ko inside ordinary words is not removed",
    run: () => {
      assertSuggestion("Koi_Pond.tif", "Koi Pond", false, "Koi Pond");
      assertSuggestion("Tokyo_Morning.tif", "Tokyo Morning", false, "Tokyo");
      assertSuggestion("Broken_Token.tif", "Broken Token", false, "Token");
      assertSuggestion("Blue Garden by Kim.tif", "Blue Garden By Kim", false, "by Kim");
    },
  },
  {
    name: "roman numerals and numbers",
    run: () => {
      assertSuggestion("blue_garden_ii.tif", "Blue Garden II", false, "ii");
      assertSuggestion("summer-study-3.tif", "Summer Study 3", false, "number");
      assertSuggestion("study_xiv.tif", "Study XIV", false, "xiv");
      assertEqual(isRomanNumeral("ii"), true, "ii is roman");
      assertEqual(isRomanNumeral("civil"), false, "civil not roman");
      assertEqual(titleCaseWord("ii"), "II", "titleCase roman");
      assertEqual(titleCaseWord("42"), "42", "titleCase number");
    },
  },
  {
    name: "double spaces and separator cleanup",
    run: () => {
      assertSuggestion("Blue__Garden.tif", "Blue Garden", false, "double underscore");
      assertSuggestion("Blue--Garden.tif", "Blue Garden", false, "double hyphen");
      assertSuggestion("  Blue   Garden  .tif", "Blue Garden", false, "spaces");
      assertEqual(
        normalizeFilenameKey("Blue__--Garden"),
        "blue garden",
        "normalize key",
      );
    },
  },
  {
    name: "existing normalization and apostrophes",
    run: () => {
      assertSuggestion("Tulip-Tree.tif", "Tulip Tree", false, "hyphen legacy");
      assertSuggestion("Blue_Garden.jpg", "Blue Garden", false, "underscore legacy");
      assertSuggestion("artist's_study.tif", "Artist's Study", false, "apostrophe");
      assertEqual(titleCasePhrase("blue garden"), "Blue Garden", "phrase");
    },
  },
  {
    name: "stripArtistAliases uses profile aliases only",
    run: () => {
      const custom = stripArtistAliases("ada lovelace blue garden", [
        "Ada Lovelace",
        "AL",
      ]);
      assertEqual(custom.remainder, "blue garden", "custom remainder");
      assertEqual(custom.removed, true, "custom removed");

      const untouched = stripArtistAliases(
        "blue garden",
        DEFAULT_ARTIST_PROFILE.filenameAliases,
      );
      assertEqual(untouched.remainder, "blue garden", "default no strip");
      assertEqual(untouched.removed, false, "default not removed");
    },
  },
  {
    name: "custom artist profile is respected by suggester",
    run: () => {
      const result = suggestTitleFromFilename("AL_River_Stone.tif", {
        artistName: "Ada Lovelace",
        filenameAliases: ["AL", "Ada Lovelace"],
      });
      assertEqual(result.title, "River Stone", "custom title");
      assertEqual(result.removedArtistAlias, true, "custom removed");
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

console.log(`\nAll ${tests.length} suggest-title tests passed.`);
