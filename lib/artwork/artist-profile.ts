/**
 * Per-artist normalization config for filename → title suggestions.
 *
 * Parser logic reads aliases from a profile so future artists can supply
 * different names without changing the suggestion algorithm.
 */

export type ArtistProfile = {
  artistName: string;
  /** Filename prefixes/suffixes treated as artist identifiers, not title text. */
  filenameAliases: readonly string[];
};

/**
 * Default archive artist. Aliases cover common delimiter and initial variants;
 * matching is case-insensitive and delimiter-flexible in the suggester.
 */
export const DEFAULT_ARTIST_PROFILE: ArtistProfile = {
  artistName: "Kim Osgood",
  filenameAliases: [
    "Kim Osgood",
    "Kim_Osgood",
    "Kim-Osgood",
    "kim osgood",
    "kim_osgood",
    "kim-osgood",
    "KimOsgood",
    "kimosgood",
    "KO",
    "K.O.",
    "KO_",
    "KO-",
    "ko",
  ],
};
