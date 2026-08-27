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

/** Keys copied from batch details onto artwork cards on Apply. */
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
}> = [
  { key: "year", label: "Artwork Year" },
  { key: "medium", label: "Medium" },
  { key: "dimensionUnit", label: "Dimension Unit" },
  { key: "exhibition", label: "Exhibition" },
  { key: "gallery", label: "Gallery / Venue" },
  { key: "photographer", label: "Photographer" },
];

export const APPLY_SHARED_DETAILS_TITLE =
  "Apply these details to all artworks?";

export const APPLY_SHARED_OVERWRITE_WARNING =
  "Any individual changes already entered in these fields will be replaced.";

export function applySharedDetailsBody(artworkCount: number): string {
  return `This will replace the existing values in these fields for all ${artworkCount} artwork${artworkCount === 1 ? "" : "s"} in the batch. Blank fields will not make any changes.`;
}

export function applySharedDetailsAppliedMessage(artworkCount: number): string {
  return `Details applied to ${artworkCount} artwork${artworkCount === 1 ? "" : "s"}.`;
}

export type PopulatedSharedApplyField = {
  key: ApplyableSharedFieldKey;
  label: string;
  value: string;
};

type SharedApplyPatch = {
  year?: string;
  medium?: string;
  dimensionUnit?: DimensionUnit;
  exhibition?: string;
  gallery?: string;
  photographer?: string;
};

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
 * Copy a newly entered batch field onto artworks that still have a blank value.
 * Does not overwrite a value the user already typed on an individual card.
 * Dimension unit always has a value, so it is left to explicit Apply.
 * Exhibition / gallery / photographer stay as shared fallbacks until Apply
 * writes them into per-artwork overrides.
 */
export function fillBlankArtworkFieldsFromShared(
  artworks: ArtworkDraft[],
  shared: BatchSharedDetails,
  field: keyof BatchSharedDetails,
): ArtworkDraft[] {
  if (field === "defaultArtworkYear") {
    const year = shared.defaultArtworkYear.trim();
    if (!year) return artworks;
    return artworks.map((artwork) =>
      artwork.year.trim() ? artwork : { ...artwork, year },
    );
  }
  if (field === "defaultMedium") {
    const medium = shared.defaultMedium.trim();
    if (!medium) return artworks;
    return artworks.map((artwork) =>
      artwork.medium.trim() ? artwork : { ...artwork, medium },
    );
  }
  return artworks;
}

function formatApplyDimensionUnit(unit: DimensionUnit): string {
  return unit === "in" ? "inches" : unit;
}

function labelForApplyField(key: ApplyableSharedFieldKey): string {
  const field = APPLYABLE_SHARED_FIELDS.find((entry) => entry.key === key);
  return field?.label ?? key;
}

/**
 * Values that Apply copies onto artworks. Uses stored batch data only —
 * empty strings and whitespace are omitted even if the UI shows a placeholder
 * (for example Artwork Year’s “2026” placeholder). Dimension unit is stored as
 * `in` or `cm` on the batch, so it is included. Exhibition year is batch-level
 * only and is never applied to artwork cards.
 */
function sharedApplyPatch(shared: BatchSharedDetails): SharedApplyPatch {
  return {
    ...(hasText(shared.defaultArtworkYear) && {
      year: shared.defaultArtworkYear.trim(),
    }),
    ...(hasText(shared.defaultMedium) && {
      medium: shared.defaultMedium.trim(),
    }),
    dimensionUnit: shared.defaultDimensionUnit,
    ...(hasText(shared.exhibition) && {
      exhibition: shared.exhibition.trim(),
    }),
    ...(hasText(shared.gallery) && {
      gallery: shared.gallery.trim(),
    }),
    ...(hasText(shared.photographer) && {
      photographer: shared.photographer.trim(),
    }),
  };
}

/** Read-only confirmation rows: populated apply fields and their proposed values. */
export function populatedSharedApplyFields(
  shared: BatchSharedDetails,
): PopulatedSharedApplyField[] {
  const patch = sharedApplyPatch(shared);
  const fields: PopulatedSharedApplyField[] = [];
  if (patch.year) {
    fields.push({
      key: "year",
      label: labelForApplyField("year"),
      value: patch.year,
    });
  }
  if (patch.medium) {
    fields.push({
      key: "medium",
      label: labelForApplyField("medium"),
      value: patch.medium,
    });
  }
  if (patch.dimensionUnit) {
    fields.push({
      key: "dimensionUnit",
      label: labelForApplyField("dimensionUnit"),
      value: formatApplyDimensionUnit(patch.dimensionUnit),
    });
  }
  if (patch.exhibition) {
    fields.push({
      key: "exhibition",
      label: labelForApplyField("exhibition"),
      value: patch.exhibition,
    });
  }
  if (patch.gallery) {
    fields.push({
      key: "gallery",
      label: labelForApplyField("gallery"),
      value: patch.gallery,
    });
  }
  if (patch.photographer) {
    fields.push({
      key: "photographer",
      label: labelForApplyField("photographer"),
      value: patch.photographer,
    });
  }
  return fields;
}

function existingArtworkValueForApplyField(
  artwork: ArtworkDraft,
  key: ApplyableSharedFieldKey,
): string {
  switch (key) {
    case "year":
      return artwork.year;
    case "medium":
      return artwork.medium;
    case "dimensionUnit":
      return artwork.dimensionUnit;
    case "exhibition":
      return artwork.overrides.exhibition;
    case "gallery":
      return artwork.overrides.gallery;
    case "photographer":
      return artwork.overrides.photographer;
  }
}

function proposedValueForApplyField(
  patch: SharedApplyPatch,
  key: ApplyableSharedFieldKey,
): string | undefined {
  switch (key) {
    case "year":
      return patch.year;
    case "medium":
      return patch.medium;
    case "dimensionUnit":
      return patch.dimensionUnit;
    case "exhibition":
      return patch.exhibition;
    case "gallery":
      return patch.gallery;
    case "photographer":
      return patch.photographer;
  }
}

/**
 * True when applying populated batch fields would replace a different
 * non-blank value already entered on at least one artwork.
 */
export function sharedApplyWouldOverwrite(
  artworks: ArtworkDraft[],
  shared: BatchSharedDetails,
): boolean {
  const patch = sharedApplyPatch(shared);
  const keys = populatedSharedApplyFields(shared).map((field) => field.key);
  return artworks.some((artwork) =>
    keys.some((key) => {
      const proposed = proposedValueForApplyField(patch, key);
      if (proposed == null) return false;
      const existing = existingArtworkValueForApplyField(artwork, key).trim();
      if (!existing) return false;
      return existing !== proposed;
    }),
  );
}

/**
 * Apply populated shared defaults onto artworks.
 * Only populated shared fields are copied; blank / whitespace shared values
 * leave each artwork’s existing value unchanged.
 * Never overwrites Title, the untitled flag, Height, Width, Depth, Notes, or image.
 * Exhibition / gallery / photographer write into per-artwork override fields.
 */
export function applySharedDetailsToArtworks(
  artworks: ArtworkDraft[],
  shared: BatchSharedDetails,
): ArtworkDraft[] {
  const patch = sharedApplyPatch(shared);

  return artworks.map((artwork) => ({
    ...artwork,
    ...("year" in patch && { year: patch.year }),
    ...("medium" in patch && { medium: patch.medium }),
    ...("dimensionUnit" in patch && {
      dimensionUnit: patch.dimensionUnit,
    }),
    overrides: {
      ...artwork.overrides,
      ...("exhibition" in patch && {
        exhibition: patch.exhibition,
      }),
      ...("gallery" in patch && { gallery: patch.gallery }),
      ...("photographer" in patch && {
        photographer: patch.photographer,
      }),
    },
  }));
}

/**
 * Confirm copies populated batch fields onto every artwork.
 * Cancel returns the same artwork list with no changes.
 */
export function resolveApplySharedDetails(
  artworks: ArtworkDraft[],
  shared: BatchSharedDetails,
  decision: "apply" | "cancel",
): ArtworkDraft[] {
  if (decision !== "apply") return artworks;
  return applySharedDetailsToArtworks(artworks, shared);
}
