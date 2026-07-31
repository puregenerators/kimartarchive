import "server-only";

import {
  createArtworkFolder,
  driveFolderBrowserUrl,
  failedIntakeFolderExists,
  findChildFolderByName,
  moveFolderToFailedIntake,
  uploadDriveFile,
  verifyDriveRootFolderAccess,
} from "@/lib/google/drive";
import { mapCapabilitiesToPermissionLevel } from "@/lib/google/setup-logic";
import { withGoogleRetry } from "@/lib/submission/retry";
import type { StorageProvider, StoredResourceRef } from "@/lib/storage/types";

/**
 * Google Drive storage provider (kept for future migrations / opt-in).
 * Not the default — DropboxStorageProvider is used by the submission pipeline.
 */
export function createDriveStorageProvider(
  driveRootFolderId: string,
): StorageProvider {
  return {
    kind: "drive",

    getArchiveRootUrl() {
      return driveFolderBrowserUrl(driveRootFolderId);
    },

    async verifyReady() {
      try {
        const drive = await verifyDriveRootFolderAccess(driveRootFolderId);
        if (!drive.isFolder) {
          return {
            ok: false,
            message: "Configured Drive root ID points to a file, not a folder.",
          };
        }

        const driveLevel = mapCapabilitiesToPermissionLevel(drive.capabilities);
        if (driveLevel !== "editor") {
          return {
            ok: false,
            message:
              "Service account needs Editor access on the configured Drive archive folder before submission.",
          };
        }

        const failedIntake = await failedIntakeFolderExists(driveRootFolderId);
        if (!failedIntake) {
          return {
            ok: false,
            message:
              "“Failed Intake” folder is missing under the archive root. Create it from /setup/google first.",
          };
        }

        return {
          ok: true,
          rootName: drive.name,
          archiveRootUrl: drive.webViewLink ?? driveFolderBrowserUrl(drive.id),
        };
      } catch (error) {
        const message =
          error &&
          typeof error === "object" &&
          "safeMessage" in error &&
          typeof (error as { safeMessage?: string }).safeMessage === "string"
            ? (error as { safeMessage: string }).safeMessage
            : "Google Drive preflight failed. Check setup diagnostics.";
        return { ok: false, message };
      }
    },

    async findChildFolderByName(name) {
      return findChildFolderByName(driveRootFolderId, name);
    },

    async createArtworkFolder(name) {
      const created = await withGoogleRetry(() =>
        createArtworkFolder({
          parentId: driveRootFolderId,
          name,
        }),
      );
      return {
        id: created.id,
        name: created.name,
        webViewLink: created.webViewLink || driveFolderBrowserUrl(created.id),
      } satisfies StoredResourceRef;
    },

    async uploadFile(params) {
      const uploaded = await withGoogleRetry(() =>
        uploadDriveFile({
          parentId: params.parentId,
          name: params.name,
          mimeType: params.mimeType,
          body: Buffer.from(params.contents),
        }),
      );
      return {
        id: uploaded.id,
        name: uploaded.name,
        webViewLink: uploaded.webViewLink,
      };
    },

    async moveFolderToFailedIntake(params) {
      await moveFolderToFailedIntake({
        folderId: params.folderId,
        currentParentId: driveRootFolderId,
        archiveRootId: driveRootFolderId,
      });
    },
  };
}
