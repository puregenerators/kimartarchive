import { DropboxIntegrationError } from "@/lib/dropbox/errors";
import { GoogleIntegrationError } from "@/lib/google/errors";

export type RetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  isRetryable?: (error: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Conservative retries for clearly transient Google API failures only.
 * Do not use for non-idempotent Sheet appends or unchecked Drive creates.
 */
export function isTransientGoogleError(error: unknown): boolean {
  if (error instanceof GoogleIntegrationError) {
    return error.code === "QUOTA_OR_TRANSIENT";
  }
  if (!error || typeof error !== "object") return false;
  const maybe = error as {
    code?: number | string;
    response?: { status?: number };
    status?: number;
  };
  const status =
    typeof maybe.code === "number"
      ? maybe.code
      : typeof maybe.status === "number"
        ? maybe.status
        : typeof maybe.response?.status === "number"
          ? maybe.response.status
          : undefined;
  return status === 429 || status === 500 || status === 503;
}

/** Transient Dropbox HTTP failures eligible for limited retry. */
export function isTransientDropboxError(error: unknown): boolean {
  if (error instanceof DropboxIntegrationError) {
    const status = error.httpStatus;
    return status === 429 || status === 500 || status === 503;
  }
  if (!error || typeof error !== "object") return false;
  const status =
    "httpStatus" in error
      ? Number((error as { httpStatus?: number }).httpStatus)
      : "status" in error
        ? Number((error as { status?: number }).status)
        : undefined;
  return status === 429 || status === 500 || status === 503;
}

/** Transient failures for either storage backend. */
export function isTransientStorageError(error: unknown): boolean {
  return isTransientGoogleError(error) || isTransientDropboxError(error);
}

export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 400;
  const isRetryable = options.isRetryable ?? isTransientStorageError;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetryable(error)) {
        throw error;
      }
      const delay = baseDelayMs * 2 ** (attempt - 1);
      await sleep(delay);
    }
  }
  throw lastError;
}

/** @deprecated Prefer withTransientRetry — kept for existing Google call sites. */
export async function withGoogleRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  return withTransientRetry(fn, {
    ...options,
    isRetryable: options.isRetryable ?? isTransientGoogleError,
  });
}
