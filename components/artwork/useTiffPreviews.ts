"use client";

import { useEffect, useRef, useState } from "react";

import { IMAGE_PROCESSING_CONFIG } from "@/lib/images/config";
import type { ArtworkDraft } from "@/lib/artwork/types";
import {
  buildSourceFileFingerprint,
  clearAllTiffPreviewState,
  clearTiffPreviewState,
  largeMasterPreviewUnavailableMessage,
  shouldSkipLargeMasterUiPreview,
  shouldSkipTiffUiPreviewUpload,
  tiffUiPreviewSkippedMessage,
  type ImagePreviewApiFailure,
  type ImagePreviewApiSuccess,
  type TiffPreviewState,
} from "@/lib/images/preview-client";
import {
  createPreviewQueue,
  type PreviewQueue,
  type PreviewQueueJob,
} from "@/lib/images/preview-queue";

type PreviewJobPayload = {
  artworkId: string;
  fingerprint: string;
  file: File;
};

/**
 * Manage temporary TIFF UI previews for a batch.
 * Keyed by stable artwork id + source-file fingerprint.
 */
export function useTiffPreviews() {
  const [previewByArtworkId, setPreviewByArtworkId] = useState<
    Record<string, TiffPreviewState>
  >({});
  const previewRef = useRef(previewByArtworkId);
  const generationRef = useRef(0);
  const queueRef = useRef<PreviewQueue<PreviewJobPayload> | null>(null);
  const pendingJobsRef = useRef<PreviewQueueJob<PreviewJobPayload>[]>([]);

  useEffect(() => {
    previewRef.current = previewByArtworkId;
  }, [previewByArtworkId]);

  useEffect(() => {
    const queue = createPreviewQueue<PreviewJobPayload>({
      concurrency: IMAGE_PROCESSING_CONFIG.preview.concurrency,
      async run(job) {
        const { artworkId, fingerprint, file } = job.payload;
        const gen = generationRef.current;

        setPreviewByArtworkId((current) => {
          const existing = current[artworkId];
          if (
            existing &&
            existing.status !== "idle" &&
            existing.fingerprint !== fingerprint
          ) {
            return current;
          }
          const next = {
            ...current,
            [artworkId]: { status: "loading" as const, fingerprint },
          };
          previewRef.current = next;
          return next;
        });

        try {
          const body = new FormData();
          body.set("file", file);
          body.set("artworkId", artworkId);
          body.set("originalFilename", file.name);

          const response = await fetch("/api/image-preview", {
            method: "POST",
            body,
          });
          const data = (await response.json()) as
            | ImagePreviewApiSuccess
            | ImagePreviewApiFailure;

          if (gen !== generationRef.current) return;

          const latest = previewRef.current[artworkId];
          if (
            latest &&
            latest.status !== "idle" &&
            latest.fingerprint !== fingerprint
          ) {
            return;
          }

          if (!response.ok || !data.ok) {
            const failure = data as ImagePreviewApiFailure;
            setPreviewByArtworkId((current) => {
              const next = {
                ...current,
                [artworkId]: {
                  status: "error" as const,
                  fingerprint,
                  message:
                    failure.error?.message ??
                    "Preview unavailable. The original TIFF can still be processed.",
                },
              };
              previewRef.current = next;
              return next;
            });
            return;
          }

          setPreviewByArtworkId((current) => {
            const existing = current[artworkId];
            if (
              existing &&
              existing.status !== "idle" &&
              existing.fingerprint !== fingerprint
            ) {
              return current;
            }
            if (
              existing?.status === "ready" &&
              existing.resultId !== data.resultId
            ) {
              void fetch(`/api/image-preview/${data.resultId}`, {
                method: "DELETE",
              }).catch(() => undefined);
              return current;
            }
            const next: Record<string, TiffPreviewState> = {
              ...current,
              [artworkId]: {
                status: "ready",
                fingerprint,
                resultId: data.resultId,
                previewUrl: data.previewUrl,
                expiresAt: data.expiresAt,
                isMultiPage: data.isMultiPage,
                pageCount: data.pageCount,
              },
            };
            previewRef.current = next;
            return next;
          });
        } catch {
          if (gen !== generationRef.current) return;
          setPreviewByArtworkId((current) => {
            const existing = current[artworkId];
            if (
              existing &&
              existing.status !== "idle" &&
              existing.fingerprint !== fingerprint
            ) {
              return current;
            }
            const next = {
              ...current,
              [artworkId]: {
                status: "error" as const,
                fingerprint,
                message:
                  "Preview unavailable. The original TIFF can still be processed.",
              },
            };
            previewRef.current = next;
            return next;
          });
        }
      },
    });

    queueRef.current = queue;
    const pending = pendingJobsRef.current.splice(0);
    for (const job of pending) {
      queue.enqueue(job);
    }

    return () => {
      generationRef.current += 1;
      queue.clear();
      queueRef.current = null;
      pendingJobsRef.current = [];
      clearAllTiffPreviewState(previewRef.current);
    };
  }, []);

  function enqueueJob(job: PreviewQueueJob<PreviewJobPayload>) {
    if (queueRef.current) {
      queueRef.current.enqueue(job);
      return;
    }
    const existingIndex = pendingJobsRef.current.findIndex(
      (item) => item.id === job.id,
    );
    if (existingIndex >= 0) {
      pendingJobsRef.current.splice(existingIndex, 1);
    }
    pendingJobsRef.current.push(job);
  }

  function enqueueForArtwork(artwork: ArtworkDraft) {
    if (!artwork.image?.isTiff) return;
    const fingerprint = buildSourceFileFingerprint({
      imageName: artwork.image.file.name,
      imageSize: artwork.image.file.size,
      imageLastModified: artwork.image.file.lastModified,
    });

    if (
      shouldSkipLargeMasterUiPreview(artwork.image.file.size) ||
      shouldSkipTiffUiPreviewUpload(artwork.image.file.size)
    ) {
      const skipMessage = shouldSkipLargeMasterUiPreview(artwork.image.file.size)
        ? largeMasterPreviewUnavailableMessage()
        : tiffUiPreviewSkippedMessage(artwork.image.file.name);
      const existing = previewRef.current[artwork.id];
      if (
        existing?.status === "error" &&
        existing.fingerprint === fingerprint &&
        existing.message === skipMessage
      ) {
        return;
      }
      if (existing?.status === "ready" && existing.fingerprint !== fingerprint) {
        void fetch(`/api/image-preview/${existing.resultId}`, {
          method: "DELETE",
        }).catch(() => undefined);
      }
      queueRef.current?.cancel(artwork.id);
      pendingJobsRef.current = pendingJobsRef.current.filter(
        (job) => job.id !== artwork.id,
      );
      setPreviewByArtworkId((current) => {
        const next = {
          ...current,
          [artwork.id]: {
            status: "error" as const,
            fingerprint,
            message: skipMessage,
          },
        };
        previewRef.current = next;
        return next;
      });
      return;
    }

    const existing = previewRef.current[artwork.id];
    if (
      existing &&
      existing.status !== "idle" &&
      existing.fingerprint === fingerprint &&
      (existing.status === "ready" ||
        existing.status === "loading" ||
        existing.status === "queued")
    ) {
      return;
    }

    if (existing?.status === "ready" && existing.fingerprint !== fingerprint) {
      void fetch(`/api/image-preview/${existing.resultId}`, {
        method: "DELETE",
      }).catch(() => undefined);
    }

    setPreviewByArtworkId((current) => {
      const next = {
        ...current,
        [artwork.id]: { status: "queued" as const, fingerprint },
      };
      previewRef.current = next;
      return next;
    });

    enqueueJob({
      id: artwork.id,
      payload: {
        artworkId: artwork.id,
        fingerprint,
        file: artwork.image.file,
      },
    });
  }

  function enqueueMissing(artworks: readonly ArtworkDraft[]) {
    for (const artwork of artworks) {
      enqueueForArtwork(artwork);
    }
  }

  function invalidateArtwork(artworkId: string) {
    queueRef.current?.cancel(artworkId);
    pendingJobsRef.current = pendingJobsRef.current.filter(
      (job) => job.id !== artworkId,
    );
    setPreviewByArtworkId((current) => {
      const next = clearTiffPreviewState(current, artworkId);
      previewRef.current = next;
      return next;
    });
  }

  function resetAll() {
    generationRef.current += 1;
    queueRef.current?.clear();
    pendingJobsRef.current = [];
    setPreviewByArtworkId((current) => {
      const next = clearAllTiffPreviewState(current);
      previewRef.current = next;
      return next;
    });
  }

  return {
    previewByArtworkId,
    enqueueForArtwork,
    enqueueMissing,
    invalidateArtwork,
    resetAll,
  };
}
