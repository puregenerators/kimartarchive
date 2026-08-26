"use client";

import { useEffect, useState } from "react";

import { LargeMasterIntakePanel } from "@/components/artwork/LargeMasterIntakePanel";
import { formatFileSize } from "@/lib/artwork/validation";
import type {
  IncompleteLargeFileIntake,
  LargeFileCheckResult,
  LargeFileIntakeStatus,
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
            message:
              "This inventory ID is reserved. Upload the expected master through Dropbox, then check.",
            canContinueProcessing: false,
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
              status: "failed" as LargeFileIntakeStatus,
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
              data.byteLength != null ? formatFileSize(data.byteLength) : null,
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
                status: "failed",
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
        | { ok: false; errorCode?: string; message: string };
      setIntakes((current) =>
        (current ?? []).map((entry) => {
          if (entry.claimId !== claimId) return entry;
          if (data.ok) {
            return {
              ...entry,
              processing: false,
              status: "completed",
              message: "Derivatives, metadata, and the inventory row are complete.",
              canContinueProcessing: false,
            };
          }
          const local =
            "errorCode" in data && data.errorCode === "LOCAL_PROCESSING_REQUIRED";
          return {
            ...entry,
            processing: false,
            status: local ? "local_processing_required" : "failed",
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
          Resume incomplete large-file intakes
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          These inventory IDs are already claimed. Checking or continuing does
          not allocate a new ID.
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
        />
      ))}
    </section>
  );
}
