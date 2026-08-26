/**
 * Provisional image-processing settings for artwork derivatives.
 * Refine after visual testing with Kim’s actual master files.
 */

export const IMAGE_PROCESSING_CONFIG = {
  /** Maximum accepted source file size (product limit). */
  maxSourceBytes: 250 * 1024 * 1024,

  /**
   * Maximum decoded pixel count (width × height after orientation).
   * ~200 MP covers high-end artwork photography without rejecting
   * typical professional TIFFs; still limits decompression bombs.
   */
  maxDecodedPixels: 200_000_000,

  /** Reject a single edge larger than this (pixels). */
  maxDimension: 30_000,

  /** Temporary processing result TTL. */
  tempTtlMs: 45 * 60 * 1000,

  /** Soft timeout for a single artwork processing run. */
  processingTimeoutMs: 5 * 60 * 1000,

  hr: {
    quality: 95,
    progressive: true,
    /** Never enlarge; preserve original oriented dimensions. */
    neverEnlarge: true as const,
    flattenBackground: { r: 255, g: 255, b: 255 },
    colourspace: "srgb" as const,
    /** No sharpening for full-size HR outputs. */
    sharpen: false as const,
  },

  web: {
    quality: 86,
    progressive: true,
    maxLongEdge: 2400,
    neverEnlarge: true as const,
    flattenBackground: { r: 255, g: 255, b: 255 },
    colourspace: "srgb" as const,
    /** Lanczos3 is Sharp’s default high-quality kernel for downscales. */
    kernel: "lanczos3" as const,
    /**
     * Mild output sharpening applied only when the web image was resized.
     * Tuned to avoid visibly oversharpened edges.
     */
    sharpenWhenResized: {
      sigma: 0.5,
      m1: 0.5,
      m2: 0.4,
    },
  },

  /**
   * Archival convenience thumbnail stored in the artwork Dropbox folder
   * and rendered in the Artwork Inventory Thumbnail cell.
   * Not a canonical metadata field. Never crop; never enlarge.
   */
  thumb: {
    quality: 84,
    progressive: true,
    maxLongEdge: 500,
    neverEnlarge: true as const,
    flattenBackground: { r: 255, g: 255, b: 255 },
    colourspace: "srgb" as const,
    kernel: "lanczos3" as const,
    /**
     * Same mild output sharpening as the web derivative, only when resized.
     */
    sharpenWhenResized: {
      sigma: 0.5,
      m1: 0.5,
      m2: 0.4,
    },
  },

  /**
   * Temporary UI-only JPEG thumbnails (e.g. browser TIFF previews).
   * Not archival. Never upload these to Dropbox or write them to Sheets.
   * Kept separate from HR / web / archival-thumb derivative settings above.
   */
  preview: {
    maxWidth: 600,
    maxHeight: 600,
    quality: 78,
    progressive: true,
    neverEnlarge: true as const,
    flattenBackground: { r: 255, g: 255, b: 255 },
    colourspace: "srgb" as const,
    /** Client-side queue limit for concurrent Sharp preview jobs. */
    concurrency: 2,
  },
} as const;

export type ImageProcessingConfig = typeof IMAGE_PROCESSING_CONFIG;
