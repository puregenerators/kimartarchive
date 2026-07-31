import type { LabelledValue } from "@/lib/images/result-presentation";

export function ProcessingSummary({ items }: { items: LabelledValue[] }) {
  return (
    <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-4 border-y border-[var(--line)] py-4">
      {items.map((item) => (
        <div key={item.label} className="min-w-[6.5rem]">
          <dt className="text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
            {item.label}
          </dt>
          <dd className="mt-0.5 font-display text-xl leading-tight text-[var(--ink)] sm:text-2xl">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
