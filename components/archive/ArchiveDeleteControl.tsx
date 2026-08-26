"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { deleteArtworkAction } from "@/app/artworks/actions";
import { ArchiveDeleteControlView } from "@/components/archive/ArchiveDeleteControlView";
import {
  ARCHIVE_DELETE_FAILED_MESSAGE,
  nextRouteAfterArchiveDelete,
  reduceArchiveDeleteUi,
  type ArchiveDeleteUiEvent,
  type ArchiveDeleteUiPhase,
} from "@/lib/archive/delete-logic";

function archiveDeleteUiReducer(
  phase: ArchiveDeleteUiPhase,
  event: ArchiveDeleteUiEvent,
): ArchiveDeleteUiPhase {
  return reduceArchiveDeleteUi(phase, event);
}

export function ArchiveDeleteControl({
  inventoryId,
  title,
  variant = "card",
  onDeleted,
}: {
  inventoryId: number;
  title: string;
  variant?: "card" | "detail";
  onDeleted?: (inventoryId: number, message: string) => void;
}) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const [phase, dispatch] = useReducer(archiveDeleteUiReducer, "idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (phase === "idle") return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        dispatch("cancel");
        setError(null);
      }
    }

    function onPointerDown(event: PointerEvent) {
      if (phase !== "menu") return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current && !rootRef.current.contains(target)) {
        dispatch("dismiss-menu");
      }
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [phase]);

  async function confirmDelete() {
    if (phase !== "confirm") return;
    setError(null);
    dispatch("confirm-delete");
    try {
      const result = await deleteArtworkAction(inventoryId);
      if (!result.ok) {
        setError(result.message);
        dispatch("failure");
        return;
      }
      dispatch("success");
      const redirectTo = nextRouteAfterArchiveDelete({
        source: variant === "detail" ? "detail" : "list",
        ok: true,
      });
      if (redirectTo) {
        router.replace(redirectTo);
      } else {
        onDeleted?.(result.inventoryId, result.message);
      }
      router.refresh();
    } catch {
      setError(ARCHIVE_DELETE_FAILED_MESSAGE);
      dispatch("failure");
    }
  }

  return (
    <div ref={rootRef}>
      <ArchiveDeleteControlView
        title={title}
        phase={phase}
        error={error}
        variant={variant}
        onToggleMenu={() => {
          setError(null);
          dispatch("toggle-menu");
        }}
        onSelectDelete={() => {
          setError(null);
          dispatch("select-delete");
        }}
        onCancel={() => {
          setError(null);
          dispatch("cancel");
        }}
        onConfirmDelete={() => {
          void confirmDelete();
        }}
      />
    </div>
  );
}
