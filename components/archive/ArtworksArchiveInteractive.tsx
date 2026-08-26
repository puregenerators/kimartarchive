"use client";

import { ArchiveDeleteControl } from "@/components/archive/ArchiveDeleteControl";
import { ArtworksArchiveView } from "@/components/archive/ArtworksArchiveView";
import type { ArchiveArtwork, ArchiveWarning } from "@/lib/archive/types";

export function ArtworksArchiveInteractive({
  artworks,
  warnings,
}: {
  artworks: ArchiveArtwork[];
  warnings: ArchiveWarning[];
}) {
  return (
    <ArtworksArchiveView
      artworks={artworks}
      warnings={warnings}
      deleteControlFor={(artwork, onDeleted) => (
        <ArchiveDeleteControl
          inventoryId={artwork.inventoryId}
          title={artwork.title}
          variant="card"
          onDeleted={onDeleted}
        />
      )}
    />
  );
}
