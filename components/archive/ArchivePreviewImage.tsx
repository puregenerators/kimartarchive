"use client";

import { useState } from "react";

type ArchivePreviewImageProps = {
  displayUrl: string | null;
  alt: string;
  className?: string;
  /** Larger detail preview vs grid thumbnail. */
  sizes?: "grid" | "detail";
};

function placeholderClass(sizes: "grid" | "detail"): string {
  if (sizes === "detail") {
    return "flex min-h-[40vh] w-full items-center justify-center bg-[var(--paper-deep)] text-center";
  }
  return "flex min-h-64 w-full items-center justify-center bg-[var(--paper-deep)] text-center";
}

function imageClass(sizes: "grid" | "detail"): string {
  if (sizes === "detail") {
    return "mx-auto block h-auto max-h-[min(85vh,52rem)] w-auto max-w-full object-contain";
  }
  return "block h-auto w-full object-contain";
}

export function ArchivePreviewImage({
  displayUrl,
  alt,
  className,
  sizes = "grid",
}: ArchivePreviewImageProps) {
  const [failed, setFailed] = useState(false);
  const showPlaceholder = !displayUrl || failed;

  if (showPlaceholder) {
    return (
      <div
        className={[placeholderClass(sizes), className ?? ""].join(" ").trim()}
      >
        <span className="px-3 text-xs tracking-wide text-[var(--muted)]">
          Image unavailable
        </span>
      </div>
    );
  }

  return (
    // Dropbox shared links are not a Next.js image host; native img is required.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={displayUrl}
      alt={alt}
      loading={sizes === "grid" ? "lazy" : "eager"}
      decoding="async"
      fetchPriority={sizes === "detail" ? "high" : "low"}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={[imageClass(sizes), className ?? ""].join(" ").trim()}
    />
  );
}
