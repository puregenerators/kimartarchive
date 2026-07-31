import { access } from "node:fs/promises";

import { DropboxIntegrationError } from "@/lib/dropbox/errors";
import { GoogleIntegrationError } from "@/lib/google/errors";
import type {
  ArtworkSubmissionStage,
  SubmissionErrorCode,
  SubmissionFailedOperation,
} from "@/lib/submission/types";

export type MasterUploadFailureKind =
  | "temp_missing"
  | "stream_failed"
  | "drive_rejected"
  | "missing_metadata"
  | "permission_denied"
  | "storage_quota"
  | "unknown";

/**
 * User-facing copy for master-upload failures.
 * Permission wording is reserved for confirmed sharing/permission denials.
 */
export function messageForMasterUploadFailure(
  kind: MasterUploadFailureKind,
  options?: { folderCreated?: boolean; underlyingMessage?: string },
): string {
  switch (kind) {
    case "temp_missing":
      return "The original image could not be read from temporary storage.";
    case "stream_failed":
      return "The original image could not be read from temporary storage.";
    case "missing_metadata":
      return "The upload completed but file metadata was not returned.";
    case "permission_denied":
      return (
        options?.underlyingMessage ??
        "Archive storage access was denied. Check Dropbox connection or Drive sharing."
      );
    case "storage_quota":
      return (
        options?.underlyingMessage ??
        "Google Drive rejected the upload because the service account has no storage quota for this location. Use a Shared Drive as the archive root (service accounts cannot store file content in a personal My Drive folder)."
      );
    case "drive_rejected":
      return options?.underlyingMessage ?? "Archive storage rejected the upload request.";
    case "unknown":
    default:
      if (options?.folderCreated) {
        return (
          options.underlyingMessage ??
          "The artwork folder was created, but the original file could not be uploaded."
        );
      }
      return (
        options?.underlyingMessage ??
        "The original file could not be uploaded to archive storage."
      );
  }
}

export function classifyMasterUploadError(error: unknown): {
  kind: MasterUploadFailureKind;
  code: SubmissionErrorCode;
  message: string;
  httpStatus?: number;
  googleReason?: string;
  causeDetail?: string;
} {
  if (error instanceof DropboxIntegrationError) {
    if (
      error.code === "TOKEN_REFRESH_FAILED" ||
      error.code === "MISSING_REFRESH_TOKEN" ||
      error.code === "NOT_CONNECTED"
    ) {
      return {
        kind: "permission_denied",
        code: "DRIVE_UPLOAD_FAILED",
        message: messageForMasterUploadFailure("permission_denied", {
          underlyingMessage: error.safeMessage,
        }),
        httpStatus: error.httpStatus,
        causeDetail: error.code,
      };
    }
    if (
      error.httpStatus === 429 ||
      error.httpStatus === 500 ||
      error.httpStatus === 503
    ) {
      return {
        kind: "drive_rejected",
        code: "GOOGLE_TRANSIENT",
        message: error.safeMessage,
        httpStatus: error.httpStatus,
        causeDetail: error.code,
      };
    }
    return {
      kind: "drive_rejected",
      code: "DRIVE_UPLOAD_FAILED",
      message: messageForMasterUploadFailure("drive_rejected", {
        folderCreated: true,
        underlyingMessage: error.safeMessage,
      }),
      httpStatus: error.httpStatus,
      causeDetail: error.code,
    };
  }

  if (error instanceof GoogleIntegrationError) {
    if (error.code === "DRIVE_ACCESS_DENIED") {
      return {
        kind: "permission_denied",
        code: "DRIVE_UPLOAD_FAILED",
        message: messageForMasterUploadFailure("permission_denied", {
          underlyingMessage: error.safeMessage,
        }),
        httpStatus: error.httpStatus,
        googleReason: error.googleReason,
        causeDetail: error.causeDetail,
      };
    }
    if (error.code === "DRIVE_STORAGE_QUOTA") {
      return {
        kind: "storage_quota",
        code: "DRIVE_UPLOAD_FAILED",
        message: messageForMasterUploadFailure("storage_quota", {
          underlyingMessage: error.safeMessage,
        }),
        httpStatus: error.httpStatus,
        googleReason: error.googleReason,
        causeDetail: error.causeDetail,
      };
    }
    if (error.code === "DRIVE_UPLOAD_REJECTED") {
      return {
        kind: "drive_rejected",
        code: "DRIVE_UPLOAD_FAILED",
        message: messageForMasterUploadFailure("drive_rejected", {
          folderCreated: true,
          underlyingMessage: error.safeMessage,
        }),
        httpStatus: error.httpStatus,
        googleReason: error.googleReason,
        causeDetail: error.causeDetail,
      };
    }
    if (error.code === "QUOTA_OR_TRANSIENT") {
      return {
        kind: "drive_rejected",
        code: "GOOGLE_TRANSIENT",
        message: error.safeMessage,
        httpStatus: error.httpStatus,
        googleReason: error.googleReason,
        causeDetail: error.causeDetail,
      };
    }
    if (
      error.message.includes("returned no ID") ||
      error.safeMessage.includes("returned no ID") ||
      error.message.includes("did not return file metadata") ||
      error.safeMessage.includes("did not return file metadata")
    ) {
      return {
        kind: "missing_metadata",
        code: "DRIVE_UPLOAD_FAILED",
        message: messageForMasterUploadFailure("missing_metadata"),
        httpStatus: error.httpStatus,
        googleReason: error.googleReason,
        causeDetail: error.causeDetail,
      };
    }
    return {
      kind: "unknown",
      code: "DRIVE_UPLOAD_FAILED",
      message: messageForMasterUploadFailure("unknown", {
        folderCreated: true,
        underlyingMessage: error.safeMessage,
      }),
      httpStatus: error.httpStatus,
      googleReason: error.googleReason,
      causeDetail: error.causeDetail,
    };
  }

  if (error && typeof error === "object" && "code" in error) {
    const nodeCode = String((error as { code: string }).code);
    if (nodeCode === "ENOENT" || nodeCode === "EACCES") {
      return {
        kind: "temp_missing",
        code: "MISSING_FILE",
        message: messageForMasterUploadFailure("temp_missing"),
      };
    }
  }

  if (error instanceof Error) {
    const lower = error.message.toLowerCase();
    if (
      lower.includes("enoent") ||
      lower.includes("no such file") ||
      lower.includes("eacces")
    ) {
      return {
        kind: "temp_missing",
        code: "MISSING_FILE",
        message: messageForMasterUploadFailure("temp_missing"),
      };
    }
    if (
      lower.includes("stream") ||
      lower.includes("epipe") ||
      lower.includes("read econnreset")
    ) {
      return {
        kind: "stream_failed",
        code: "DRIVE_UPLOAD_FAILED",
        message: messageForMasterUploadFailure("stream_failed"),
      };
    }
  }

  return {
    kind: "unknown",
    code: "DRIVE_UPLOAD_FAILED",
    message: messageForMasterUploadFailure("unknown", { folderCreated: true }),
  };
}

export function failureProgress(params: {
  lastCompletedStage: ArtworkSubmissionStage;
  failedOperation: SubmissionFailedOperation;
}): {
  stage: ArtworkSubmissionStage;
  lastCompletedStage: ArtworkSubmissionStage;
  failedOperation: SubmissionFailedOperation;
} {
  return {
    // `stage` mirrors last completed work — never a past-tense success for the failed op.
    stage: params.lastCompletedStage,
    lastCompletedStage: params.lastCompletedStage,
    failedOperation: params.failedOperation,
  };
}

export async function assertTempFileReadable(path: string): Promise<void> {
  try {
    await access(path);
  } catch (error) {
    const wrapped = new Error(
      "The original image could not be read from temporary storage.",
    );
    (wrapped as { code?: string }).code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: string }).code)
        : "ENOENT";
    throw wrapped;
  }
}
