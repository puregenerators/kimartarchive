export type AssetType = "master" | "hr" | "web" | "thumb";

export type PlannedFilenames = {
  sequence: string;
  master: string;
  hr: string;
  web: string;
  thumb: string;
  /** Inventory-ID-based portable metadata filename. */
  metadata: string;
};

/** Strip combining marks so accented letters become ASCII equivalents. */
function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "");
}

/**
 * Convert an artwork title into a readable PascalCase filename segment.
 * Preserves letters and digits; drops punctuation, symbols, and unsafe characters.
 */
export function sanitizeTitleForFilename(title: string): string {
  const cleaned = stripDiacritics(title)
    .replace(/['’]/g, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

  if (!cleaned) {
    return "Untitled";
  }

  return cleaned
    .split(" ")
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join("");
}

/** Normalize master file extensions; jpeg → jpg; tiff → tif. */
export function normalizeMasterExtension(filename: string): string {
  const match = /\.([^.]+)$/.exec(filename);
  if (!match) {
    return "";
  }

  const ext = match[1].toLowerCase();
  if (ext === "jpeg" || ext === "jpg") {
    return ".jpg";
  }
  if (ext === "tif" || ext === "tiff") {
    return ".tif";
  }
  if (ext === "png") {
    return ".png";
  }

  return `.${ext}`;
}

export function formatSequence(index: number): string {
  return String(index).padStart(2, "0");
}

export function buildArtworkFilename(params: {
  year: string | number;
  inventoryId: number;
  title: string;
  assetType: AssetType;
  sequence: number;
  extension: string;
}): string {
  const year = String(params.year).trim();
  const sanitizedTitle = sanitizeTitleForFilename(params.title);
  const sequence = formatSequence(params.sequence);
  const ext = params.extension.startsWith(".")
    ? params.extension.toLowerCase()
    : `.${params.extension.toLowerCase()}`;

  return `${year}_KO_${params.inventoryId}_${sanitizedTitle}_${params.assetType}_${sequence}${ext}`;
}

/**
 * Portable metadata filename keyed by Inventory ID so the file remains
 * identifiable if copied or downloaded outside its artwork folder.
 * Example: `1000_metadata.json`
 */
export function buildArtworkMetadataFilename(inventoryId: number): string {
  return `${inventoryId}_metadata.json`;
}

/**
 * Plan master / HR / web / thumbnail filenames for one artwork with a single master image.
 * Sequence is always 01 in the batch intake workflow.
 */
export function planFilenamesForArtwork(params: {
  year: string | number;
  inventoryId: number;
  title: string;
  masterFilename: string;
}): PlannedFilenames {
  const masterExt = normalizeMasterExtension(params.masterFilename) || ".bin";

  return {
    sequence: "01",
    master: buildArtworkFilename({
      year: params.year,
      inventoryId: params.inventoryId,
      title: params.title,
      assetType: "master",
      sequence: 1,
      extension: masterExt,
    }),
    hr: buildArtworkFilename({
      year: params.year,
      inventoryId: params.inventoryId,
      title: params.title,
      assetType: "hr",
      sequence: 1,
      extension: ".jpg",
    }),
    web: buildArtworkFilename({
      year: params.year,
      inventoryId: params.inventoryId,
      title: params.title,
      assetType: "web",
      sequence: 1,
      extension: ".jpg",
    }),
    thumb: buildArtworkFilename({
      year: params.year,
      inventoryId: params.inventoryId,
      title: params.title,
      assetType: "thumb",
      sequence: 1,
      extension: ".jpg",
    }),
    metadata: buildArtworkMetadataFilename(params.inventoryId),
  };
}

/** @deprecated Prefer planFilenamesForArtwork for the one-image-per-artwork workflow. */
export function planFilenamesForMasters(params: {
  year: string | number;
  inventoryId: number;
  title: string;
  masterFilenames: string[];
}): PlannedFilenames[] {
  return params.masterFilenames.map((masterFilename, index) => {
    const sequenceIndex = index + 1;
    const masterExt = normalizeMasterExtension(masterFilename) || ".bin";

    return {
      sequence: formatSequence(sequenceIndex),
      master: buildArtworkFilename({
        year: params.year,
        inventoryId: params.inventoryId,
        title: params.title,
        assetType: "master",
        sequence: sequenceIndex,
        extension: masterExt,
      }),
      hr: buildArtworkFilename({
        year: params.year,
        inventoryId: params.inventoryId,
        title: params.title,
        assetType: "hr",
        sequence: sequenceIndex,
        extension: ".jpg",
      }),
      web: buildArtworkFilename({
        year: params.year,
        inventoryId: params.inventoryId,
        title: params.title,
        assetType: "web",
        sequence: sequenceIndex,
        extension: ".jpg",
      }),
      thumb: buildArtworkFilename({
        year: params.year,
        inventoryId: params.inventoryId,
        title: params.title,
        assetType: "thumb",
        sequence: sequenceIndex,
        extension: ".jpg",
      }),
      metadata: buildArtworkMetadataFilename(params.inventoryId),
    };
  });
}
