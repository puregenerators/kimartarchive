"use client";

/**
 * Internal developer utility for local HR / web / thumbnail diagnostics.
 * Not mounted in the archive UI — import only when testing processing locally.
 */

import { useEffect, useRef, useState } from "react";

import { ProcessingResultPanel } from "@/components/artwork/ProcessingResultPanel";
import { planFilenamesForArtwork } from "@/lib/artwork/filenames";
import {
  MAX_FILE_SIZE_LABEL,
  requiresLargeFileDropboxIntake,
} from "@/lib/artwork/types";
import { suggestTitleFromFilename } from "@/lib/artwork/suggest-title";
import { formatFileSize, isTiffFile } from "@/lib/artwork/validation";
import type {
  ArtworkProcessingSuccess,
  ProcessArtworkImageApiFailure,
  ProcessArtworkImageApiSuccess,
} from "@/lib/images/client-types";
import { LOCAL_DEV_MULTIPART_BLOCKED_MESSAGE } from "@/lib/images/dev-process-guard";

const ACCEPT =
  ".tif,.tiff,.jpg,.jpeg,.png,image/tiff,image/jpeg,image/png";

const inputClass =
  "w-full border border-[var(--line)] bg-[var(--surface-elevated)] px-3 py-2 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent-soft-strong)]";

type LocalProcessState =
  | { status: "idle" }
  | { status: "processing" }
  | { status: "success"; result: ArtworkProcessingSuccess }
  | { status: "error"; code: string; message: string };

type LocalImageProcessingTestProps = {
  available: boolean;
};

export function LocalImageProcessingTest({
  available,
}: LocalImageProcessingTestProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [state, setState] = useState<LocalProcessState>({ status: "idle" });
  const [sourcePreviewUrl, setSourcePreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (sourcePreviewUrl) URL.revokeObjectURL(sourcePreviewUrl);
    };
  }, [sourcePreviewUrl]);

  function takeFile(next: File | null) {
    setSourcePreviewUrl(
      next && !isTiffFile(next) ? URL.createObjectURL(next) : null,
    );
    setFile(next);
    setState({ status: "idle" });
    if (next && !title.trim()) {
      setTitle(suggestTitleFromFilename(next.name).title);
    }
  }

  async function runTest() {
    if (!available || !file || state.status === "processing") return;
    if (requiresLargeFileDropboxIntake(file.size)) {
      setState({
        status: "error",
        code: "FILE_TOO_LARGE",
        message: `This file exceeds ${MAX_FILE_SIZE_LABEL}. Large masters use Dropbox intake during submission, not this local diagnostic.`,
      });
      return;
    }

    const archivedTitle = title.trim() || "Untitled";
    const plan = planFilenamesForArtwork({
      year: year.trim() || String(new Date().getFullYear()),
      inventoryId: 1000,
      title: archivedTitle,
      masterFilename: file.name,
    });

    setState({ status: "processing" });

    try {
      const body = new FormData();
      body.set("file", file);
      body.set("artworkId", "setup-archive-diagnostic");
      body.set("originalFilename", file.name);
      body.set("title", archivedTitle);
      body.set("year", year.trim() || String(new Date().getFullYear()));
      body.set("inventoryId", "1000");
      body.set("masterFilename", plan.master);
      body.set("hrFilename", plan.hr);
      body.set("webFilename", plan.web);
      body.set("thumbFilename", plan.thumb);

      const response = await fetch("/api/dev/process-artwork-image", {
        method: "POST",
        body,
      });
      const data = (await response.json()) as
        | ProcessArtworkImageApiSuccess
        | ProcessArtworkImageApiFailure;

      if (!response.ok || !data.ok) {
        const failure = data as ProcessArtworkImageApiFailure;
        setState({
          status: "error",
          code: failure.error?.code ?? "SHARP_DECODE_FAILURE",
          message:
            failure.error?.message ??
            "Image processing failed. Check the source file and try again.",
        });
        return;
      }

      setState({
        status: "success",
        result: {
          status: "success",
          resultId: data.resultId,
          expiresAt: data.expiresAt,
          durationMs: data.durationMs,
          warnings: data.warnings,
          source: data.source,
          master: data.master,
          hr: data.hr,
          web: data.web,
          thumb: data.thumb,
          comparisons: data.comparisons,
        },
      });
    } catch {
      setState({
        status: "error",
        code: "SHARP_DECODE_FAILURE",
        message:
          "Could not reach the local processing endpoint. Is the app running?",
      });
    }
  }

  const busy = state.status === "processing";

  return (
    <section className="border border-[var(--line)] bg-[var(--surface)] p-5">
      <h2 className="font-display text-xl text-[var(--ink)]">
        Local image processing
      </h2>
      <p className="mt-3 text-sm text-[var(--ink-soft)]">
        Developer diagnostic for HR / web / thumbnail derivatives. Results are
        temporary and are not reused by Submit Batch. Permanent submission still
        runs the canonical pipeline from the Dropbox master.
      </p>

      {!available ? (
        <p
          role="status"
          className="mt-4 border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-2 text-sm text-[var(--ink)]"
        >
          {LOCAL_DEV_MULTIPART_BLOCKED_MESSAGE}
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            disabled={busy}
            onChange={(event) => {
              takeFile(event.target.files?.[0] ?? null);
              event.target.value = "";
            }}
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              className="border border-[var(--line)] bg-[var(--surface-elevated)] px-4 py-2 text-xs uppercase tracking-[0.12em] text-[var(--ink)] disabled:opacity-50"
            >
              Choose image
            </button>
            {file ? (
              <p className="text-sm text-[var(--ink)]">
                {file.name} · {formatFileSize(file.size)}
              </p>
            ) : (
              <p className="text-sm text-[var(--muted)]">
                JPEG, PNG, or TIFF · under {MAX_FILE_SIZE_LABEL}
              </p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
                Title
              </span>
              <input
                className={inputClass}
                value={title}
                disabled={busy}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
                Year
              </span>
              <input
                className={inputClass}
                value={year}
                disabled={busy}
                onChange={(event) => setYear(event.target.value)}
              />
            </label>
          </div>

          <button
            type="button"
            disabled={!file || busy}
            onClick={() => {
              void runTest();
            }}
            className="border border-[var(--ink)] bg-[var(--ink)] px-4 py-2 text-xs uppercase tracking-[0.12em] text-[var(--paper)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Processing…" : "Process image"}
          </button>
        </div>
      )}

      {state.status === "error" ? (
        <div
          role="alert"
          className="mt-4 border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]"
        >
          <p className="font-medium">Processing failed</p>
          <p className="mt-1">{state.message}</p>
          <p className="mt-1 text-xs opacity-80">{state.code}</p>
        </div>
      ) : null}

      {state.status === "success" ? (
        <ProcessingResultPanel
          result={state.result}
          sourcePreviewUrl={sourcePreviewUrl}
          isTiff={Boolean(file && isTiffFile(file))}
        />
      ) : null}
    </section>
  );
}
