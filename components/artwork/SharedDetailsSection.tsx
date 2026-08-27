"use client";

import type { ReactNode } from "react";
import { MediumField } from "@/components/artwork/MediumField";
import {
  DIMENSION_UNITS,
  type BatchSharedDetails,
} from "@/lib/artwork/types";

type SharedDetailsSectionProps = {
  shared: BatchSharedDetails;
  onChange: <K extends keyof BatchSharedDetails>(
    field: K,
    value: BatchSharedDetails[K],
  ) => void;
  onRequestApply: () => void;
  /** Hide Apply until at least one artwork exists. */
  canApply?: boolean;
};

const inputClass =
  "w-full border border-[var(--line)] bg-[var(--surface-elevated)] px-3 py-2 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent-soft-strong)]";

function Field({
  id,
  label,
  children,
  hint,
  error,
  required,
}: {
  id: string;
  label: string;
  children: ReactNode;
  hint?: string;
  error?: string;
  required?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]"
      >
        {label}
        {required ? <span className="text-[var(--danger)]"> *</span> : null}
      </label>
      {children}
      {hint ? <p className="text-xs text-[var(--muted)]">{hint}</p> : null}
      {error ? (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function SharedDetailsSection({
  shared,
  onChange,
  onRequestApply,
  canApply = true,
}: SharedDetailsSectionProps) {
  return (
    <section
      className="border border-[var(--line)] bg-[var(--surface)] p-5 sm:p-6"
      aria-labelledby="batch-details-heading"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2
            id="batch-details-heading"
            className="font-display text-2xl text-[var(--ink)]"
          >
            Shared details for this batch
          </h2>
          <p className="mt-1 max-w-xl text-sm text-[var(--muted)]">
            Add any information that applies to every artwork below. You can
            still change these details for individual artworks.
          </p>
        </div>
        {canApply ? (
          <button
            type="button"
            onClick={onRequestApply}
            className="shrink-0 self-start border border-[var(--line)] bg-[var(--surface-elevated)] px-4 py-2 text-xs uppercase tracking-[0.12em] text-[var(--ink)] transition hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            Apply to all artworks
          </button>
        ) : null}
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field id="exhibition" label="Exhibition">
          <input
            id="exhibition"
            name="exhibition"
            autoComplete="off"
            value={shared.exhibition}
            onChange={(e) => onChange("exhibition", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field id="gallery" label="Gallery / Venue">
          <input
            id="gallery"
            name="gallery"
            autoComplete="off"
            value={shared.gallery}
            onChange={(e) => onChange("gallery", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field id="exhibitionYear" label="Exhibition Year">
          <input
            id="exhibitionYear"
            name="exhibitionYear"
            autoComplete="off"
            inputMode="numeric"
            placeholder="2026"
            value={shared.exhibitionYear}
            onChange={(e) => onChange("exhibitionYear", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field id="defaultArtworkYear" label="Artwork Year">
          <input
            id="defaultArtworkYear"
            name="defaultArtworkYear"
            autoComplete="off"
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
            name="photographer"
            autoComplete="off"
            value={shared.photographer}
            onChange={(e) => onChange("photographer", e.target.value)}
            className={inputClass}
          />
        </Field>
        <div className="sm:col-span-1">
          <MediumField
            id="defaultMedium"
            value={shared.defaultMedium}
            onChange={(medium) => onChange("defaultMedium", medium)}
            allowBlank
            label="Medium"
            customLabel="Specify medium"
            customHint="Examples: Watercolor, Drawing, Mixed media, Sculpture, Collage"
            inputClassName={inputClass}
            FieldWrapper={Field}
          />
        </div>
        <Field id="defaultDimensionUnit" label="Dimension Unit">
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
