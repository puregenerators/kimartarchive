export type IntakeProgressItem = {
  title: string;
  stage: string;
  percent: number | null;
  error: string | null;
};

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
  items,
}: {
  artworkCount: number;
  elapsedSec: number;
  items?: IntakeProgressItem[];
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
        Files up to 150 MB will upload automatically. For larger files, we’ll
        prepare a Dropbox folder and show you where to upload them. Processing
        may take several minutes, so keep this page open until it’s complete.
      </p>
      <SubmittingStatusDots artworkCount={artworkCount} />
      <p className="mt-3 text-xs text-[var(--muted)]">
        Elapsed {elapsedSec}s
        {items && items.length > 0
          ? " · upload progress below"
          : " · exact per-artwork stage is not streamed live"}
      </p>
      {items && items.length > 0 ? (
        <ul className="mt-4 space-y-3">
          {items.map((item) => (
            <li key={item.title}>
              <p className="font-medium">{item.title}</p>
              <p className="text-xs text-[var(--muted)]">{item.stage}</p>
              {item.percent != null ? (
                <div className="mt-1">
                  <div
                    className="h-2 overflow-hidden bg-[var(--surface)]"
                    aria-hidden="true"
                  >
                    <div
                      className="h-2 bg-[var(--accent)]"
                      style={{ width: `${Math.round(item.percent * 100)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {Math.round(item.percent * 100)}% uploaded
                  </p>
                </div>
              ) : null}
              {item.error ? (
                <p className="mt-1 text-xs text-[var(--danger)]">{item.error}</p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

