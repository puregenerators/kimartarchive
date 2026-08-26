import type { ReactNode } from "react";
import Link from "next/link";

import { ArchiveDeleteControlView } from "@/components/archive/ArchiveDeleteControlView";
import { ArchivePreviewImage } from "@/components/archive/ArchivePreviewImage";
import {
  artworkPreviewAlt,
  formatInventoryId,
} from "@/lib/archive/presentation";
import type { ArchiveArtwork } from "@/lib/archive/types";

export function ArchiveArtworkCard({
  artwork,
  deleteControl,
}: {
  artwork: ArchiveArtwork;
  deleteControl?: ReactNode;
}) {
  const inventoryId = formatInventoryId(artwork.inventoryId);

  return (
    <article className="group relative flex min-w-0 flex-col">
      <div className="absolute right-0 top-0 z-10">
        {deleteControl ?? (
          <ArchiveDeleteControlView
            title={artwork.title}
            variant="card"
          />
        )}
      </div>
      <Link
        href={`/artworks/${artwork.inventoryId}`}
        aria-label={`${artwork.title}, ${inventoryId}`}
        className="flex min-w-0 flex-col gap-3 outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-4 focus-visible:ring-offset-[var(--paper)]"
      >
        <div className="origin-bottom md:transition md:duration-300 md:ease-out md:group-hover:-translate-y-0.5 md:group-hover:opacity-90 md:group-focus-within:-translate-y-0.5 md:group-focus-within:opacity-90">
          <ArchivePreviewImage
            displayUrl={artwork.webFileDisplayUrl}
            alt={artworkPreviewAlt(artwork)}
            sizes="grid"
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="break-words font-display text-xl leading-snug tracking-tight text-[var(--ink)]">
            {artwork.title}
          </h3>
          <p className="font-mono text-xs tracking-wide text-[var(--ink-soft)]">
            {inventoryId}
          </p>
          {artwork.medium ? (
            <p className="text-xs text-[var(--muted)]">{artwork.medium}</p>
          ) : null}
          <p className="mt-1 hidden text-xs text-[var(--muted)] opacity-0 transition-opacity duration-300 md:block md:group-hover:opacity-100 md:group-focus-within:opacity-100">
            View artwork →
          </p>
        </div>
      </Link>
    </article>
  );
}
