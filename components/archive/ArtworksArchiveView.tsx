"use client";

import { useMemo, useState, type ReactNode } from "react";

import { ArchiveYearNav } from "@/components/archive/ArchiveYearNav";
import { ArchiveYearSections } from "@/components/archive/ArchiveYearSections";
import { uniqueYearsDescending } from "@/lib/archive/presentation";
import {
  filterArchiveArtworks,
  groupArtworksByYear,
  searchArchiveArtworks,
} from "@/lib/archive/records";
import type { ArchiveArtwork, ArchiveWarning } from "@/lib/archive/types";

type ArtworksArchiveViewProps = {
  artworks: ArchiveArtwork[];
  warnings: ArchiveWarning[];
  deleteControlFor?: (
    artwork: ArchiveArtwork,
    onDeleted: (inventoryId: number, message: string) => void,
  ) => ReactNode;
};

const searchInputClass =
  "min-h-11 w-full border-0 border-b border-[var(--line)] bg-transparent px-0 py-3 text-base text-[var(--ink)] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus-visible:border-[var(--accent)] md:min-h-0 md:py-2 md:text-sm";

const filterSelectClass =
  "min-h-11 max-w-full border-0 border-b border-[var(--line)] bg-transparent py-2 pr-6 text-base text-[var(--ink)] outline-none transition focus:border-[var(--accent)] focus-visible:border-[var(--accent)] md:min-h-0 md:py-2 md:text-sm";

const filterLabelClass =
  "sr-only md:not-sr-only md:text-[10px] md:uppercase md:tracking-[0.14em] md:text-[var(--muted)]";

export function ArtworksArchiveView({
  artworks,
  warnings,
  deleteControlFor,
}: ArtworksArchiveViewProps) {
  const [query, setQuery] = useState("");
  const [year, setYear] = useState("");
  const [medium, setMedium] = useState("");
  const [removedIds, setRemovedIds] = useState<number[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  const visibleArtworks = useMemo(
    () =>
      artworks.filter((artwork) => !removedIds.includes(artwork.inventoryId)),
    [artworks, removedIds],
  );

  const years = useMemo(
    () => uniqueYearsDescending(visibleArtworks),
    [visibleArtworks],
  );

  const media = useMemo(() => {
    return [
      ...new Set(
        visibleArtworks
          .map((artwork) => artwork.medium)
          .filter((value) => value),
      ),
    ].sort((a, b) => a.localeCompare(b));
  }, [visibleArtworks]);

  const visibleGroups = useMemo(() => {
    const filtered = filterArchiveArtworks(
      searchArchiveArtworks(visibleArtworks, query),
      { year, medium },
    );
    return groupArtworksByYear(filtered);
  }, [visibleArtworks, query, year, medium]);

  const visibleCount = visibleGroups.reduce(
    (sum, group) => sum + group.artworks.length,
    0,
  );
  const hasQuery = Boolean(query.trim() || year || medium);

  return (
    <div className="flex min-w-0 flex-col gap-10">
      <div className="flex min-w-0 flex-col gap-5 md:flex-row md:flex-wrap md:items-end md:gap-8">
        <label
          className="flex min-w-0 w-full flex-col gap-1 md:min-w-[14rem] md:flex-1"
          htmlFor="archive-search"
        >
          <span className={filterLabelClass}>Search</span>
          <input
            id="archive-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by title, inventory number, exhibition..."
            autoComplete="off"
            className={searchInputClass}
          />
        </label>
        {years.length > 1 || media.length > 1 ? (
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3 md:contents">
            {years.length > 1 ? (
              <label className="flex min-w-[7.5rem] max-w-full flex-col gap-1">
                <span className={filterLabelClass}>Year</span>
                <select
                  value={year}
                  onChange={(event) => setYear(event.target.value)}
                  className={filterSelectClass}
                >
                  <option value="">All years</option>
                  {years.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {media.length > 1 ? (
              <label className="flex min-w-[8rem] max-w-full flex-col gap-1">
                <span className={filterLabelClass}>Medium</span>
                <select
                  value={medium}
                  onChange={(event) => setMedium(event.target.value)}
                  className={filterSelectClass}
                >
                  <option value="">All media</option>
                  {media.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        ) : null}
      </div>

      {years.length > 0 ? <ArchiveYearNav years={years} /> : null}

      {status ? (
        <p role="status" className="text-sm text-[var(--ink-soft)]">
          {status}
        </p>
      ) : null}

      {warnings.length > 0 ? (
        <p className="text-xs text-[var(--muted)]">
          {warnings.length === 1
            ? warnings[0]!.message
            : `${warnings.length} inventory rows could not be shown.`}
        </p>
      ) : null}

      {hasQuery && visibleCount > 0 ? (
        <p className="text-xs tracking-wide text-[var(--muted)]">
          {visibleCount === 1
            ? "1 artwork"
            : `${visibleCount} artworks`}
        </p>
      ) : null}

      {visibleCount === 0 ? (
        <p className="text-[var(--muted)]">
          {hasQuery
            ? "No artworks match your search."
            : "No artworks have been archived yet."}
        </p>
      ) : (
        <ArchiveYearSections
          groups={visibleGroups}
          deleteControlFor={
            deleteControlFor
              ? (artwork) =>
                  deleteControlFor(artwork, (inventoryId, message) => {
                    setRemovedIds((current) =>
                      current.includes(inventoryId)
                        ? current
                        : [...current, inventoryId],
                    );
                    setStatus(message);
                  })
              : undefined
          }
        />
      )}
    </div>
  );
}
