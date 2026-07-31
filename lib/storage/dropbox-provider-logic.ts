import { DropboxIntegrationError } from "@/lib/dropbox/errors";
import type { DropboxFilesOps } from "@/lib/dropbox/files-ops";
import {
  DROPBOX_ARCHIVE_ROOT_DISPLAY,
  DROPBOX_ARCHIVE_ROOT_WEB_URL,
  DROPBOX_FAILED_INTAKE_PATH,
} from "@/lib/dropbox/types";
import { FAILED_INTAKE_FOLDER_NAME } from "@/lib/google/drive-query";
import {
  isTransientStorageError,
  withTransientRetry,
} from "@/lib/submission/retry";
import type { StorageProvider, StoredResourceRef } from "@/lib/storage/types";

function artworkFolderPath(folderName: string): string {
  return `/${folderName}`;
}

function filePath(folderPath: string, filename: string): string {
  return `${folderPath}/${filename}`;
}

async function ensureFailedIntake(ops: DropboxFilesOps): Promise<void> {
  const exists = await ops.pathExists(DROPBOX_FAILED_INTAKE_PATH);
  if (exists) return;
  await ops.createFolder(DROPBOX_FAILED_INTAKE_PATH);
}

async function sharedUrlForPath(
  ops: DropboxFilesOps,
  path: string,
): Promise<string> {
  const link = await ops.createSharedLink(path);
  if (!link.url) {
    throw new DropboxIntegrationError({
      code: "API_ERROR",
      message: "Dropbox did not return a shared link URL.",
    });
  }
  return link.url;
}

/**
 * Dropbox App Folder storage provider (default for submissions).
 * Layout matches the former Drive archive: flat artwork folders under root,
 * plus a sibling Failed Intake folder.
 *
 * Kept free of `server-only` so unit tests can inject mock DropboxFilesOps.
 */
export function createDropboxStorageProvider(
  opsFactory: () => Promise<DropboxFilesOps>,
): StorageProvider {
  return {
    kind: "dropbox",

    getArchiveRootUrl() {
      return DROPBOX_ARCHIVE_ROOT_WEB_URL;
    },

    async verifyReady() {
      try {
        const ops = await opsFactory();
        await ensureFailedIntake(ops);
        const failedIntakeOk = await ops.pathExists(DROPBOX_FAILED_INTAKE_PATH);
        if (!failedIntakeOk) {
          return {
            ok: false,
            message: `“${FAILED_INTAKE_FOLDER_NAME}” could not be created under the Dropbox App Folder.`,
          };
        }
        return {
          ok: true,
          rootName: DROPBOX_ARCHIVE_ROOT_DISPLAY.replace(/\/$/, ""),
          archiveRootUrl: DROPBOX_ARCHIVE_ROOT_WEB_URL,
        };
      } catch (error) {
        if (error instanceof DropboxIntegrationError) {
          return { ok: false, message: error.safeMessage };
        }
        return {
          ok: false,
          message:
            "Dropbox preflight failed. Connect Dropbox from /setup/archive.",
        };
      }
    },

    async findChildFolderByName(name) {
      const ops = await opsFactory();
      const path = artworkFolderPath(name);
      const exists = await ops.pathExists(path);
      if (!exists) return null;
      return { id: path, name };
    },

    async createArtworkFolder(name) {
      const ops = await opsFactory();
      const path = artworkFolderPath(name);
      await withTransientRetry(() => ops.createFolder(path), {
        isRetryable: isTransientStorageError,
      });
      const webViewLink = await withTransientRetry(
        () => sharedUrlForPath(ops, path),
        { isRetryable: isTransientStorageError },
      );
      return {
        id: path,
        name,
        webViewLink,
      } satisfies StoredResourceRef;
    },

    async uploadFile(params) {
      const ops = await opsFactory();
      const path = filePath(params.parentId, params.name);
      const uploaded = await withTransientRetry(
        () => ops.uploadBuffer(path, params.contents),
        { isRetryable: isTransientStorageError },
      );
      const webViewLink = await withTransientRetry(
        () => sharedUrlForPath(ops, path),
        { isRetryable: isTransientStorageError },
      );
      return {
        id: uploaded.id || path,
        name: uploaded.name || params.name,
        webViewLink,
      };
    },

    async moveFolderToFailedIntake(params) {
      const ops = await opsFactory();
      await ensureFailedIntake(ops);
      const folderName = params.folderId.split("/").filter(Boolean).pop();
      if (!folderName) {
        throw new DropboxIntegrationError({
          code: "PATH_ERROR",
          message: "Cannot move folder to Failed Intake: invalid folder path.",
        });
      }
      const toPath = `${DROPBOX_FAILED_INTAKE_PATH}/${folderName}`;
      await ops.movePath(params.folderId, toPath);
    },
  };
}
