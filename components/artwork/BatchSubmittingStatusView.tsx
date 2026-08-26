import type { ReactNode } from "react";

export function submittingWaitLabel(artworkCount: number): string {
  return `Submitting ${artworkCount} artwork${artworkCount === 1 ? "" : "s"}. Please wait.`;
}

export function SubmittingStatusDots({
  artworkCount,
}: {
  artworkCount: number;
}) {
  return (
    <div
      className="submit-loading-dots"
      aria-label={submittingWaitLabel(artworkCount)}
    >
      <span className="submit-loading-dot" aria-hidden="true" />
      <span className="submit-loading-dot" aria-hidden="true" />
      <span className="submit-loading-dot" aria-hidden="true" />
    </div>
  );
}

export function BatchSubmittingStatusView({
  artworkCount,
  elapsedSec,
  children,
}: {
  artworkCount: number;
  elapsedSec: number;
  children?: ReactNode;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-8 border border-[var(--accent)] bg-[var(--accent-soft)] px-4 py-5 text-sm text-[var(--ink)]"
    >
      <p className="font-medium">
        Submitting {artworkCount} artwork
        {artworkCount === 1 ? "" : "s"}
      </p>
      <p className="mt-2 text-[var(--muted)]">
        This may take several minutes. Large TIFFs take time. Do not close this page.
      </p>
      <SubmittingStatusDots artworkCount={artworkCount} />
      <p className="mt-3 text-xs text-[var(--muted)]">
        Elapsed {elapsedSec}s · exact per-artwork stage is not streamed live
      </p>
      {children}
    </div>
  );
}
