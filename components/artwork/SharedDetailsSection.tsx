"use client";

import type { ReactNode } from "react";
import {
  DIMENSION_UNITS,
  STATUS_VALUES,
  type BatchSharedDetails,
} from "@/lib/artwork/types";

type SharedDetailsSectionProps = {
  shared: BatchSharedDetails;
  onChange: <K extends keyof BatchSharedDetails>(
    field: K,
    value: BatchSharedDetails[K],
  ) => void;
  onRequestApply: () => void;
};

const inputClass =
  "w-full border border-[var(--line)] bg-[var(--surface-elevated)] px-3 py-2 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent-soft-strong)]";

function Field({
  id,
  label,
  children,
  hint,
}: {
  id: string;
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]"
      >
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-[var(--muted)]">{hint}</p> : null}
    </div>
  );
}

export function SharedDetailsSection({
  shared,
  onChange,
  onRequestApply,
}: SharedDetailsSectionProps) {
  return (
    <section
      className="border border-[var(--line)] bg-[var(--surface)] p-5 sm:p-6"
      aria-labelledby="shared-heading"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2
            id="shared-heading"
            className="font-display text-2xl text-[var(--ink)]"
          >
            Shared details
          </h2>
          <p className="mt-1 max-w-xl text-sm text-[var(--muted)]">
            Enter once for the exhibition or documentation session. Newly
            uploaded artworks inherit these defaults when created. Existing
            artwork edits are not changed until you apply shared details.
          </p>
        </div>
        <button
          type="button"
          onClick={onRequestApply}
          className="shrink-0 self-start border border-[var(--line)] bg-[var(--surface-elevated)] px-4 py-2 text-xs uppercase tracking-[0.12em] text-[var(--ink)] transition hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          Apply shared details to all
        </button>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field id="exhibition" label="Exhibition">
          <input
            id="exhibition"
            value={shared.exhibition}
            onChange={(e) => onChange("exhibition", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field id="gallery" label="Gallery / Venue">
          <input
            id="gallery"
            value={shared.gallery}
            onChange={(e) => onChange("gallery", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field id="exhibitionYear" label="Exhibition Year">
          <input
            id="exhibitionYear"
            inputMode="numeric"
            placeholder="2026"
            value={shared.exhibitionYear}
            onChange={(e) => onChange("exhibitionYear", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field id="defaultArtworkYear" label="Default Artwork Year">
          <input
            id="defaultArtworkYear"
            inputMode="numeric"
            placeholder="2026"
            value={shared.defaultArtworkYear}
            onChange={(e) => onChange("defaultArtworkYear", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field id="photographer" label="Photographer">
          <input
            id="photographer"
            value={shared.photographer}
            onChange={(e) => onChange("photographer", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field id="defaultLocation" label="Default Location">
          <input
            id="defaultLocation"
            value={shared.defaultLocation}
            onChange={(e) => onChange("defaultLocation", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field id="defaultMedium" label="Default Medium">
          <input
            id="defaultMedium"
            value={shared.defaultMedium}
            onChange={(e) => onChange("defaultMedium", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field id="defaultStatus" label="Default Status" hint="Optional">
          <select
            id="defaultStatus"
            value={shared.defaultStatus}
            onChange={(e) =>
              onChange(
                "defaultStatus",
                e.target.value as BatchSharedDetails["defaultStatus"],
              )
            }
            className={inputClass}
          >
            <option value="">Select status</option>
            {STATUS_VALUES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </Field>
        <Field id="defaultDimensionUnit" label="Default Dimension Unit">
          <select
            id="defaultDimensionUnit"
            value={shared.defaultDimensionUnit}
            onChange={(e) =>
              onChange(
                "defaultDimensionUnit",
                e.target.value as BatchSharedDetails["defaultDimensionUnit"],
              )
            }
            className={inputClass}
          >
            {DIMENSION_UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </section>
  );
}
