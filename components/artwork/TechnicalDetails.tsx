import type { LabelledValue } from "@/lib/images/result-presentation";

type TechnicalDetailsProps = {
  items: LabelledValue[];
  summaryLabel?: string;
};

export function TechnicalDetails({
  items,
  summaryLabel = "Technical details",
}: TechnicalDetailsProps) {
  return (
    <details className="mt-5 border border-[var(--line)] bg-[var(--surface)]">
      <summary className="cursor-pointer select-none px-3 py-2 text-[11px] uppercase tracking-[0.14em] text-[var(--muted)] transition marker:text-[var(--muted)] hover:text-[var(--ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]">
        {summaryLabel}
      </summary>
      <dl className="grid gap-3 border-t border-[var(--line)] px-3 py-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <div key={item.label} className="min-w-0">
            <dt className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
              {item.label}
            </dt>
            <dd className="mt-0.5 break-words text-sm text-[var(--ink)]">
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
