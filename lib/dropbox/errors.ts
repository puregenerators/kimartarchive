export type DropboxErrorCode =
  | "MISSING_DROPBOX_ENV"
  | "MISSING_REFRESH_TOKEN"
  | "INVALID_STATE"
  | "OAUTH_DENIED"
  | "TOKEN_EXCHANGE_FAILED"
  | "TOKEN_REFRESH_FAILED"
  | "ACCOUNT_LOOKUP_FAILED"
  | "NOT_CONNECTED"
  | "API_ERROR"
  | "PATH_ERROR"
  | "UNKNOWN";

export class DropboxIntegrationError extends Error {
  readonly code: DropboxErrorCode;
  readonly safeMessage: string;
  readonly httpStatus?: number;

  constructor(options: {
    code: DropboxErrorCode;
    message: string;
    httpStatus?: number;
  }) {
    super(options.message);
    this.name = "DropboxIntegrationError";
    this.code = options.code;
    this.safeMessage = options.message;
    this.httpStatus = options.httpStatus;
  }

  toClientJSON() {
    return {
      ok: false as const,
      code: this.code,
      message: this.safeMessage,
    };
  }
}

/** Strip anything that looks like a bearer/refresh token from error text. */
export function sanitizeDropboxErrorText(raw: string): string {
  return raw
    .replace(/sl\.[A-Za-z0-9_-]+/g, "[redacted-token]")
    .replace(/[A-Za-z0-9_-]{40,}/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/refresh[_-]?token["']?\s*[:=]\s*["']?[^"',}\s]+/gi, "refresh_token=[redacted]")
    .replace(/access[_-]?token["']?\s*[:=]\s*["']?[^"',}\s]+/gi, "access_token=[redacted]")
    .slice(0, 240);
}

export function mapDropboxApiError(
  error: unknown,
  context: "oauth" | "refresh" | "api" | "account",
): DropboxIntegrationError {
  if (error instanceof DropboxIntegrationError) {
    return error;
  }

  const status =
    error && typeof error === "object" && "status" in error
      ? Number((error as { status?: number }).status)
      : undefined;

  const rawMessage =
    error instanceof Error ? error.message : String(error ?? "Unknown error");
  const safe = sanitizeDropboxErrorText(rawMessage);
  const lower = rawMessage.toLowerCase();

  if (
    context === "refresh" ||
    lower.includes("invalid_grant") ||
    lower.includes("expired_access_token")
  ) {
    if (lower.includes("invalid_grant") || status === 400 || status === 401) {
      return new DropboxIntegrationError({
        code: "TOKEN_REFRESH_FAILED",
        message:
          "Dropbox refresh token was rejected. Reconnect Dropbox from Archive Setup.",
        httpStatus: status,
      });
    }
  }

  if (context === "oauth") {
    return new DropboxIntegrationError({
      code: "TOKEN_EXCHANGE_FAILED",
      message: "Dropbox authorization code exchange failed.",
      httpStatus: status,
    });
  }

  if (context === "account") {
    return new DropboxIntegrationError({
      code: "ACCOUNT_LOOKUP_FAILED",
      message: "Could not load the Dropbox account profile.",
      httpStatus: status,
    });
  }

  if (status === 401) {
    if (lower.includes("missing_scope")) {
      return new DropboxIntegrationError({
        code: "API_ERROR",
        message:
          "Dropbox permission scope is missing. Enable sharing scopes in the Dropbox app and Reconnect from Archive Setup.",
        httpStatus: status,
      });
    }
    return new DropboxIntegrationError({
      code: "TOKEN_REFRESH_FAILED",
      message: "Dropbox access was denied. Try reconnecting.",
      httpStatus: status,
    });
  }

  if (lower.includes("missing_scope")) {
    return new DropboxIntegrationError({
      code: "API_ERROR",
      message:
        "Dropbox permission scope is missing. Enable sharing scopes in the Dropbox app and Reconnect from Archive Setup.",
      httpStatus: status,
    });
  }

  return new DropboxIntegrationError({
    code: "API_ERROR",
    message: `Dropbox ${context} request failed. ${safe}`,
    httpStatus: status,
  });
}
