/**
 * Presentation helpers for the image-processing result UI.
 *
 * These functions only format values already present in a processing result.
 * They never recompute sizes, ratios, or filenames.
 */

import { formatFileSize } from "@/lib/artwork/validation";
import type {
  ArtworkProcessingSuccess,
  ClientProcessedDerivative,
} from "@/lib/images/client-types";
import type { ArtworkSourceMetadata } from "@/lib/images/types";

export type LabelledValue = {
  label: string;
  value: string;
};

/**
 * Single size statement shared by HR and web outputs, so the same comparison
 * is never phrased twice in one place.
 */
export function formatSizeComparison(
  ratio: number | null | undefined,
): string | null {
  if (ratio == null || !Number.isFinite(ratio)) return null;

  const percent = Math.round(Math.abs(1 - ratio) * 1000) / 10;
  if (percent === 0) return "Same size as source";

  return ratio < 1
    ? `${percent}% smaller than source`
    : `${percent}% larger than source`;
}

export function formatProcessingDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "—";
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
  return `${(durationMs / 1000).toFixed(1)} seconds`;
}

export function formatPixelDimensions(width: number, height: number): string {
  return `${width} × ${height}`;
}

/** Prominent scan line: output sizes plus how long the run took. */
export function buildProcessingSummaryItems(
  result: ArtworkProcessingSuccess,
): LabelledValue[] {
  return [
    { label: "Master", value: formatFileSize(result.master.byteLength) },
    { label: "HR", value: formatFileSize(result.hr.byteLength) },
    { label: "Web", value: formatFileSize(result.web.byteLength) },
    { label: "Thumb", value: formatFileSize(result.thumb.byteLength) },
    { label: "Processed in", value: formatProcessingDuration(result.durationMs) },
  ];
}

/** Primary output facts: size and dimensions. */
export function formatOutputSizeLine(
  derivative: ClientProcessedDerivative,
): string {
  return `${formatFileSize(derivative.byteLength)} · ${formatPixelDimensions(derivative.width, derivative.height)}`;
}

/** Secondary output facts: encoder quality and resize status. */
export function formatOutputEncodingLine(
  derivative: ClientProcessedDerivative,
): string {
  const resize = derivative.wasResized
    ? `Resized to ${Math.max(derivative.width, derivative.height)} px long edge`
    : "Original dimensions";

  return `Quality ${derivative.quality} · ${resize}`;
}

export function buildSourceTechnicalItems(
  source: ArtworkSourceMetadata,
): LabelledValue[] {
  const items: LabelledValue[] = [
    { label: "Detected format", value: source.detectedFormat.toUpperCase() },
    {
      label: "Dimensions",
      value: formatPixelDimensions(source.width, source.height),
    },
    { label: "Color space", value: source.colourspace ?? "—" },
    { label: "DPI", value: source.density != null ? String(source.density) : "—" },
    { label: "ICC profile", value: source.hasIccProfile ? "Present" : "Absent" },
    { label: "Alpha", value: source.hasAlpha ? "Yes" : "No" },
  ];

  if (source.orientation != null) {
    items.push({ label: "Orientation", value: String(source.orientation) });
  }

  if (source.channels != null) {
    items.push({ label: "Channels", value: String(source.channels) });
  }

  if (source.isMultiPage) {
    items.push({
      label: "Pages",
      value: `${source.pageCount ?? "?"} (page 1 used)`,
    });
  }

  return items;
}

/** Clipboard payload for a filename control: the filename and nothing else. */
export function rawFilenameForCopy(filename: string): string {
  return filename.trim();
}
