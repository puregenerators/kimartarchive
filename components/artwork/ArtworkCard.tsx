"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import {
  ArtworkImageThumb,
  ArtworkImageThumbFooterNote,
} from "@/components/artwork/ArtworkImageThumb";
import { MediumField } from "@/components/artwork/MediumField";
import { replaceArtworkImage } from "@/lib/artwork/batch-files";
import {
  DIMENSION_UNITS,
  MAX_FILE_SIZE_LABEL,
  formatArtworkNumber,
  previewInventoryIdForIndex,
  requiresLargeFileDropboxIntake,
  type ArtworkDraft,
  type ArtworkImage,
  type ArtworkOverrideFields,
  type ArtworkValidationErrors,
} from "@/lib/artwork/types";
import {
  UNTITLED_TITLE,
  resolveArtworkTitle,
  setArtworkUntitled,
} from "@/lib/artwork/untitled";
import {
  describeImageType,
  formatFileSize,
} from "@/lib/artwork/validation";
import type { TiffPreviewState } from "@/lib/images/preview-client";

type ArtworkCardProps = {
  artwork: ArtworkDraft;
  index: number;
  total: number;
  errors?: ArtworkValidationErrors;
  onChange: (next: ArtworkDraft) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  /** Called after a successful image replace so the parent can clear processing. */
  onImageReplaced?: (next: ArtworkDraft) => void;
  tiffPreview?: TiffPreviewState;
};

const inputClass =
  "w-full border border-[var(--line)] bg-[var(--surface-elevated)] px-2.5 py-1.5 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent-soft-strong)]";

function Field({
  id,
  label,
  error,
  children,
  required,
  hint,
}: {
  id: string;
  label: string;
  error?: string;
  children: ReactNode;
  required?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label
        htmlFor={id}
        className="text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]"
      >
        {label}
        {required ? <span className="text-[var(--danger)]"> *</span> : null}
      </label>
      {children}
      {hint ? <p className="text-[11px] text-[var(--muted)]">{hint}</p> : null}
      {error ? (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function revokeImage(image: ArtworkImage | null) {
  if (image?.previewUrl) {
    URL.revokeObjectURL(image.previewUrl);
  }
}

export function ArtworkCard({
  artwork,
  index,
  total,
  errors,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  onImageReplaced,
  tiffPreview,
}: ArtworkCardProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(
    Boolean(
      artwork.depth.trim() ||
        artwork.notes.trim() ||
        artwork.overrides.exhibition ||
        artwork.overrides.gallery ||
        artwork.overrides.photographer ||
        errors?.depth,
    ),
  );

  const previewId = previewInventoryIdForIndex(index);
  const numberLabel = formatArtworkNumber(index);
  const shownImageError = imageError || errors?.image;

  function patch<K extends keyof ArtworkDraft>(field: K, value: ArtworkDraft[K]) {
    onChange({ ...artwork, [field]: value });
  }

  function patchTitle(value: string) {
    onChange({
      ...artwork,
      title: value,
      titleSuggestedFromFilename: false,
      titleArtistAliasRemoved: false,
    });
  }

  function patchOverride<K extends keyof ArtworkOverrideFields>(
    field: K,
    value: ArtworkOverrideFields[K],
  ) {
    onChange({
      ...artwork,
      overrides: { ...artwork.overrides, [field]: value },
    });
  }

  function setImageFromFile(file: File) {
    const result = replaceArtworkImage(artwork, file);
    if (!result.ok) {
      setImageError(result.error);
      return;
    }
    setImageError(null);
    revokeImage(result.previousImage);
    onChange(result.artwork);
    onImageReplaced?.(result.artwork);
  }

  return (
    <article
      id={`artwork-card-${artwork.id}`}
      className="border border-[var(--line)] bg-[var(--surface)] p-3 sm:p-4 animate-fade-in"
      aria-labelledby={`artwork-heading-${artwork.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">
            Artwork {numberLabel} · Preview {previewId}
          </p>
          <h3
            id={`artwork-heading-${artwork.id}`}
            className="mt-0.5 truncate font-display text-lg text-[var(--ink)]"
          >
            {resolveArtworkTitle(artwork) || "No title yet"}
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={index === 0}
            className="px-2 py-1 text-[11px] uppercase tracking-[0.12em] text-[var(--muted)] transition hover:text-[var(--ink)] disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            Up
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={index === total - 1}
            className="px-2 py-1 text-[11px] uppercase tracking-[0.12em] text-[var(--muted)] transition hover:text-[var(--ink)] disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            Down
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="px-2 py-1 text-[11px] uppercase tracking-[0.12em] text-[var(--muted)] transition hover:text-[var(--danger)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            Remove
          </button>
        </div>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[7.5rem_minmax(0,1fr)]">
        <div>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            className="sr-only"
            accept=".tif,.tiff,.jpg,.jpeg,.png,image/tiff,image/jpeg,image/png"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) setImageFromFile(file);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="group relative flex h-28 w-full flex-col overflow-hidden border border-dashed border-[var(--line)] bg-[var(--surface-muted)] text-left transition hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            aria-describedby={shownImageError ? `${inputId}-error` : undefined}
          >
            <ArtworkImageThumb
              image={artwork.image}
              tiffPreview={tiffPreview}
            />
          </button>
          {artwork.image ? (
            <div className="mt-1.5 space-y-0.5">
              <p
                className="truncate text-[11px] text-[var(--ink)]"
                title={artwork.image.file.name}
              >
                {artwork.image.file.name}
              </p>
              <p className="text-[11px] text-[var(--muted)]">
                {describeImageType(artwork.image.file)} ·{" "}
                {formatFileSize(artwork.image.file.size)}
              </p>
              {requiresLargeFileDropboxIntake(artwork.image.file.size) ? (
                <p className="text-[11px] text-[var(--ink)]">
                  Over {MAX_FILE_SIZE_LABEL} — large master via Dropbox
                </p>
              ) : null}
              <ArtworkImageThumbFooterNote
                image={artwork.image}
                tiffPreview={tiffPreview}
              />
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)] hover:text-[var(--ink)]"
              >
                Replace
              </button>
            </div>
          ) : null}
          {shownImageError ? (
            <p
              id={`${inputId}-error`}
              role="alert"
              className="mt-1 text-xs text-[var(--danger)]"
            >
              {shownImageError}
            </p>
          ) : null}
        </div>

        <div className="grid gap-2 sm:grid-cols-6">
          <div className="sm:col-span-3">
            <Field
              id={`${artwork.id}-title`}
              label="Title"
              required={!artwork.isUntitled}
              error={errors?.title}
              hint={
                artwork.isUntitled
                  ? "This is the title that will be archived."
                  : artwork.titleSuggestedFromFilename
                    ? artwork.titleArtistAliasRemoved
                      ? "Removed artist name from filename."
                      : "Suggested from filename — edit freely"
                    : undefined
              }
            >
              {artwork.isUntitled ? (
                <p
                  id={`${artwork.id}-title`}
                  className={`${inputClass} text-[var(--ink)]`}
                >
                  {UNTITLED_TITLE}
                </p>
              ) : (
                <input
                  id={`${artwork.id}-title`}
                  value={artwork.title}
                  onChange={(e) => patchTitle(e.target.value)}
                  className={inputClass}
                />
              )}
            </Field>
            <label className="mt-2 flex items-start gap-2 text-sm text-[var(--ink)]">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={artwork.isUntitled}
                onChange={(event) =>
                  onChange(setArtworkUntitled(artwork, event.target.checked))
                }
              />
              <span>Missing / no known title</span>
            </label>
          </div>
          <div className="sm:col-span-1">
            <Field
              id={`${artwork.id}-year`}
              label="Year"
              required
              error={errors?.year}
            >
              <input
                id={`${artwork.id}-year`}
                inputMode="numeric"
                value={artwork.year}
                onChange={(e) => patch("year", e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
          <div className="sm:col-span-5">
            <MediumField
              id={`${artwork.id}-medium`}
              value={artwork.medium}
              onChange={(medium) => patch("medium", medium)}
              label="Medium"
              customLabel="Specify medium"
              customHint="Examples: Watercolor, Drawing, Mixed media, Sculpture, Collage"
              required
              error={errors?.medium}
              inputClassName={inputClass}
              FieldWrapper={Field}
            />
          </div>
          <div className="sm:col-span-1">
            <Field
              id={`${artwork.id}-height`}
              label="Height"
              error={errors?.height}
            >
              <input
                id={`${artwork.id}-height`}
                inputMode="decimal"
                value={artwork.height}
                onChange={(e) => patch("height", e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
          <div className="sm:col-span-1">
            <Field
              id={`${artwork.id}-width`}
              label="Width"
              error={errors?.width}
            >
              <input
                id={`${artwork.id}-width`}
                inputMode="decimal"
                value={artwork.width}
                onChange={(e) => patch("width", e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
          <div className="sm:col-span-1">
            <Field
              id={`${artwork.id}-unit`}
              label="Unit"
              error={errors?.dimensionUnit}
            >
              <select
                id={`${artwork.id}-unit`}
                value={artwork.dimensionUnit}
                onChange={(e) =>
                  patch(
                    "dimensionUnit",
                    e.target.value as ArtworkDraft["dimensionUnit"],
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
        </div>
      </div>

      <div className="mt-3 border-t border-[var(--line)] pt-2">
        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          className="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)] hover:text-[var(--ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          aria-expanded={showMore}
        >
          {showMore ? "Hide additional details" : "Additional details"} · depth,
          notes, overrides
        </button>
        {showMore ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <Field id={`${artwork.id}-depth`} label="Depth" error={errors?.depth}>
              <input
                id={`${artwork.id}-depth`}
                inputMode="decimal"
                value={artwork.depth}
                onChange={(e) => patch("depth", e.target.value)}
                className={inputClass}
              />
            </Field>
            <div className="sm:col-span-3">
              <Field id={`${artwork.id}-notes`} label="Notes">
                <textarea
                  id={`${artwork.id}-notes`}
                  rows={2}
                  value={artwork.notes}
                  onChange={(e) => patch("notes", e.target.value)}
                  className={`${inputClass} resize-y`}
                />
              </Field>
            </div>
            <Field id={`${artwork.id}-ov-exhibition`} label="Exhibition override">
              <input
                id={`${artwork.id}-ov-exhibition`}
                value={artwork.overrides.exhibition}
                onChange={(e) => patchOverride("exhibition", e.target.value)}
                placeholder="Use shared"
                className={inputClass}
              />
            </Field>
            <Field id={`${artwork.id}-ov-gallery`} label="Gallery override">
              <input
                id={`${artwork.id}-ov-gallery`}
                value={artwork.overrides.gallery}
                onChange={(e) => patchOverride("gallery", e.target.value)}
                placeholder="Use shared"
                className={inputClass}
              />
            </Field>
            <Field
              id={`${artwork.id}-ov-photographer`}
              label="Photographer override"
            >
              <input
                id={`${artwork.id}-ov-photographer`}
                value={artwork.overrides.photographer}
                onChange={(e) => patchOverride("photographer", e.target.value)}
                placeholder="Use shared"
                className={inputClass}
              />
            </Field>
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function revokeArtworkImage(artwork: ArtworkDraft) {
  revokeImage(artwork.image);
}
