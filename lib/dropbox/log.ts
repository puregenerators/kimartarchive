import "server-only";

import { sanitizeDropboxErrorText } from "@/lib/dropbox/errors";

/**
 * Structured Dropbox operation log.
 * Never logs access tokens, refresh tokens, or OAuth credentials.
 */
export function logDropboxOperation(input: {
  operation: string;
  path: string;
  elapsedMs: number;
  error?: { code?: string; message?: string } | null;
}): void {
  const payload = {
    operation: input.operation,
    path: input.path,
    elapsedMs: input.elapsedMs,
    ...(input.error
      ? {
          error: {
            code: input.error.code ?? "UNKNOWN",
            message: sanitizeDropboxErrorText(
              input.error.message ?? "Dropbox operation failed.",
            ),
          },
        }
      : { ok: true }),
  };

  if (input.error) {
    console.error("[dropbox]", payload);
  } else {
    console.info("[dropbox]", payload);
  }
}

export async function timedDropboxOperation<T>(
  operation: string,
  path: string,
  run: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  try {
    const result = await run();
    logDropboxOperation({
      operation,
      path,
      elapsedMs: Date.now() - started,
    });
    return result;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: string }).code ?? "UNKNOWN")
        : "UNKNOWN";
    const message =
      error && typeof error === "object" && "safeMessage" in error
        ? String((error as { safeMessage?: string }).safeMessage)
        : error instanceof Error
          ? error.message
          : "Dropbox operation failed.";
    logDropboxOperation({
      operation,
      path,
      elapsedMs: Date.now() - started,
      error: { code, message },
    });
    throw error;
  }
}
