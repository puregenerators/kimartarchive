"use client";

import { useRef, useState, type DragEvent } from "react";
import {
  MAX_ARTWORKS_PER_BATCH,
  MAX_BATCH_BYTES,
  MAX_FILE_BYTES,
} from "@/lib/artwork/types";
import { formatFileSize } from "@/lib/artwork/validation";

type BatchImageUploaderProps = {
  disabled?: boolean;
  onFilesSelected: (files: File[]) => void;
  compact?: boolean;
};

const ACCEPT =
  ".tif,.tiff,.jpg,.jpeg,.png,image/tiff,image/jpeg,image/png";

export function BatchImageUploader({
  disabled,
  onFilesSelected,
  compact = false,
}: BatchImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function takeFiles(list: FileList | File[] | null) {
    if (!list || disabled) return;
    const files = Array.from(list);
    if (files.length === 0) return;
    onFilesSelected(files);
  }

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!disabled) setDragging(true);
  }

  function onDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    takeFiles(event.dataTransfer.files);
  }

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={[
        "border border-dashed transition",
        compact
          ? "border-[var(--line)] bg-[var(--surface)] p-4"
          : "border-[var(--line)] bg-[var(--surface)] p-6 sm:p-8",
        dragging
          ? "border-[var(--accent)] bg-[var(--accent-soft)]"
          : "hover:border-[var(--accent)]",
        disabled ? "opacity-60" : "",
      ].join(" ")}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="sr-only"
        disabled={disabled}
        onChange={(event) => {
          takeFiles(event.target.files);
          event.target.value = "";
        }}
      />

      <div className={compact ? "flex flex-wrap items-center gap-4" : ""}>
        <div className={compact ? "min-w-0 flex-1" : "max-w-2xl"}>
          {!compact ? (
            <h2 className="font-display text-2xl text-[var(--ink)]">
              Upload artwork images
            </h2>
          ) : (
            <p className="text-sm font-medium text-[var(--ink)]">
              Add more images
            </p>
          )}
          <p
            className={
              compact
                ? "mt-1 text-sm text-[var(--muted)]"
                : "mt-2 text-[var(--muted)] leading-relaxed"
            }
          >
            Upload one image for each artwork. Each file will become a separate
            artwork entry.
          </p>
          {!compact ? (
            <ul className="mt-4 space-y-1 text-sm text-[var(--ink-soft)]">
              <li>Suggested working batch: about 10–12 files</li>
              <li>
                TIFF, JPEG, or PNG · up to {formatFileSize(MAX_FILE_BYTES)} per
                file
              </li>
              <li>
                Up to {MAX_ARTWORKS_PER_BATCH} artworks ·{" "}
                {formatFileSize(MAX_BATCH_BYTES)} total
              </li>
              <li>Files stay on this device until you submit later</li>
            </ul>
          ) : null}
        </div>

        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className={[
            "border border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)] transition hover:bg-[var(--ink-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed",
            compact
              ? "px-4 py-2 text-xs uppercase tracking-[0.12em]"
              : "mt-6 px-5 py-3 text-sm uppercase tracking-[0.14em]",
          ].join(" ")}
        >
          {compact ? "Choose files" : "Select images"}
        </button>
      </div>

      {!compact ? (
        <p className="mt-4 text-sm text-[var(--muted)]">
          Or drag and drop files here. Images are not processed or uploaded
          automatically.
        </p>
      ) : null}
    </div>
  );
}
