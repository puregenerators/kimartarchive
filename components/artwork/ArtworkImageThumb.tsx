"use client";

import type { ArtworkImage } from "@/lib/artwork/types";
import type { TiffPreviewState } from "@/lib/images/preview-client";
import {
  buildSourceFileFingerprint,
  isTiffPreviewFresh,
  resolveTiffPreviewUrl,
} from "@/lib/images/preview-client";

type ArtworkImageThumbProps = {
  image: ArtworkImage | null;
  tiffPreview?: TiffPreviewState;
  /** Compact card vs review column sizing handled by parent. */
  className?: string;
  emptyLabel?: string;
};

/**
 * Shared thumbnail for artwork cards and batch review.
 * JPEG/PNG use browser object URLs; TIFF uses temporary server previews.
 */
export function ArtworkImageThumb({
  image,
  tiffPreview,
  className = "h-full w-full object-cover",
  emptyLabel = "Add image",
}: ArtworkImageThumbProps) {
  if (!image) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-2 text-center">
        <span className="text-xs text-[var(--ink)]">{emptyLabel}</span>
      </div>
    );
  }

  const fingerprint = buildSourceFileFingerprint({
    imageName: image.file.name,
    imageSize: image.file.size,
    imageLastModified: image.file.lastModified,
  });

  const browserPreview = image.previewUrl;
  const tiffUrl = image.isTiff
    ? resolveTiffPreviewUrl(tiffPreview, fingerprint)
    : null;
  const displayUrl = browserPreview ?? tiffUrl;

  const previewFresh = image.isTiff
    ? isTiffPreviewFresh(tiffPreview, fingerprint)
    : true;
  const status = previewFresh ? tiffPreview?.status : undefined;
  const isLoading =
    image.isTiff && (status === "queued" || status === "loading");
  const isError = image.isTiff && status === "error";
  const isMultiPage =
    image.isTiff &&
    status === "ready" &&
    tiffPreview?.status === "ready" &&
    tiffPreview.isMultiPage;

  if (displayUrl) {
    return (
      <div className="relative h-full w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={displayUrl}
          alt={`Preview of ${image.file.name}`}
          className={className}
        />
        {image.isTiff ? (
          <span className="absolute left-1 top-1 bg-[var(--ink)]/75 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em] text-[var(--paper)]">
            TIFF
          </span>
        ) : null}
        {isMultiPage ? (
          <span className="absolute bottom-1 left-1 right-1 bg-[var(--ink)]/70 px-1.5 py-0.5 text-[9px] leading-tight text-[var(--paper)]">
            Multi-page TIFF · previewing page 1
          </span>
        ) : null}
      </div>
    );
  }

  if (image.isTiff && isLoading) {
    return (
      <div className="relative flex h-full flex-col items-center justify-center gap-1 px-2 text-center">
        <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
          TIFF
        </span>
        <span className="text-[10px] text-[var(--muted)]" aria-live="polite">
          Generating preview…
        </span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 px-2 text-center">
      <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
        TIFF
      </span>
      {isError ? (
        <span className="text-[9px] leading-snug text-[var(--muted)]">
          Preview unavailable. The original TIFF can still be processed.
        </span>
      ) : (
        <span className="text-[10px] text-[var(--muted)]">Preview unavailable</span>
      )}
    </div>
  );
}

export function ArtworkImageThumbFooterNote({
  image,
  tiffPreview,
}: {
  image: ArtworkImage | null;
  tiffPreview?: TiffPreviewState;
}) {
  if (!image?.isTiff) return null;

  const fingerprint = buildSourceFileFingerprint({
    imageName: image.file.name,
    imageSize: image.file.size,
    imageLastModified: image.file.lastModified,
  });
  if (!isTiffPreviewFresh(tiffPreview, fingerprint)) return null;

  if (tiffPreview?.status === "error") {
    // Error copy is already shown inside the thumbnail placeholder.
    return null;
  }

  if (tiffPreview?.status === "ready" && tiffPreview.isMultiPage) {
    return (
      <p className="text-[10px] text-[var(--muted)]">
        Multi-page TIFF · previewing page 1
      </p>
    );
  }

  return null;
}
