"use client";

import { formatFileSize } from "@/lib/artwork/validation";

type BatchSummaryBarProps = {
  artworkCount: number;
  maxArtworks: number;
  totalBytes: number;
  needingMetadata: number;
  validationErrors: number;
  testedSuccessfully: number;
  notYetTested: number;
  canAddMore: boolean;
  onAddMore: () => void;
  onRequestClear: () => void;
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-[6rem]">
      <dt className="text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-[var(--ink)]">{value}</dd>
    </div>
  );
}

export function BatchSummaryBar({
  artworkCount,
  maxArtworks,
  totalBytes,
  needingMetadata,
  validationErrors,
  testedSuccessfully,
  notYetTested,
  canAddMore,
  onAddMore,
  onRequestClear,
}: BatchSummaryBarProps) {
  return (
    <section
      className="border border-[var(--line)] bg-[var(--surface)] p-4 sm:p-5"
      aria-label="Batch summary"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-xl text-[var(--ink)]">
            Batch summary
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {artworkCount} of {maxArtworks} artworks ·{" "}
            {formatFileSize(totalBytes)} total source size
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onAddMore}
            disabled={!canAddMore}
            title={
              canAddMore
                ? undefined
                : `A batch can include at most ${maxArtworks} artworks.`
            }
            className="border border-[var(--line)] bg-[var(--surface-elevated)] px-3 py-2 text-xs uppercase tracking-[0.12em] text-[var(--ink)] transition hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {canAddMore ? "Add More Images" : "Batch Full"}
          </button>
          <button
            type="button"
            onClick={onRequestClear}
            className="px-3 py-2 text-xs uppercase tracking-[0.12em] text-[var(--muted)] transition hover:text-[var(--danger)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            Clear Batch…
          </button>
        </div>
      </div>

      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-3">
        <Stat label="Artworks" value={`${artworkCount} / ${maxArtworks}`} />
        <Stat label="Total size" value={formatFileSize(totalBytes)} />
        <Stat label="Need metadata" value={needingMetadata} />
        <Stat label="Validation errors" value={validationErrors} />
        <Stat label="Tested successfully" value={testedSuccessfully} />
        <Stat label="Not yet tested" value={notYetTested} />
      </dl>
    </section>
  );
}
