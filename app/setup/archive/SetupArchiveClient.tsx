"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  disconnectDropboxAction,
  type DropboxSetupActionResult,
} from "@/app/setup/archive/actions";
import {
  ArchiveSetupView,
  type UploadTestUiResult,
} from "@/app/setup/archive/ArchiveSetupView";
import type { DropboxDiagnostics } from "@/lib/dropbox/types";
import type { GoogleDiagnostics } from "@/lib/google/diagnostic-types";

const FAILED_OPERATION_LABELS: Record<string, string> = {
  create_folder: "Folder created",
  upload: "File uploaded",
  verify_metadata: "Metadata verified",
  create_shared_link: "Shared link created",
  download: "Download verified",
  delete_file: "File deleted",
  delete_folder: "Folder deleted",
};

type ArchiveSetupClientProps = {
  google: GoogleDiagnostics;
  dropbox: DropboxDiagnostics;
  flash: {
    kind: "success" | "error" | null;
    message: string | null;
  };
};

export function ArchiveSetupClient({
  google,
  dropbox,
  flash,
}: ArchiveSetupClientProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<DropboxSetupActionResult | null>(() => {
    if (flash.kind === "success") {
      return { ok: true, message: flash.message ?? "Done." };
    }
    if (flash.kind === "error") {
      return {
        ok: false,
        code: "OAUTH",
        message: flash.message ?? "Dropbox connection failed.",
      };
    }
    return null;
  });
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [uploadTestPending, setUploadTestPending] = useState(false);
  const [uploadTestResult, setUploadTestResult] =
    useState<UploadTestUiResult | null>(null);

  function refresh() {
    startTransition(() => {
      router.refresh();
      setMessage(null);
    });
  }

  function runDisconnect() {
    startTransition(async () => {
      const result = await disconnectDropboxAction();
      setMessage(result);
      setConfirmDisconnect(false);
      router.refresh();
    });
  }

  function runDiagnostics() {
    startTransition(() => {
      router.refresh();
      setMessage({
        ok: true,
        message: "Diagnostics refreshed.",
      });
    });
  }

  async function runUploadTest() {
    setUploadTestPending(true);
    setUploadTestResult(null);
    setMessage(null);
    try {
      const response = await fetch("/api/dropbox/test-upload", {
        method: "POST",
      });
      const data = (await response.json()) as {
        success?: boolean;
        message?: string;
        failedOperation?: string;
        folderCreated?: boolean;
        uploadSucceeded?: boolean;
        metadataVerified?: boolean;
        sharedLinkCreated?: boolean;
        downloadVerified?: boolean;
        fileDeleted?: boolean;
        folderDeleted?: boolean;
        error?: { message?: string };
      };

      const failedOperationLabel = data.failedOperation
        ? (FAILED_OPERATION_LABELS[data.failedOperation] ?? data.failedOperation)
        : null;

      setUploadTestResult({
        success: Boolean(data.success),
        message:
          data.message ??
          data.error?.message ??
          (data.success
            ? "Dropbox upload integration test passed."
            : "Dropbox upload test failed."),
        failedOperationLabel,
        folderCreated: Boolean(data.folderCreated),
        uploadSucceeded: Boolean(data.uploadSucceeded),
        metadataVerified: Boolean(data.metadataVerified),
        sharedLinkCreated: Boolean(data.sharedLinkCreated),
        downloadVerified: Boolean(data.downloadVerified),
        fileDeleted: Boolean(data.fileDeleted),
        folderDeleted: Boolean(data.folderDeleted),
      });
    } catch {
      setUploadTestResult({
        success: false,
        message: "Could not reach the Dropbox upload test endpoint.",
        failedOperationLabel: "Folder created",
        folderCreated: false,
        uploadSucceeded: false,
        metadataVerified: false,
        sharedLinkCreated: false,
        downloadVerified: false,
        fileDeleted: false,
        folderDeleted: false,
      });
    } finally {
      setUploadTestPending(false);
    }
  }

  return (
    <ArchiveSetupView
      google={google}
      dropbox={dropbox}
      pending={pending}
      message={message}
      confirmDisconnect={confirmDisconnect}
      uploadTestPending={uploadTestPending}
      uploadTestResult={uploadTestResult}
      onRefresh={refresh}
      onDisconnectClick={() => setConfirmDisconnect(true)}
      onConfirmDisconnect={runDisconnect}
      onCancelDisconnect={() => setConfirmDisconnect(false)}
      onRunDiagnostics={runDiagnostics}
      onRunUploadTest={() => {
        void runUploadTest();
      }}
    />
  );
}
