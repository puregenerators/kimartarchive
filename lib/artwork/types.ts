export const DIMENSION_UNITS = ["in", "cm"] as const;
export type DimensionUnit = (typeof DIMENSION_UNITS)[number];

/** Local preview IDs begin here and increment by artwork order. */
export const PREVIEW_INVENTORY_BASE = 1000;

/** Direct-to-Dropbox temporary-upload-link cap. Larger masters use Dropbox intake. */
export const MAX_FILE_BYTES = 150 * 1024 * 1024;

/** Operator-facing label for {@link MAX_FILE_BYTES}. */
export const MAX_FILE_SIZE_LABEL = "150 MB";

export function requiresLargeFileDropboxIntake(byteLength: number): boolean {
  return Number.isFinite(byteLength) && byteLength > MAX_FILE_BYTES;
}

/** Product hard cap for total source bytes in one batch. */
export const MAX_BATCH_BYTES = 750 * 1024 * 1024;

/**
 * Hard cap on source artworks per batch (one user-selected file each).
 * Derivative files generated later do not count against this limit.
 * Still subject to {@link MAX_BATCH_BYTES}.
 */
export const MAX_ARTWORKS_PER_BATCH = 24;

export function remainingArtworkSlots(currentCount: number): number {
  return Math.max(0, MAX_ARTWORKS_PER_BATCH - currentCount);
}

export type BatchSharedDetails = {
  exhibition: string;
  gallery: string;
  exhibitionYear: string;
  defaultArtworkYear: string;
  photographer: string;
  defaultMedium: string;
  defaultDimensionUnit: DimensionUnit;
};

export type ArtworkOverrideFields = {
  exhibition: string;
  gallery: string;
  photographer: string;
};

export type ArtworkImage = {
  file: File;
  previewUrl: string | null;
  isTiff: boolean;
};

export type ArtworkDraft = {
  id: string;
  title: string;
  /** True when title was auto-filled from the filename and not yet edited. */
  titleSuggestedFromFilename: boolean;
  /** True when the filename suggestion stripped a configured artist alias. */
  titleArtistAliasRemoved: boolean;
  /**
   * Transient UI/validation flag: archive title as exactly `Untitled`.
   * Not a Google Sheets column. Typed `title` is preserved for restore.
   */
  isUntitled: boolean;
  year: string;
  medium: string;
  height: string;
  width: string;
  depth: string;
  dimensionUnit: DimensionUnit;
  notes: string;
  overrides: ArtworkOverrideFields;
  /** Exactly one source file per artwork when present. */
  image: ArtworkImage | null;
};

export type BatchDraft = {
  shared: BatchSharedDetails;
  artworks: ArtworkDraft[];
};

export type ArtworkValidationErrors = Partial<
  Record<
    | "title"
    | "year"
    | "medium"
    | "height"
    | "width"
    | "depth"
    | "dimensionUnit"
    | "image",
    string
  >
>;

export type BatchValidationResult = {
  form?: string;
  artworks: Record<string, ArtworkValidationErrors>;
};

export const EMPTY_SHARED_DETAILS: BatchSharedDetails = {
  exhibition: "",
  gallery: "",
  exhibitionYear: "",
  defaultArtworkYear: "",
  photographer: "",
  defaultMedium: "",
  defaultDimensionUnit: "in",
};

export const EMPTY_OVERRIDES: ArtworkOverrideFields = {
  exhibition: "",
  gallery: "",
  photographer: "",
};

/** Keys that can be selectively applied from shared details onto artworks. */
export type ApplyableSharedFieldKey =
  | "year"
  | "medium"
  | "dimensionUnit"
  | "exhibition"
  | "gallery"
  | "photographer";

/** Fields copied from shared defaults onto artwork cards. */
export const APPLYABLE_SHARED_FIELDS: ReadonlyArray<{
  key: ApplyableSharedFieldKey;
  label: string;
  from: string;
}> = [
  { key: "year", label: "Artwork Year", from: "Default Artwork Year" },
  { key: "medium", label: "Medium", from: "Default Medium" },
  { key: "dimensionUnit", label: "Dimension Unit", from: "Default Dimension Unit" },
  { key: "exhibition", label: "Exhibition override", from: "Exhibition" },
  { key: "gallery", label: "Gallery / Venue override", from: "Gallery / Venue" },
  { key: "photographer", label: "Photographer override", from: "Photographer" },
];

export const DEFAULT_APPLY_SELECTION: ApplyableSharedFieldKey[] =
  APPLYABLE_SHARED_FIELDS.map((field) => field.key);

export function createArtworkId(): string {
  return crypto.randomUUID();
}

export function createArtworkDraft(
  shared: BatchSharedDetails,
  options?: {
    image?: ArtworkImage | null;
    title?: string;
    titleSuggestedFromFilename?: boolean;
    titleArtistAliasRemoved?: boolean;
    isUntitled?: boolean;
  },
): ArtworkDraft {
  return {
    id: createArtworkId(),
    title: options?.title ?? "",
    titleSuggestedFromFilename: options?.titleSuggestedFromFilename ?? false,
    titleArtistAliasRemoved: options?.titleArtistAliasRemoved ?? false,
    isUntitled: options?.isUntitled ?? false,
    year: shared.defaultArtworkYear,
    medium: shared.defaultMedium,
    height: "",
    width: "",
    depth: "",
    dimensionUnit: shared.defaultDimensionUnit,
    notes: "",
    overrides: { ...EMPTY_OVERRIDES },
    image: options?.image ?? null,
  };
}

/** Empty batch: no placeholder artwork cards. Upload creates drafts. */
export function createEmptyBatch(): BatchDraft {
  return {
    shared: { ...EMPTY_SHARED_DETAILS },
    artworks: [],
  };
}

export function previewInventoryIdForIndex(index: number): number {
  return PREVIEW_INVENTORY_BASE + index;
}

export function formatArtworkNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}

export function effectiveOverride(
  artworkValue: string,
  sharedValue: string,
): string {
  return artworkValue.trim() ? artworkValue : sharedValue;
}

const hasText = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

/**
 * Apply selected shared defaults onto artworks.
 * Only populated shared fields are copied; blank / whitespace shared values
 * leave each artwork’s existing value unchanged.
 * Never overwrites Title, the untitled flag, Height, Width, Depth, Notes, or image.
 * Exhibition / gallery / photographer write into override fields when selected.
 */
export function applySharedDetailsToArtworks(
  artworks: ArtworkDraft[],
  shared: BatchSharedDetails,
  selectedKeys: readonly ApplyableSharedFieldKey[] = DEFAULT_APPLY_SELECTION,
): ArtworkDraft[] {
  const selected = new Set(selectedKeys);

  const sharedPatch = {
    ...(selected.has("year") &&
      hasText(shared.defaultArtworkYear) && {
        year: shared.defaultArtworkYear.trim(),
      }),
    ...(selected.has("medium") &&
      hasText(shared.defaultMedium) && {
        medium: shared.defaultMedium.trim(),
      }),
    ...(selected.has("dimensionUnit") && {
      dimensionUnit: shared.defaultDimensionUnit,
    }),
    ...(selected.has("exhibition") &&
      hasText(shared.exhibition) && {
        exhibition: shared.exhibition.trim(),
      }),
    ...(selected.has("gallery") &&
      hasText(shared.gallery) && {
        gallery: shared.gallery.trim(),
      }),
    ...(selected.has("photographer") &&
      hasText(shared.photographer) && {
        photographer: shared.photographer.trim(),
      }),
  };

  return artworks.map((artwork) => ({
    ...artwork,
    ...("year" in sharedPatch && { year: sharedPatch.year }),
    ...("medium" in sharedPatch && { medium: sharedPatch.medium }),
    ...("dimensionUnit" in sharedPatch && {
      dimensionUnit: sharedPatch.dimensionUnit,
    }),
    overrides: {
      ...artwork.overrides,
      ...("exhibition" in sharedPatch && {
        exhibition: sharedPatch.exhibition,
      }),
      ...("gallery" in sharedPatch && { gallery: sharedPatch.gallery }),
      ...("photographer" in sharedPatch && {
        photographer: sharedPatch.photographer,
      }),
    },
  }));
}
