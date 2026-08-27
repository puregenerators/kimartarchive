"use client";

import { useRef, useState, type DragEvent } from "react";
import {
  MAX_ARTWORKS_PER_BATCH,
  MAX_BATCH_BYTES,
  MAX_FILE_SIZE_LABEL,
} from "@/lib/artwork/types";
import { formatFileSize } from "@/lib/artwork/validation";

type BatchImageUploaderProps = {
  disabled?: boolean;
  remainingSlots?: number;
  onFilesSelected: (files: File[]) => void;
};

const ACCEPT =
  ".tif,.tiff,.jpg,.jpeg,.png,image/tiff,image/jpeg,image/png";

export function BatchImageUploader({
  disabled,
  remainingSlots,
  onFilesSelected,
}: BatchImageUploaderProps) {
  const atCapacity = remainingSlots === 0;
  const blocked = Boolean(disabled || atCapacity);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function takeFiles(list: FileList | File[] | null) {
    if (!list || blocked) return;
    const files = Array.from(list);
    if (files.length === 0) return;
    onFilesSelected(files);
  }

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!blocked) setDragging(true);
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
        "border border-dashed border-[var(--line)] bg-[var(--surface)] p-6 sm:p-8 transition",
        dragging
          ? "border-[var(--accent)] bg-[var(--accent-soft)]"
          : "hover:border-[var(--accent)]",
        blocked ? "opacity-60" : "",
      ].join(" ")}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="sr-only"
        disabled={blocked}
        onChange={(event) => {
          takeFiles(event.target.files);
          event.target.value = "";
        }}
      />

      <div>
        <div className="max-w-2xl">
          <h2 className="font-display text-2xl font-bold text-[var(--ink)]">
            Upload artwork images
          </h2>
          <p className="mt-2 font-bold leading-relaxed text-[var(--muted)]">
            Upload one image for each artwork. Each file will become a separate
            artwork entry.
          </p>
          <ul className="mt-4 list-disc space-y-1.5 pl-5 text-base text-[var(--ink-soft)]">
            <li>
              Use the best-quality file you have first—the largest TIFF is
              preferred
            </li>
            <li>
              Add up to {MAX_ARTWORKS_PER_BATCH} artworks per batch, subject to
              the {formatFileSize(MAX_BATCH_BYTES)} total size limit
            </li>
            <li>
              Accepts File formats: TIFF, JPEG, or PNG · direct upload up to {MAX_FILE_SIZE_LABEL}{" "}
              per file
            </li>
            <li>
              Files over 150 MB will use the large-file Dropbox intake
              process.
            </li>
            {atCapacity ? (
              <li>
                This batch already has the maximum of{" "}
                {MAX_ARTWORKS_PER_BATCH} artworks
              </li>
            ) : remainingSlots != null &&
              remainingSlots < MAX_ARTWORKS_PER_BATCH ? (
              <li>
                {remainingSlots} more artwork
                {remainingSlots === 1 ? "" : "s"} can be added
              </li>
            ) : null}
          </ul>
        </div>

        <button
          type="button"
          disabled={blocked}
          onClick={() => inputRef.current?.click()}
          className="mt-6 border border-[var(--ink)] bg-[var(--ink)] px-5 py-3 text-sm uppercase tracking-[0.14em] text-[var(--paper)] transition hover:bg-[var(--ink-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed"
        >
          Select images
        </button>
      </div>

      <p className="mt-4 text-sm text-[var(--muted)]">
        Or drag and drop files here. Images are not processed or uploaded
        automatically.
      </p>
    </div>
  );
}
