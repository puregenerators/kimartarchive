"use client";

import { useEffect, useState } from "react";

import { LargeMasterIntakePanel } from "@/components/artwork/LargeMasterIntakePanel";
import { formatFileSize } from "@/lib/artwork/validation";
import {
  statusFromLargeFileProcessError,
  type IncompleteLargeFileIntake,
  type LargeFileCheckResult,
  type LargeFileIntakeStatus,
} from "@/lib/submission/large-file-intake-logic";
import type { ArtworkSubmissionResult } from "@/lib/submission/types";

type ResumeItemState = IncompleteLargeFileIntake & {
  message: string;
  canContinueProcessing: boolean;
  checking?: boolean;
  processing?: boolean;
  byteLengthLabel?: string | null;
  dimensionsLabel?: string | null;
};

function dimensionsLabel(check: LargeFileCheckResult): string | null {
  if (check.width && check.height) {
    const depth = check.bitDepth ? ` · ${check.bitDepth}-bit` : "";
    return `${check.width}×${check.height}px${depth}`;
  }
  return null;
}

export function IncompleteLargeFileResume() {
  const [intakes, setIntakes] = useState<ResumeItemState[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/artwork-batches/large-file");
        const data = (await response.json()) as
          | { ok: true; intakes: IncompleteLargeFileIntake[] }
          | { ok: false; code?: string; message: string };
        if (cancelled) return;
        if (!data.ok) {
          setIntakes([]);
          if (data.code !== "PREFLIGHT_FAILED") {
            setLoadError(data.message);
          }
          return;
        }
        setIntakes(
          data.intakes.map((entry) => ({
            ...entry,
            message: "",
            canContinueProcessing: false,
            byteLengthLabel:
              entry.declaredByteLength > 0
                ? formatFileSize(entry.declaredByteLength)
                : null,
          })),
        );
      } catch {
        if (!cancelled) {
          setLoadError("Could not load incomplete large-file intakes.");
          setIntakes([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function checkOne(claimId: string, inventoryId: number) {
    setIntakes((current) =>
      (current ?? []).map((entry) =>
        entry.claimId === claimId ? { ...entry, checking: true } : entry,
      ),
    );
    try {
      const response = await fetch("/api/artwork-batches/check-master", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimId, inventoryId }),
      });
      const data = (await response.json()) as
        | LargeFileCheckResult
        | { ok: false; message: string };
      setIntakes((current) =>
        (current ?? []).map((entry) => {
          if (entry.claimId !== claimId) return entry;
          if (!data.ok) {
            return {
              ...entry,
              checking: false,
              message: data.message,
              canContinueProcessing: false,
            };
          }
          return {
            ...entry,
            checking: false,
            status: data.status,
            message: data.message,
            folderWebUrl: data.folderWebUrl,
            canContinueProcessing: data.canContinueProcessing,
            byteLengthLabel:
              data.byteLength != null
                ? formatFileSize(data.byteLength)
                : entry.byteLengthLabel,
            dimensionsLabel: dimensionsLabel(data),
          };
        }),
      );
    } catch {
      setIntakes((current) =>
        (current ?? []).map((entry) =>
          entry.claimId === claimId
            ? {
                ...entry,
                checking: false,
                message: "Could not check Dropbox for this master.",
                canContinueProcessing: false,
              }
            : entry,
        ),
      );
    }
  }

  async function processOne(claimId: string, inventoryId: number) {
    setIntakes((current) =>
      (current ?? []).map((entry) =>
        entry.claimId === claimId
          ? { ...entry, processing: true, status: "processing" }
          : entry,
      ),
    );
    try {
      const response = await fetch("/api/artwork-batches/large-file/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimId, inventoryId }),
      });
      const data = (await response.json()) as
        | ArtworkSubmissionResult
        | { ok: false; errorCode?: string; message: string; status?: LargeFileIntakeStatus };
      setIntakes((current) =>
        (current ?? []).map((entry) => {
          if (entry.claimId !== claimId) return entry;
          if (data.ok) {
            return {
              ...entry,
              processing: false,
              status: "completed",
              message: "Artwork added to the archive",
              canContinueProcessing: false,
            };
          }
          const nextStatus = statusFromLargeFileProcessError(data);
          return {
            ...entry,
            processing: false,
            status: nextStatus,
            message: data.message,
            canContinueProcessing: false,
          };
        }),
      );
    } catch {
      setIntakes((current) =>
        (current ?? []).map((entry) =>
          entry.claimId === claimId
            ? {
                ...entry,
                processing: false,
                status: "failed",
                message: "Processing failed. The inventory ID was not replaced.",
                canContinueProcessing: false,
              }
            : entry,
        ),
      );
    }
  }

  async function dismissOne(claimId: string, inventoryId: number) {
    const response = await fetch("/api/artwork-batches/large-file/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimId, inventoryId }),
    });
    const data = (await response.json()) as
      | { ok: true }
      | { ok: false; message?: string };
    if (!data.ok) {
      throw new Error(
        data.message ?? "Could not remove this incomplete intake.",
      );
    }
    setIntakes((current) =>
      (current ?? []).filter((entry) => entry.claimId !== claimId),
    );
  }

  if (intakes === null) {
    return null;
  }
  if (loadError) {
    return (
      <p role="status" className="mt-6 text-sm text-[var(--muted)]">
        {loadError}
      </p>
    );
  }
  if (intakes.length === 0) return null;

  return (
    <section className="mt-8 space-y-4" aria-labelledby="resume-large-file-heading">
      <div>
        <h2
          id="resume-large-file-heading"
          className="font-display text-xl text-[var(--ink)]"
        >
          Resume incomplete large-file uploads
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Upload the expected master through Dropbox, then check here. This does
          not allocate a new inventory ID.
        </p>
      </div>
      {intakes.map((intake) => (
        <LargeMasterIntakePanel
          key={intake.claimId}
          inventoryId={intake.inventoryId}
          title={intake.title || `Inventory ${intake.inventoryId}`}
          folderName={intake.folderName}
          masterFilename={intake.masterFilename}
          folderWebUrl={intake.folderWebUrl}
          status={intake.status}
          message={intake.message}
          byteLengthLabel={intake.byteLengthLabel}
          dimensionsLabel={intake.dimensionsLabel}
          checking={intake.checking}
          processing={intake.processing}
          canContinueProcessing={intake.canContinueProcessing}
          onCheck={() => {
            void checkOne(intake.claimId, intake.inventoryId);
          }}
          onContinue={() => {
            void processOne(intake.claimId, intake.inventoryId);
          }}
          onDismiss={() => dismissOne(intake.claimId, intake.inventoryId)}
        />
      ))}
    </section>
  );
}
