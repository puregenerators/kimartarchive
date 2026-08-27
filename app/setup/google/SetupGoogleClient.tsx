"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  createFailedIntakeFolderAction,
  initializeSheetHeadersAction,
  insertThumbnailColumnAction,
  type SetupActionResult,
} from "@/app/setup/google/actions";
import { ArchiveStatusView } from "@/app/setup/google/ArchiveStatusView";
import type { DropboxDiagnostics } from "@/lib/dropbox/types";
import type { GoogleDiagnostics } from "@/lib/google/diagnostic-types";
import type { SheetTabName } from "@/lib/google/diagnostic-types";
import { FAILED_INTAKE_FOLDER_NAME } from "@/lib/google/drive-query";

type SetupGoogleClientProps = {
  initialDiagnostics: GoogleDiagnostics;
  dropbox: DropboxDiagnostics;
};

export function SetupGoogleClient({
  initialDiagnostics,
  dropbox,
}: SetupGoogleClientProps) {
  const router = useRouter();
  const diagnostics = initialDiagnostics;
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<SetupActionResult | null>(null);
  const [confirmHeadersTab, setConfirmHeadersTab] = useState<SheetTabName | null>(
    null,
  );
  const [confirmFailedIntake, setConfirmFailedIntake] = useState(false);
  const [confirmThumbnailColumn, setConfirmThumbnailColumn] = useState(false);

  function refresh() {
    startTransition(() => {
      router.refresh();
      setMessage(null);
    });
  }

  function runInitialize(tab: SheetTabName) {
    startTransition(async () => {
      const result = await initializeSheetHeadersAction(
        tab,
        `INIT_HEADERS:${tab}`,
      );
      setMessage(result);
      setConfirmHeadersTab(null);
      router.refresh();
    });
  }

  function runInsertThumbnailColumn() {
    startTransition(async () => {
      const result = await insertThumbnailColumnAction("INSERT_THUMBNAIL_COLUMN");
      setMessage(result);
      setConfirmThumbnailColumn(false);
      router.refresh();
    });
  }

  function runCreateFailedIntake() {
    startTransition(async () => {
      const result = await createFailedIntakeFolderAction(
        `CREATE_FOLDER:${FAILED_INTAKE_FOLDER_NAME}`,
      );
      setMessage(result);
      setConfirmFailedIntake(false);
      router.refresh();
    });
  }

  return (
    <ArchiveStatusView
      diagnostics={diagnostics}
      dropbox={dropbox}
      pending={pending}
      message={message}
      confirmHeadersTab={confirmHeadersTab}
      confirmFailedIntake={confirmFailedIntake}
      confirmThumbnailColumn={confirmThumbnailColumn}
      onRefresh={refresh}
      onPrepareHeaders={(tab) => setConfirmHeadersTab(tab)}
      onCancelHeaders={() => setConfirmHeadersTab(null)}
      onConfirmHeaders={runInitialize}
      onPrepareThumbnail={() => setConfirmThumbnailColumn(true)}
      onCancelThumbnail={() => setConfirmThumbnailColumn(false)}
      onConfirmThumbnail={runInsertThumbnailColumn}
      onPrepareFailedIntake={() => setConfirmFailedIntake(true)}
      onCancelFailedIntake={() => setConfirmFailedIntake(false)}
      onConfirmFailedIntake={runCreateFailedIntake}
    />
  );
}
