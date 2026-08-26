import {
  DEFAULT_ARTIST_PROFILE,
  type ArtistProfile,
} from "@/lib/artwork/artist-profile";

export type SuggestedTitle = {
  title: string;
  /** True when a configured artist alias was stripped from the filename. */
  removedArtistAlias: boolean;
};

/**
 * Insert spaces at camelCase / PascalCase word boundaries.
 * Must run before lowercasing so capitalization is still available.
 *
 * - lowercase/digit → uppercase (`OpenSpace` → `Open Space`)
 * - acronym → capitalized word (`ADelight` → `A Delight`, `RGBStudy` → `RGB Study`)
 * - letter → digit (`SummerStudy3` → `Summer Study 3`)
 *
 * Does not insert spaces between letters of a true acronym (`USA` stays `USA`).
 */
export function splitCamelCaseBoundaries(value: string): string {
  return value
    .replace(/(\p{Ll}|\p{Nd})(\p{Lu})/gu, "$1 $2")
    .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, "$1 $2")
    .replace(/(\p{Ll})(\p{Nd})/gu, "$1 $2");
}

/**
 * All-caps tokens (length ≥ 2) produced by camelCase splitting, keyed in lowercase.
 * All-caps filenames are ignored so `BLUE GARDEN` still title-cases normally.
 * Delimiter-separated words (`ko_BLUE_garden`) are not treated as acronyms.
 */
function collectAcronymKeys(spaced: string): ReadonlySet<string> {
  if (!/\p{Ll}/u.test(spaced) || !/\p{Lu}/u.test(spaced)) {
    return new Set();
  }
  const keys = new Set<string>();
  for (const token of spaced.split(/\s+/u)) {
    if (/^\p{Lu}{2,}$/u.test(token)) {
      keys.add(token.toLowerCase());
    }
  }
  return keys;
}

/** Collapse delimiter runs and lowercase for alias comparison. */
export function normalizeFilenameKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_\-]+/gu, " ")
    // Keep decimal points (`6.5x8`); treat other periods as separators.
    .replace(/(?<!\d)\.(?!\d)/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Valid roman numerals only (avoids matching ordinary words like "civil").
 * Empty string is not a numeral.
 */
export function isRomanNumeral(word: string): boolean {
  if (!word) return false;
  return /^(?=[MDCLXVI])M{0,4}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/i.test(
    word,
  );
}

/** Title-case one token; preserve apostrophes, numbers, roman numerals, and acronyms. */
export function titleCaseWord(
  word: string,
  acronyms?: ReadonlySet<string>,
): string {
  if (/^\d+$/u.test(word)) {
    return word;
  }
  if (isRomanNumeral(word)) {
    return word.toUpperCase();
  }
  if (acronyms?.has(word.toLowerCase())) {
    return word.toUpperCase();
  }

  const lower = word.toLowerCase();
  // Capitalize the first letter only so possessives stay natural (Artist's).
  return lower.replace(/^\p{L}/u, (letter) => letter.toUpperCase());
}

export function titleCasePhrase(
  value: string,
  acronyms?: ReadonlySet<string>,
): string {
  return value
    .split(/\s+/u)
    .filter(Boolean)
    .map((word) => titleCaseWord(word, acronyms))
    .join(" ");
}

function uniqueAliasKeys(aliases: readonly string[]): string[] {
  const keys = new Set<string>();
  for (const alias of aliases) {
    const key = normalizeFilenameKey(alias);
    if (key) keys.add(key);
  }
  return [...keys].sort((a, b) => b.length - a.length);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * Duplicate-file markers stripped from filename edges during title suggestion.
 * Longer phrases first so "copy of" wins over "copy".
 */
const FILENAME_NOISE_PHRASES = ["copy of", "copy"] as const;

const NUMBERED_COPY_PREFIX = /^copy\s+\d+\s+/u;
const NUMBERED_COPY_SUFFIX = /\s+copy\s+\d+$/u;
const PAREN_COPY_PREFIX = /^\(copy(?:\s+\d+)?\)\s+/u;
const PAREN_COPY_SUFFIX = /\s+\(copy(?:\s+\d+)?\)$/u;
/** Trailing `(1)` / `(2)` duplicate-export markers. */
const PAREN_NUMBER_SUFFIX = /\s*\(\d+\)$/u;
const LEADING_NUMERIC_TOKEN = /^\d+(?:\s+|$)/u;

/** Integer or decimal measurement used in filename dimension tokens. */
const DIMENSION_NUMBER = String.raw`\d+(?:\.\d+)?`;
/**
 * Standalone WxH or WxHxD token, optional unit.
 * Matches `6x8`, `6 x 8`, `6.5x8`, `6x8x2`, `12 x 16 x 1.5`, `6x8in`, `12x16"`.
 */
const DIMENSION_TOKEN = new RegExp(
  String.raw`(^|\s)(?:${DIMENSION_NUMBER}\s*x\s*){1,2}${DIMENSION_NUMBER}(?:\s*(?:inches|inch|in|cm|"))?(?=\s|$)`,
  "gu",
);

/**
 * Strip standalone numeric dimension tokens such as `6x8`, `6 x 8`, `6.5x8`,
 * `6x8x2`, and the same forms with units (`in`, `inches`, `cm`, `"`).
 * Does not remove ordinary title numbers or the letter `x` inside words.
 */
export function stripDimensionMetadata(
  normalizedStem: string,
): { remainder: string; removed: boolean } {
  DIMENSION_TOKEN.lastIndex = 0;
  const next = normalizedStem
    .replace(DIMENSION_TOKEN, "$1")
    .replace(/\s+/gu, " ")
    .trim();
  return {
    remainder: next,
    removed: next !== normalizedStem,
  };
}

/**
 * Strip one standalone all-digit token from the start of a normalized stem.
 * Leading scan/export IDs are bookkeeping; later title numbers are left alone.
 */
export function stripLeadingNumericToken(
  normalizedStem: string,
): { remainder: string; removed: boolean } {
  const match = normalizedStem.match(LEADING_NUMERIC_TOKEN);
  if (!match) {
    return { remainder: normalizedStem, removed: false };
  }
  return {
    remainder: normalizedStem.slice(match[0].length).trim(),
    removed: true,
  };
}

/**
 * Remove a single leading or trailing phrase.
 * Phrases must be whole delimited units (not substrings inside words).
 */
function stripOneEdgePhrase(
  normalized: string,
  phraseKeys: readonly string[],
): { remainder: string; removed: boolean } {
  for (const key of phraseKeys) {
    if (normalized === key) {
      return { remainder: "", removed: true };
    }
    if (normalized.startsWith(`${key} `)) {
      return { remainder: normalized.slice(key.length + 1), removed: true };
    }
    if (normalized.endsWith(` ${key}`)) {
      return {
        remainder: normalized.slice(0, normalized.length - key.length - 1),
        removed: true,
      };
    }
  }
  return { remainder: normalized, removed: false };
}

function stripEdgePhrases(
  normalizedStem: string,
  phrases: readonly string[],
): { remainder: string; removed: boolean } {
  const keys = uniqueAliasKeys(phrases);
  let current = normalizedStem;
  let removed = false;

  while (current) {
    const pass = stripOneEdgePhrase(current, keys);
    if (!pass.removed) break;
    removed = true;
    current = pass.remainder;
  }

  return { remainder: current, removed };
}

/**
 * Remove known phrases wherever they appear as complete space-delimited
 * token sequences. Does not match inside other words (`ko` leaves `tokyo`).
 */
function stripStandalonePhrases(
  normalizedStem: string,
  phrases: readonly string[],
): { remainder: string; removed: boolean } {
  const keys = uniqueAliasKeys(phrases);
  let current = normalizedStem;
  let removed = false;

  while (current) {
    let next = current;
    for (const key of keys) {
      const pattern = new RegExp(
        `(^|\\s)${escapeRegExp(key)}(?=\\s|$)`,
        "gu",
      );
      next = next.replace(pattern, "$1").replace(/\s+/gu, " ").trim();
    }
    if (next === current) break;
    removed = true;
    current = next;
  }

  return { remainder: current, removed };
}

/**
 * Strip artist aliases from a normalized filename stem.
 * Matches complete tokens/phrases anywhere, not only at the edges
 * (e.g. `scan_Osgoods_InBalance` and `KO_Kim_Osgood_Blue_Garden`).
 */
export function stripArtistAliases(
  normalizedStem: string,
  aliases: readonly string[],
): { remainder: string; removed: boolean } {
  return stripStandalonePhrases(normalizedStem, aliases);
}

/**
 * Strip duplicate markers such as "copy", "copy 2", "copy of", and trailing `(1)`.
 */
export function stripFilenameNoise(
  normalizedStem: string,
): { remainder: string; removed: boolean } {
  let current = normalizedStem;
  let removed = false;

  while (current) {
    const phrases = stripEdgePhrases(current, FILENAME_NOISE_PHRASES);
    let next = phrases.remainder;
    if (phrases.removed) removed = true;

    const withoutNumbered = next
      .replace(NUMBERED_COPY_PREFIX, "")
      .replace(NUMBERED_COPY_SUFFIX, "")
      .replace(PAREN_COPY_PREFIX, "")
      .replace(PAREN_COPY_SUFFIX, "")
      .replace(PAREN_NUMBER_SUFFIX, "")
      .replace(/\s+/gu, " ")
      .trim();

    if (withoutNumbered !== next) {
      removed = true;
      next = withoutNumbered;
    }

    if (next === current) break;
    current = next;
  }

  return { remainder: current, removed };
}

/**
 * Derive a suggested artwork title from a source filename.
 *
 * - Strips path and extension
 * - Splits camelCase / PascalCase before lowercasing (including `ADelight` → `A Delight`)
 * - Preserves mixed-case acronyms such as `RGB` / `USA`
 * - Replaces underscores/hyphens/separator periods with spaces (keeps decimals)
 * - Removes standalone dimension tokens such as `6x8`, `6 x 8`, `6x8in`
 * - Removes a leading all-numeric bookkeeping token
 * - Removes configured artist aliases as standalone tokens/phrases
 * - Removes duplicate markers such as "copy", "copy 2", "copy of", and `(1)`
 * - Collapses whitespace, trims, title-cases
 * - Preserves apostrophes, roman numerals, and non-leading title numbers
 */
export function suggestTitleFromFilename(
  filename: string,
  profile: ArtistProfile = DEFAULT_ARTIST_PROFILE,
): SuggestedTitle {
  const base = filename.replace(/^.*[/\\]/u, "");
  const withoutExt = base.replace(/\.[^.]+$/u, "");
  const withBoundaries = splitCamelCaseBoundaries(withoutExt);
  const acronyms = collectAcronymKeys(withBoundaries);
  let remainder = normalizeFilenameKey(withBoundaries);
  let removedArtistAlias = false;

  while (remainder) {
    const dimensions = stripDimensionMetadata(remainder);
    const numeric = stripLeadingNumericToken(dimensions.remainder);
    const alias = stripArtistAliases(numeric.remainder, profile.filenameAliases);
    const noise = stripFilenameNoise(alias.remainder);
    if (
      !dimensions.removed &&
      !numeric.removed &&
      !alias.removed &&
      !noise.removed
    ) {
      break;
    }
    if (alias.removed) removedArtistAlias = true;
    remainder = noise.remainder;
  }

  return {
    title: titleCasePhrase(remainder, acronyms),
    removedArtistAlias,
  };
}
