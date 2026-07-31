import "server-only";

import { getDropboxFilesOps } from "@/lib/dropbox/files";
import { createDropboxStorageProvider as createDropboxStorageProviderWithOps } from "@/lib/storage/dropbox-provider-logic";
import type { StorageProvider } from "@/lib/storage/types";

export { createDropboxStorageProvider as createDropboxStorageProviderWithOps } from "@/lib/storage/dropbox-provider-logic";

/** Default Dropbox provider using the authenticated Dropbox client. */
export function createDropboxStorageProvider(): StorageProvider {
  return createDropboxStorageProviderWithOps(getDropboxFilesOps);
}
