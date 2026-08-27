"use client";

import { FilenameDisplay } from "@/components/artwork/FilenameDisplay";
import { OutputSummary } from "@/components/artwork/OutputSummary";
import { ProcessingSummary } from "@/components/artwork/ProcessingSummary";
import { TechnicalDetails } from "@/components/artwork/TechnicalDetails";
import { formatFileSize } from "@/lib/artwork/validation";
import type { ArtworkProcessingSuccess } from "@/lib/images/client-types";
import {
  buildProcessingSummaryItems,
  buildSourceTechnicalItems,
  formatSizeComparison,
} from "@/lib/images/result-presentation";

type ProcessingResultPanelProps = {
  result: ArtworkProcessingSuccess;
  sourcePreviewUrl: string | null;
  isTiff: boolean;
};

function PreviewFrame({
  label,
  src,
  placeholder,
}: {
  label: string;
  src: string | null;
  placeholder?: string;
}) {
  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
        {label}
      </figcaption>
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-[var(--surface-muted)]">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={`${label} preview`}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <span className="px-3 text-center text-xs text-[var(--muted)]">
            {placeholder ?? "Preview unavailable"}
          </span>
        )}
      </div>
    </figure>
  );
}

export function ProcessingResultPanel({
  result,
  sourcePreviewUrl,
  isTiff,
}: ProcessingResultPanelProps) {
  const { source, hr, web, thumb, comparisons } = result;

  return (
    <div className="mt-5 border border-[var(--line)] bg-[var(--surface-elevated)] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h4 className="font-display text-lg text-[var(--ink)]">
          Image processing result
        </h4>
        <p className="text-[11px] text-[var(--muted)]">
          Dev preview · processed in {result.durationMs} ms
        </p>
      </div>

      <p className="mt-1 text-xs text-[var(--muted)]">
        Source file{" "}
        <span className="break-all font-mono text-[var(--ink-soft)]">
          {source.originalFilename}
        </span>{" "}
        · {formatFileSize(source.originalByteLength)}
      </p>

      {result.warnings.length > 0 ? (
        <section
          role="status"
          aria-label="Processing warnings"
          className="mt-3 border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-2"
        >
          <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
            {result.warnings.length === 1 ? "Warning" : "Warnings"}
          </p>
          <ul className="mt-1 space-y-1 text-sm text-[var(--ink)]">
            {result.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <ProcessingSummary items={buildProcessingSummaryItems(result)} />

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <PreviewFrame
          label="Source"
          src={sourcePreviewUrl}
          placeholder={
            isTiff
              ? "TIFF preview unavailable — original can still be processed"
              : "No preview"
          }
        />
        <PreviewFrame label="HR JPG" src={hr.previewUrl} />
        <PreviewFrame label="Web JPG" src={web.previewUrl} />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        <OutputSummary
          title="High-resolution JPG"
          filenameLabel="high-resolution JPG"
          derivative={hr}
          comparison={formatSizeComparison(comparisons.hrSizeRatio)}
          downloadLabel="Download HR JPG"
        />
        <OutputSummary
          title="Web JPG"
          filenameLabel="web JPG"
          derivative={web}
          comparison={formatSizeComparison(comparisons.webSizeRatio)}
          downloadLabel="Download web JPG"
        />
        <OutputSummary
          title="Thumbnail JPG"
          filenameLabel="thumbnail JPG"
          derivative={thumb}
          comparison={null}
          downloadLabel="Download thumbnail JPG"
        />
      </div>

      <TechnicalDetails items={buildSourceTechnicalItems(source)} />

      <div className="mt-5 max-w-md">
        <p className="text-xs text-[var(--muted)]">
          Planned master · original bytes preserved
        </p>
        <div className="mt-2">
          <FilenameDisplay
            filename={result.master.filename}
            label="planned master"
          />
        </div>
      </div>
    </div>
  );
}
