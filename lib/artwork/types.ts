export const DIMENSION_UNITS = ["in", "cm"] as const;
export type DimensionUnit = (typeof DIMENSION_UNITS)[number];

export const STATUS_VALUES = [
  "Available",
  "Sold",
  "Reserved",
  "Consigned",
  "On Loan",
  "Not for Sale",
  "Gifted",
  "Archived",
] as const;
export type ArtworkStatus = (typeof STATUS_VALUES)[number];

/** Local preview IDs begin here and increment by artwork order. */
export const PREVIEW_INVENTORY_BASE = 1000;

export const MAX_FILE_BYTES = 250 * 1024 * 1024;

/** Product hard cap for total source bytes in one batch. */
export const MAX_BATCH_BYTES = 750 * 1024 * 1024;

/**
 * Hard cap on artworks per batch. Typical working batches are 10–12;
 * 24 leaves room for a large documentation session without unbounded UI state.
 */
export const MAX_ARTWORKS_PER_BATCH = 24;

export type BatchSharedDetails = {
  exhibition: string;
  gallery: string;
  exhibitionYear: string;
  defaultArtworkYear: string;
  photographer: string;
  defaultLocation: string;
  defaultMedium: string;
  defaultStatus: ArtworkStatus | "";
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
  year: string;
  medium: string;
  height: string;
  width: string;
  depth: string;
  dimensionUnit: DimensionUnit;
  edition: string;
  status: ArtworkStatus | "";
  location: string;
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
    | "status"
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
  defaultLocation: "",
  defaultMedium: "",
  defaultStatus: "",
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
  | "status"
  | "dimensionUnit"
  | "location"
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
  { key: "status", label: "Status", from: "Default Status" },
  { key: "dimensionUnit", label: "Dimension Unit", from: "Default Dimension Unit" },
  { key: "location", label: "Location", from: "Default Location" },
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
  },
): ArtworkDraft {
  return {
    id: createArtworkId(),
    title: options?.title ?? "",
    titleSuggestedFromFilename: options?.titleSuggestedFromFilename ?? false,
    year: shared.defaultArtworkYear,
    medium: shared.defaultMedium,
    height: "",
    width: "",
    depth: "",
    dimensionUnit: shared.defaultDimensionUnit,
    edition: "",
    status: shared.defaultStatus,
    location: shared.defaultLocation,
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

/**
 * Apply selected shared defaults onto artworks.
 * Never overwrites Title, Height, Width, Depth, Edition, Notes, or image.
 * Exhibition / gallery / photographer write into override fields when selected.
 */
export function applySharedDetailsToArtworks(
  artworks: ArtworkDraft[],
  shared: BatchSharedDetails,
  selectedKeys: readonly ApplyableSharedFieldKey[] = DEFAULT_APPLY_SELECTION,
): ArtworkDraft[] {
  const selected = new Set(selectedKeys);

  return artworks.map((artwork) => {
    const next: ArtworkDraft = { ...artwork, overrides: { ...artwork.overrides } };

    if (selected.has("year")) next.year = shared.defaultArtworkYear;
    if (selected.has("medium")) next.medium = shared.defaultMedium;
    if (selected.has("status")) next.status = shared.defaultStatus;
    if (selected.has("dimensionUnit")) {
      next.dimensionUnit = shared.defaultDimensionUnit;
    }
    if (selected.has("location")) next.location = shared.defaultLocation;
    if (selected.has("exhibition")) {
      next.overrides.exhibition = shared.exhibition;
    }
    if (selected.has("gallery")) {
      next.overrides.gallery = shared.gallery;
    }
    if (selected.has("photographer")) {
      next.overrides.photographer = shared.photographer;
    }

    return next;
  });
}
