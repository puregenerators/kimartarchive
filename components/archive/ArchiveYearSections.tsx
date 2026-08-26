import type { ReactNode } from "react";

import { ArchiveArtworkCard } from "@/components/archive/ArchiveArtworkCard";
import {
  formatYearArtworkCount,
  yearSectionId,
} from "@/lib/archive/presentation";
import type { ArchiveArtwork, ArchiveYearGroup } from "@/lib/archive/types";

export function ArchiveYearSections({
  groups,
  deleteControlFor,
}: {
  groups: readonly ArchiveYearGroup[];
  deleteControlFor?: (artwork: ArchiveArtwork) => ReactNode;
}) {
  return (
    <div className="flex flex-col gap-24 md:gap-28">
      {groups
        .filter((group) => group.artworks.length > 0)
        .map((group) => (
          <section
            key={group.year}
            id={yearSectionId(group.year)}
            className="flex scroll-mt-8 flex-col gap-8 md:scroll-mt-10"
          >
            <div className="flex flex-col gap-1">
              <h2 className="font-display text-2xl tracking-tight text-[var(--ink-soft)] md:text-3xl">
                {group.year}
              </h2>
              <p className="text-xs tracking-wide text-[var(--muted)] md:hidden">
                {formatYearArtworkCount(group.artworks.length)}
              </p>
            </div>
            <div className="grid grid-cols-1 items-start gap-x-8 gap-y-14 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {group.artworks.map((artwork) => (
                <ArchiveArtworkCard
                  key={artwork.inventoryId}
                  artwork={artwork}
                  deleteControl={deleteControlFor?.(artwork)}
                />
              ))}
            </div>
          </section>
        ))}
    </div>
  );
}
