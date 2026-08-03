import {
  DEFAULT_ARTIST_PROFILE,
  type ArtistProfile,
} from "@/lib/artwork/artist-profile";

export type SuggestedTitle = {
  title: string;
  /** True when a configured artist alias was stripped from the filename. */
  removedArtistAlias: boolean;
};

/** Collapse delimiter runs and lowercase for alias comparison. */
export function normalizeFilenameKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[._\-]+/gu, " ")
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

/** Title-case one token; preserve apostrophes, numbers, and roman numerals. */
export function titleCaseWord(word: string): string {
  if (/^\d+$/u.test(word)) {
    return word;
  }
  if (isRomanNumeral(word)) {
    return word.toUpperCase();
  }

  const lower = word.toLowerCase();
  // Capitalize the first letter only so possessives stay natural (Artist's).
  return lower.replace(/^\p{L}/u, (letter) => letter.toUpperCase());
}

export function titleCasePhrase(value: string): string {
  return value
    .split(/\s+/u)
    .filter(Boolean)
    .map(titleCaseWord)
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

/**
 * Remove a single leading or trailing artist alias token sequence.
 * Aliases must be whole delimited units (not substrings inside words).
 */
function stripOneAlias(
  normalized: string,
  aliasKeys: readonly string[],
): { remainder: string; removed: boolean } {
  for (const key of aliasKeys) {
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

/**
 * Strip artist aliases from a normalized filename stem (prefix and/or suffix).
 * Repeats until no more edge aliases match (e.g. KO_Kim_Osgood_Blue_Garden).
 */
export function stripArtistAliases(
  normalizedStem: string,
  aliases: readonly string[],
): { remainder: string; removed: boolean } {
  const aliasKeys = uniqueAliasKeys(aliases);
  let current = normalizedStem;
  let removed = false;

  while (current) {
    const pass = stripOneAlias(current, aliasKeys);
    if (!pass.removed) break;
    removed = true;
    current = pass.remainder;
  }

  return { remainder: current, removed };
}

/**
 * Derive a suggested artwork title from a source filename.
 *
 * - Strips path and extension
 * - Removes configured artist aliases at filename edges only
 * - Replaces underscores/hyphens/periods used as separators with spaces
 * - Collapses whitespace, trims, title-cases
 * - Preserves apostrophes, roman numerals, and numbers
 */
export function suggestTitleFromFilename(
  filename: string,
  profile: ArtistProfile = DEFAULT_ARTIST_PROFILE,
): SuggestedTitle {
  const base = filename.replace(/^.*[/\\]/u, "");
  const withoutExt = base.replace(/\.[^.]+$/u, "");
  const normalized = normalizeFilenameKey(withoutExt);
  const { remainder, removed } = stripArtistAliases(
    normalized,
    profile.filenameAliases,
  );

  return {
    title: titleCasePhrase(remainder),
    removedArtistAlias: removed,
  };
}
