import "server-only";

import type { ArchiveResources } from "@/lib/submission/archive-target";
import { createDriveStorageProvider } from "@/lib/storage/drive-provider";
import { createDropboxStorageProvider } from "@/lib/storage/dropbox-provider";
import { getStorageProviderKind } from "@/lib/storage/provider-kind";
import type {
  StorageProvider,
  StorageProviderKind,
} from "@/lib/storage/types";

export type { StorageProvider, StorageProviderKind, StoredResourceRef } from "@/lib/storage/types";
export { createDriveStorageProvider } from "@/lib/storage/drive-provider";
export { createDropboxStorageProvider } from "@/lib/storage/dropbox-provider";
export {
  getStorageProviderKind,
  UnsupportedStorageProviderError,
} from "@/lib/storage/provider-kind";

export function createStorageProvider(
  archive: ArchiveResources,
  kind: StorageProviderKind = getStorageProviderKind(),
): StorageProvider {
  if (kind === "drive") {
    if (!archive.driveRootFolderId) {
      throw new Error(
        "Drive storage requires GOOGLE_DRIVE_ROOT_FOLDER_ID on the archive target.",
      );
    }
    return createDriveStorageProvider(archive.driveRootFolderId);
  }
  return createDropboxStorageProvider();
}
