export type GoogleErrorCode =
  | "MISSING_GOOGLE_ENV"
  | "MALFORMED_PRIVATE_KEY"
  | "AUTH_FAILURE"
  | "SHEET_ACCESS_DENIED"
  | "SHEET_NOT_FOUND"
  | "DRIVE_ACCESS_DENIED"
  | "DRIVE_NOT_FOUND"
  | "DRIVE_NOT_A_FOLDER"
  | "DRIVE_STORAGE_QUOTA"
  | "DRIVE_UPLOAD_REJECTED"
  | "SHEET_TAB_MISSING"
  | "HEADER_REFUSED"
  | "QUOTA_OR_TRANSIENT"
  | "UNKNOWN";

export class GoogleIntegrationError extends Error {
  readonly code: GoogleErrorCode;
  readonly safeMessage: string;
  readonly causeDetail?: string;
  readonly httpStatus?: number;
  readonly googleReason?: string;

  constructor(options: {
    code: GoogleErrorCode;
    message: string;
    causeDetail?: string;
    httpStatus?: number;
    googleReason?: string;
  }) {
    super(options.message);
    this.name = "GoogleIntegrationError";
    this.code = options.code;
    this.safeMessage = options.message;
    this.causeDetail = options.causeDetail;
    this.httpStatus = options.httpStatus;
    this.googleReason = options.googleReason;
  }

  toClientJSON() {
    return {
      ok: false as const,
      code: this.code,
      message: this.safeMessage,
    };
  }
}

export function statusFromUnknown(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const maybe = error as {
    code?: number | string;
    response?: { status?: number };
    status?: number;
  };
  if (typeof maybe.code === "number") return maybe.code;
  if (typeof maybe.status === "number") return maybe.status;
  if (typeof maybe.response?.status === "number") return maybe.response.status;
  if (typeof maybe.code === "string" && /^\d+$/.test(maybe.code)) {
    return Number(maybe.code);
  }
  return undefined;
}

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

type GoogleErrorEntry = { reason?: string; message?: string };

/**
 * Extract Google API `errors[].reason` when present (Gaxios / googleapis shape).
 */
export function googleReasonFromUnknown(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const maybe = error as {
    errors?: GoogleErrorEntry[];
    response?: { data?: { error?: { errors?: GoogleErrorEntry[]; status?: string } } };
    cause?: unknown;
  };

  const fromList = (list: GoogleErrorEntry[] | undefined) => {
    const reason = list?.find((entry) => entry?.reason)?.reason;
    return typeof reason === "string" && reason.trim() ? reason.trim() : undefined;
  };

  return (
    fromList(maybe.errors) ||
    fromList(maybe.response?.data?.error?.errors) ||
    (typeof maybe.response?.data?.error?.status === "string"
      ? maybe.response.data.error.status
      : undefined) ||
    (maybe.cause ? googleReasonFromUnknown(maybe.cause) : undefined)
  );
}

function sanitizeDetail(rawMessage: string): string {
  return rawMessage
    .replace(/-----BEGIN[\s\S]*?-----END[^-]*-----/g, "[redacted-pem]")
    .replace(/private[_-]?key/gi, "[redacted]")
    .slice(0, 240);
}

const PERMISSION_REASONS = new Set([
  "insufficientFilePermissions",
  "insufficientPermissions",
  "forbidden",
  "fileNotWritable",
  "appNotAuthorizedToFile",
  "notFound", // sometimes returned as 403 for inaccessible resources
]);

const STORAGE_QUOTA_REASONS = new Set([
  "storageQuotaExceeded",
  "quotaExceeded",
]);

/**
 * Map unknown Google API / auth failures to safe, user-facing errors.
 * Never include credentials, tokens, or private keys.
 *
 * Drive 403s are classified by Google `reason` when available — do not assume
 * every 403 means the folder was never shared with the service account.
 */
export function mapGoogleApiError(
  error: unknown,
  context: "auth" | "sheets" | "drive",
): GoogleIntegrationError {
  if (error instanceof GoogleIntegrationError) {
    return error;
  }

  const status = statusFromUnknown(error);
  const googleReason = googleReasonFromUnknown(error);
  const rawMessage = messageFromUnknown(error);
  const lower = rawMessage.toLowerCase();
  const reasonLower = (googleReason ?? "").toLowerCase();

  const safeDetailParts = [
    status != null ? `status=${status}` : null,
    googleReason ? `reason=${googleReason}` : null,
    sanitizeDetail(rawMessage),
  ].filter(Boolean);
  const safeDetail = safeDetailParts.join("; ").slice(0, 320);

  if (
    lower.includes("invalid_grant") ||
    lower.includes("invalid jwt") ||
    lower.includes("error:0909006c") ||
    lower.includes("dek-info") ||
    lower.includes("unsupported")
  ) {
    return new GoogleIntegrationError({
      code: "AUTH_FAILURE",
      message:
        "Google authentication failed. Check the service-account email and private key formatting.",
      causeDetail: safeDetail,
      httpStatus: status,
      googleReason,
    });
  }

  if (status === 429 || status === 503 || status === 500) {
    return new GoogleIntegrationError({
      code: "QUOTA_OR_TRANSIENT",
      message:
        "Google API returned a transient or quota error. Wait a moment and try again.",
      causeDetail: safeDetail,
      httpStatus: status,
      googleReason,
    });
  }

  if (context === "sheets") {
    if (status === 404) {
      return new GoogleIntegrationError({
        code: "SHEET_NOT_FOUND",
        message:
          "Spreadsheet not found or inaccessible. Confirm GOOGLE_SHEET_ID and sharing.",
        causeDetail: safeDetail,
        httpStatus: status,
        googleReason,
      });
    }
    if (status === 403) {
      return new GoogleIntegrationError({
        code: "SHEET_ACCESS_DENIED",
        message:
          "Service account cannot access the spreadsheet. Share the Sheet with the service-account email.",
        causeDetail: safeDetail,
        httpStatus: status,
        googleReason,
      });
    }
  }

  if (context === "drive") {
    if (status === 404) {
      return new GoogleIntegrationError({
        code: "DRIVE_NOT_FOUND",
        message:
          "Drive folder not found or inaccessible. Confirm GOOGLE_DRIVE_ROOT_FOLDER_ID and sharing.",
        causeDetail: safeDetail,
        httpStatus: status,
        googleReason,
      });
    }
    if (status === 403) {
      if (
        STORAGE_QUOTA_REASONS.has(googleReason ?? "") ||
        reasonLower.includes("storagequota") ||
        lower.includes("storage quota")
      ) {
        return new GoogleIntegrationError({
          code: "DRIVE_STORAGE_QUOTA",
          message:
            "Google Drive rejected the upload because the service account has no storage quota for this location. Use a Shared Drive as the archive root (service accounts cannot store file content in a personal My Drive folder).",
          causeDetail: safeDetail,
          httpStatus: status,
          googleReason: googleReason ?? "storageQuotaExceeded",
        });
      }

      if (
        PERMISSION_REASONS.has(googleReason ?? "") ||
        lower.includes("the user does not have sufficient permissions") ||
        lower.includes("insufficient permissions") ||
        lower.includes("insufficient file permissions")
      ) {
        return new GoogleIntegrationError({
          code: "DRIVE_ACCESS_DENIED",
          message:
            "Service account cannot access the Drive folder. Share the folder with the service-account email (Editor).",
          causeDetail: safeDetail,
          httpStatus: status,
          googleReason,
        });
      }

      // Confirmed 403, but not a known sharing/permission reason.
      return new GoogleIntegrationError({
        code: "DRIVE_UPLOAD_REJECTED",
        message: "Google Drive rejected the upload request.",
        causeDetail: safeDetail,
        httpStatus: status,
        googleReason,
      });
    }
  }

  if (context === "auth" || status === 401) {
    return new GoogleIntegrationError({
      code: "AUTH_FAILURE",
      message: "Google authentication failed.",
      causeDetail: safeDetail,
      httpStatus: status,
      googleReason,
    });
  }

  return new GoogleIntegrationError({
    code: "UNKNOWN",
    message: `Google ${context} request failed.`,
    causeDetail: safeDetail,
    httpStatus: status,
    googleReason,
  });
}
