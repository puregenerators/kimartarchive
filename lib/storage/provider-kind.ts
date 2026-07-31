import type { StorageProviderKind } from "@/lib/storage/types";

export class UnsupportedStorageProviderError extends Error {
  readonly code = "UNSUPPORTED_STORAGE_PROVIDER" as const;
  readonly value: string;

  constructor(value: string) {
    super(
      `Unsupported ARTWORK_STORAGE_PROVIDER "${value}". Use "dropbox" (default) or "drive" (legacy).`,
    );
    this.name = "UnsupportedStorageProviderError";
    this.value = value;
  }
}

/**
 * Active file-storage backend. Defaults to Dropbox when unset.
 * Set ARTWORK_STORAGE_PROVIDER=drive to use the legacy Drive provider.
 * Unsupported values throw — never silently fall back to Drive or Dropbox.
 *
 * Kept free of `server-only` for unit tests.
 */
export function getStorageProviderKind(
  source: NodeJS.ProcessEnv = process.env,
): StorageProviderKind {
  const rawValue = source.ARTWORK_STORAGE_PROVIDER;
  if (rawValue == null || rawValue.trim() === "") {
    return "dropbox";
  }
  const raw = rawValue.trim().toLowerCase();
  if (raw === "dropbox") return "dropbox";
  if (raw === "drive") return "drive";
  throw new UnsupportedStorageProviderError(rawValue.trim());
}
