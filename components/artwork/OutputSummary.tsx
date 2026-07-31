import { FilenameDisplay } from "@/components/artwork/FilenameDisplay";
import {
  formatOutputEncodingLine,
  formatOutputSizeLine,
} from "@/lib/images/result-presentation";
import type { ClientProcessedDerivative } from "@/lib/images/client-types";

type OutputSummaryProps = {
  title: string;
  /** Context for the copy button's accessible name, e.g. "high-resolution JPG". */
  filenameLabel: string;
  derivative: ClientProcessedDerivative;
  /** Single size statement vs the source, when available. */
  comparison: string | null;
  downloadLabel: string;
};

export function OutputSummary({
  title,
  filenameLabel,
  derivative,
  comparison,
  downloadLabel,
}: OutputSummaryProps) {
  return (
    <section aria-label={title} className="min-w-0">
      <h5 className="font-display text-base text-[var(--ink)]">{title}</h5>
      <div className="mt-2">
        <FilenameDisplay filename={derivative.filename} label={filenameLabel} />
      </div>
      <p className="mt-2 text-sm text-[var(--ink)]">
        {formatOutputSizeLine(derivative)}
      </p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        {formatOutputEncodingLine(derivative)}
      </p>
      {comparison ? (
        <p className="mt-1 text-xs text-[var(--muted)]">{comparison}</p>
      ) : null}
      <a
        href={derivative.downloadUrl}
        download={derivative.filename}
        className="mt-3 inline-block text-sm text-[var(--accent)] underline underline-offset-2 hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
      >
        {downloadLabel}
      </a>
    </section>
  );
}
