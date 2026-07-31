"use client";

import { useEffect, useRef, useState } from "react";

import { rawFilenameForCopy } from "@/lib/images/result-presentation";

type CopyState = "idle" | "copied" | "failed";

type FilenameDisplayProps = {
  filename: string;
  /** Context for the copy button's accessible name, e.g. "high-resolution JPG". */
  label: string;
};

const COPY_FEEDBACK_MS = 2000;

export function FilenameDisplay({ filename, label }: FilenameDisplayProps) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  async function copyFilename() {
    if (resetTimer.current) clearTimeout(resetTimer.current);

    try {
      await navigator.clipboard.writeText(rawFilenameForCopy(filename));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }

    resetTimer.current = setTimeout(() => setCopyState("idle"), COPY_FEEDBACK_MS);
  }

  const buttonText =
    copyState === "copied"
      ? "Copied"
      : copyState === "failed"
        ? "Copy failed"
        : "Copy";

  return (
    <div className="flex items-start gap-2 border border-[var(--line)] bg-[var(--surface-muted)] py-1.5 pl-2 pr-1.5">
      <code className="min-w-0 flex-1 break-all font-mono text-[11px] leading-relaxed text-[var(--ink)] sm:text-xs">
        {filename}
      </code>
      <button
        type="button"
        onClick={() => {
          void copyFilename();
        }}
        aria-label={`Copy ${label} filename ${filename}`}
        className="shrink-0 border border-[var(--line)] bg-[var(--surface-elevated)] px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] transition hover:text-[var(--ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
      >
        {buttonText}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {copyState === "copied"
          ? `Copied ${filename}`
          : copyState === "failed"
            ? `Could not copy ${filename}`
            : ""}
      </span>
    </div>
  );
}
