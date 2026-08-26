/**
 * Filename → suggested title (artist alias stripping + cleanup).
 * Run: npx tsx lib/artwork/suggest-title.test.ts
 */

import { DEFAULT_ARTIST_PROFILE } from "./artist-profile";
import {
  isRomanNumeral,
  normalizeFilenameKey,
  splitCamelCaseBoundaries,
  stripArtistAliases,
  stripDimensionMetadata,
  stripFilenameNoise,
  stripLeadingNumericToken,
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
      assertSuggestion("Garden_2.tif", "Garden 2", false, "trailing title number");
      assertSuggestion("SummerStudy3.tif", "Summer Study 3", false, "collapsed title number");
      assertSuggestion("BlueGardenII.tif", "Blue Garden II", false, "collapsed roman numeral");
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
      assertEqual(
        normalizeFilenameKey("Open Space_6.5x8"),
        "open space 6.5x8",
        "preserves decimal in dimensions",
      );
    },
  },
  {
    name: "existing normalization and apostrophes",
    run: () => {
      assertSuggestion("Tulip-Tree.tif", "Tulip Tree", false, "hyphen legacy");
      assertSuggestion("TulipTree.tif", "Tulip Tree", false, "pascal legacy");
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

      const middle = stripArtistAliases(
        "scan osgoods in balance",
        DEFAULT_ARTIST_PROFILE.filenameAliases,
      );
      assertEqual(middle.remainder, "scan in balance", "middle osgoods remainder");
      assertEqual(middle.removed, true, "middle osgoods removed");
    },
  },
  {
    name: "copy markers are stripped from filename edges",
    run: () => {
      assertSuggestion("Blue_Garden_copy.tif", "Blue Garden", false, "copy suffix");
      assertSuggestion("Blue Garden copy.tif", "Blue Garden", false, "copy suffix spaces");
      assertSuggestion("Blue-Garden-Copy.tif", "Blue Garden", false, "Copy suffix hyphen");
      assertSuggestion("Blue Garden copy 2.tif", "Blue Garden", false, "copy 2");
      assertSuggestion("Blue_Garden_copy_3.jpg", "Blue Garden", false, "copy 3 underscore");
      assertSuggestion("Copy of Blue Garden.tif", "Blue Garden", false, "copy of prefix");
      assertSuggestion("copy-of-Blue-Garden.tif", "Blue Garden", false, "copy of hyphens");
      assertSuggestion("Blue Garden (copy).tif", "Blue Garden", false, "parenthetical copy");
      assertSuggestion("Blue Garden (copy 2).tif", "Blue Garden", false, "parenthetical copy 2");
      assertSuggestion("Blue Garden (1).tif", "Blue Garden", false, "parenthetical 1");
      assertSuggestion("Blue Garden (2).tif", "Blue Garden", false, "parenthetical 2");
      assertSuggestion("Blue Garden - Copy.tif", "Blue Garden", false, "dash Copy");
    },
  },
  {
    name: "copy markers combine with artist aliases",
    run: () => {
      assertSuggestion(
        "Kim_Osgood_Blue_Garden_copy.tif",
        "Blue Garden",
        true,
        "alias then copy",
      );
      assertSuggestion(
        "Copy of KO_Blue_Garden.tif",
        "Blue Garden",
        true,
        "copy of then KO",
      );
      assertSuggestion(
        "KO_Blue_Garden_copy_2.tif",
        "Blue Garden",
        true,
        "KO and copy 2",
      );
    },
  },
  {
    name: "copy inside ordinary words or titles is not removed",
    run: () => {
      assertSuggestion("copyright_notice.tif", "Copyright Notice", false, "copyright");
      assertSuggestion("photocopy.tif", "Photocopy", false, "photocopy");
      assertSuggestion("Blue_copy_Garden.tif", "Blue Copy Garden", false, "copy in middle");
      const noise = stripFilenameNoise("blue garden");
      assertEqual(noise.remainder, "blue garden", "no noise remainder");
      assertEqual(noise.removed, false, "no noise removed");
    },
  },
  {
    name: "pascalCase and camelCase titles are split before lowercasing",
    run: () => {
      assertEqual(
        splitCamelCaseBoundaries("OpenSpace"),
        "Open Space",
        "OpenSpace",
      );
      assertEqual(
        splitCamelCaseBoundaries("TulipTree"),
        "Tulip Tree",
        "TulipTree",
      );
      assertEqual(
        splitCamelCaseBoundaries("ADelight"),
        "A Delight",
        "ADelight",
      );
      assertEqual(
        splitCamelCaseBoundaries("RGBStudy"),
        "RGB Study",
        "RGBStudy",
      );
      assertEqual(
        splitCamelCaseBoundaries("USAFlowers"),
        "USA Flowers",
        "USAFlowers",
      );
      assertEqual(
        splitCamelCaseBoundaries("USA"),
        "USA",
        "does not split true acronym",
      );
      assertEqual(
        splitCamelCaseBoundaries("KO_OpenSpace"),
        "KO_Open Space",
        "does not split KO",
      );
      assertSuggestion("OpenSpace.tif", "Open Space", false, "OpenSpace");
      assertSuggestion("TulipTree.tif", "Tulip Tree", false, "TulipTree");
      assertSuggestion("FreshFlowers.tif", "Fresh Flowers", false, "FreshFlowers");
      assertSuggestion("AtPeace.tif", "At Peace", false, "AtPeace");
      assertSuggestion("ToProsper.tif", "To Prosper", false, "ToProsper");
      assertSuggestion("AtPeaceAgain.tif", "At Peace Again", false, "AtPeaceAgain");
      assertSuggestion("openSpace.tif", "Open Space", false, "camelCase");
    },
  },
  {
    name: "single-letter words and mixed-case acronyms are split",
    run: () => {
      assertSuggestion("ADelight.tif", "A Delight", false, "ADelight");
      assertSuggestion("AToast.tif", "A Toast", false, "AToast");
      assertSuggestion("RGBStudy.tif", "RGB Study", false, "RGBStudy");
      assertSuggestion("USAFlowers.tif", "USA Flowers", false, "USAFlowers");
      assertSuggestion("BLUE_GARDEN.tif", "Blue Garden", false, "all-caps still title-cases");
    },
  },
  {
    name: "Osgood and Osgoods aliases are stripped as standalone tokens",
    run: () => {
      assertSuggestion("Osgood_InBalance.tif", "In Balance", true, "Osgood_InBalance");
      assertSuggestion("Osgoods_InBalance.tif", "In Balance", true, "Osgoods_InBalance");
      assertSuggestion("OsgoodInBalance.tif", "In Balance", true, "OsgoodInBalance");
      assertSuggestion("OsgoodsInBalance.tif", "In Balance", true, "OsgoodsInBalance");
      assertSuggestion("123_Osgood_InBalance.tif", "In Balance", true, "123_Osgood_InBalance");
      assertSuggestion(
        "123_Osgoods_InBalance_6x8.tif",
        "In Balance",
        true,
        "123_Osgoods_InBalance_6x8",
      );
      assertSuggestion("KimOsgood_InBalance.tif", "In Balance", true, "KimOsgood_InBalance");
      assertSuggestion("KO_InBalance.tif", "In Balance", true, "KO_InBalance");
      assertSuggestion(
        "scan_Osgoods_InBalance.tif",
        "Scan In Balance",
        true,
        "scan_Osgoods_InBalance",
      );
      assertSuggestion("Osgood_OpenSpace.tif", "Open Space", true, "Osgood prefix");
      assertSuggestion("OpenSpace_Osgood.tif", "Open Space", true, "Osgood suffix");
      assertSuggestion("osgood_AtPeace.tif", "At Peace", true, "osgood lower");
    },
  },
  {
    name: "leading numeric bookkeeping tokens are stripped",
    run: () => {
      const stripped = stripLeadingNumericToken("123 osgood open space");
      assertEqual(stripped.remainder, "osgood open space", "remainder");
      assertEqual(stripped.removed, true, "removed");
      const kept = stripLeadingNumericToken("summer study 3");
      assertEqual(kept.remainder, "summer study 3", "trailing number kept");
      assertEqual(kept.removed, false, "not removed");
      assertSuggestion("123_Osgood_OpenSpace.tif", "Open Space", true, "123_Osgood");
      assertSuggestion("123_Osgood_ADelight.tif", "A Delight", true, "123_Osgood_ADelight");
      assertSuggestion("001_KimOsgood_TulipTree.tif", "Tulip Tree", true, "001_KimOsgood");
      assertSuggestion("001_KimOsgood_AToast.tif", "A Toast", true, "001_KimOsgood_AToast");
      assertSuggestion("1045_OpenSpace.tif", "Open Space", false, "1045_OpenSpace");
      assertSuggestion("1045_Osgood_OpenSpace.tif", "Open Space", true, "1045_Osgood_OpenSpace");
      assertSuggestion("001_Osgood_AtPeace.tif", "At Peace", true, "001_Osgood_AtPeace");
    },
  },
  {
    name: "studio filename conventions combine aliases, numbers, and PascalCase",
    run: () => {
      assertSuggestion("123_Osgood_OpenSpace.tif", "Open Space", true, "123_Osgood_OpenSpace");
      assertSuggestion("123_Osgood_ADelight.tif", "A Delight", true, "123_Osgood_ADelight");
      assertSuggestion("001_KimOsgood_AToast.tif", "A Toast", true, "001_KimOsgood_AToast");
      assertSuggestion("1045_Osgood_OpenSpace.tif", "Open Space", true, "1045_Osgood_OpenSpace");
      assertSuggestion("Osgood_OpenSpace.tif", "Open Space", true, "Osgood_OpenSpace");
      assertSuggestion("Kim_Osgood_OpenSpace.tif", "Open Space", true, "Kim_Osgood_OpenSpace");
      assertSuggestion("KimOsgood_OpenSpace.tif", "Open Space", true, "KimOsgood_OpenSpace");
      assertSuggestion("KO_OpenSpace.tif", "Open Space", true, "KO_OpenSpace");
      assertSuggestion("OpenSpace.tif", "Open Space", false, "OpenSpace");
      assertSuggestion("TulipTree.tif", "Tulip Tree", false, "TulipTree");
      assertSuggestion("Tulip-Tree.tif", "Tulip Tree", false, "Tulip-Tree");
      assertSuggestion("001_Osgood_AtPeace.tif", "At Peace", true, "001_Osgood_AtPeace");
      assertSuggestion("Blue_Garden.jpg", "Blue Garden", false, "Blue_Garden");
      assertSuggestion("Blue Garden (1).tif", "Blue Garden", false, "Blue Garden (1)");
      assertSuggestion("Blue_Garden_copy_2.tif", "Blue Garden", false, "Blue_Garden_copy_2");
      assertSuggestion("summer-study-3.tif", "Summer Study 3", false, "summer-study-3");
      assertSuggestion("blue_garden_ii.tif", "Blue Garden II", false, "blue_garden_ii");
      assertSuggestion("Koi_Pond.tif", "Koi Pond", false, "Koi_Pond");
      assertSuggestion(
        "Copy of 123_Osgood_OpenSpace.tif",
        "Open Space",
        true,
        "copy of then 123_Osgood",
      );
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
  {
    name: "standalone dimension tokens are stripped from filename titles",
    run: () => {
      const stripped = stripDimensionMetadata("open space 6x8");
      assertEqual(stripped.remainder, "open space", "6x8 remainder");
      assertEqual(stripped.removed, true, "6x8 removed");
      const kept = stripDimensionMetadata("open space");
      assertEqual(kept.remainder, "open space", "no dimension remainder");
      assertEqual(kept.removed, false, "no dimension removed");
      const texas = stripDimensionMetadata("texas garden");
      assertEqual(texas.remainder, "texas garden", "x in words kept");
      assertEqual(texas.removed, false, "x in words not removed");

      assertSuggestion("OpenSpace_6x8.tif", "Open Space", false, "OpenSpace_6x8");
      assertSuggestion("6x8_OpenSpace.tif", "Open Space", false, "6x8_OpenSpace");
      assertSuggestion("Osgood_OpenSpace_6x8.tif", "Open Space", true, "Osgood_OpenSpace_6x8");
      assertSuggestion(
        "123_Osgood_ADelight_6x8.tif",
        "A Delight",
        true,
        "123_Osgood_ADelight_6x8",
      );
      assertSuggestion("TulipTree_12x16.jpg", "Tulip Tree", false, "TulipTree_12x16");
      assertSuggestion("FreshFlowers_24X30.tif", "Fresh Flowers", false, "FreshFlowers_24X30");
      assertSuggestion("OpenSpace_6 x 8.tif", "Open Space", false, "OpenSpace_6 x 8");
      assertSuggestion("OpenSpace_6.5x8.tif", "Open Space", false, "OpenSpace_6.5x8");
      assertSuggestion("Sculpture_6x8x2.tif", "Sculpture", false, "Sculpture_6x8x2");
      assertSuggestion("OpenSpace_6x8in.tif", "Open Space", false, "OpenSpace_6x8in");
      assertSuggestion("OpenSpace_6x8 in.tif", "Open Space", false, "OpenSpace_6x8 in");
      assertSuggestion("OpenSpace_6x8 inches.tif", "Open Space", false, "OpenSpace_6x8 inches");
      assertSuggestion("OpenSpace_12x16\".tif", "Open Space", false, "OpenSpace_12x16\"");
      assertSuggestion("FreshFlowers_24x30cm.tif", "Fresh Flowers", false, "FreshFlowers_24x30cm");
      assertSuggestion("OpenSpace_12 X 16.tif", "Open Space", false, "OpenSpace_12 X 16");
      assertSuggestion("Sculpture_12 x 16 x 1.5.tif", "Sculpture", false, "3D spaced decimals");
    },
  },
  {
    name: "ordinary title numbers are not treated as dimensions",
    run: () => {
      assertSuggestion("SummerStudy3.tif", "Summer Study 3", false, "SummerStudy3");
      assertSuggestion("Garden_2.tif", "Garden 2", false, "Garden_2");
      assertSuggestion("summer-study-3.tif", "Summer Study 3", false, "summer-study-3");
      assertSuggestion("BlueGardenII.tif", "Blue Garden II", false, "BlueGardenII");
      assertSuggestion("Texas_Garden.tif", "Texas Garden", false, "Texas");
      assertSuggestion("Example_Next.tif", "Example Next", false, "x in Example");
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
