const DIMENSION_UNITS = new Set(["in", "cm"]);

function sanitizeMeasurement(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (Number.isInteger(value)) return String(value);
  return String(value);
}

/**
 * Format archive dimensions as `Height × Width [× Depth] unit`.
 * Omits the line when the height/width pair is incomplete or malformed.
 */
export function formatArchiveDimensions(artwork: {
  height: string;
  width: string;
  depth: string;
  dimensionUnit: string;
}): string {
  const unit = artwork.dimensionUnit.trim().toLowerCase();
  if (!DIMENSION_UNITS.has(unit)) return "";

  const height = sanitizeMeasurement(artwork.height);
  const width = sanitizeMeasurement(artwork.width);
  if (!height || !width) return "";

  const depth = sanitizeMeasurement(artwork.depth);
  const parts = depth ? [height, width, depth] : [height, width];
  return `${parts.join(" × ")} ${unit}`;
}
