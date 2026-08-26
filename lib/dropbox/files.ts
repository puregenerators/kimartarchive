import "server-only";

import {
  getDropboxClient,
  type DropboxClient,
  type FetchLike,
} from "@/lib/dropbox/client";
import type { DropboxFilesOps } from "@/lib/dropbox/files-ops";
import { logDropboxOperation, timedDropboxOperation } from "@/lib/dropbox/log";
import type {
  DropboxFileMetadata,
  DropboxSharedLink,
} from "@/lib/dropbox/types";

export type { DropboxFilesOps, DropboxUploadMode } from "@/lib/dropbox/files-ops";

function isNotFoundError(error: unknown): boolean {
  const parts: string[] = [];
  if (error instanceof Error) {
    parts.push(error.message);
  }
  if (error && typeof error === "object") {
    if ("safeMessage" in error) {
      parts.push(String((error as { safeMessage?: string }).safeMessage ?? ""));
    }
    if ("errorTag" in error) {
      parts.push(String((error as { errorTag?: string }).errorTag ?? ""));
    }
    if ("errorSummary" in error) {
      parts.push(String((error as { errorSummary?: string }).errorSummary ?? ""));
    }
  }
  const lower = parts.join(" ").toLowerCase();
  return lower.includes("not_found") || lower.includes("path/not_found");
}

export function createDropboxFilesOps(client: DropboxClient): DropboxFilesOps {
  return {
    createFolder: (path) =>
      timedDropboxOperation("createFolder", path, () =>
        client.createFolder(path),
      ),

    deleteFolder: (path) =>
      timedDropboxOperation("deleteFolder", path, () =>
        client.deleteFolder(path),
      ),

    uploadBuffer: (path, contents, options) =>
      timedDropboxOperation("uploadBuffer", path, () =>
        client.uploadBuffer(path, contents, options),
      ),

    downloadFile: (path) =>
      timedDropboxOperation("downloadFile", path, () =>
        client.downloadFile(path),
      ),

    downloadFileToPath: (path, destPath) =>
      timedDropboxOperation("downloadFileToPath", path, () =>
        client.downloadFileToPath(path, destPath),
      ),

    getMetadata: (path) =>
      timedDropboxOperation("getMetadata", path, () =>
        client.getMetadata(path),
      ),

    createSharedLink: (path) =>
      timedDropboxOperation("createSharedLink", path, () =>
        client.createSharedLink(path),
      ),

    getTemporaryUploadLink: (params) =>
      timedDropboxOperation("getTemporaryUploadLink", params.path, () =>
        client.getTemporaryUploadLink(params),
      ),

    deleteFile: (path) =>
      timedDropboxOperation("deleteFile", path, () => client.deleteFile(path)),

    movePath: (fromPath, toPath) =>
      timedDropboxOperation("movePath", `${fromPath} → ${toPath}`, () =>
        client.movePath(fromPath, toPath),
      ),

    async pathExists(path) {
      const started = Date.now();
      try {
        await client.getMetadata(path);
        logDropboxOperation({
          operation: "pathExists",
          path,
          elapsedMs: Date.now() - started,
        });
        return true;
      } catch (error) {
        if (isNotFoundError(error)) {
          logDropboxOperation({
            operation: "pathExists",
            path,
            elapsedMs: Date.now() - started,
          });
          return false;
        }
        const code =
          error && typeof error === "object" && "code" in error
            ? String((error as { code?: string }).code ?? "UNKNOWN")
            : "UNKNOWN";
        const message =
          error && typeof error === "object" && "safeMessage" in error
            ? String((error as { safeMessage?: string }).safeMessage)
            : error instanceof Error
              ? error.message
              : "Dropbox path check failed.";
        logDropboxOperation({
          operation: "pathExists",
          path,
          elapsedMs: Date.now() - started,
          error: { code, message },
        });
        throw error;
      }
    },
  };
}

export async function getDropboxFilesOps(
  fetchImpl: FetchLike = fetch,
): Promise<DropboxFilesOps> {
  const client = await getDropboxClient(fetchImpl);
  return createDropboxFilesOps(client);
}

/** Convenience wrappers matching the future submission pipeline surface. */
export async function createFolder(
  path: string,
  ops?: DropboxFilesOps,
): Promise<{ pathDisplay: string }> {
  const files = ops ?? (await getDropboxFilesOps());
  return files.createFolder(path);
}

export async function deleteFolder(
  path: string,
  ops?: DropboxFilesOps,
): Promise<void> {
  const files = ops ?? (await getDropboxFilesOps());
  return files.deleteFolder(path);
}

export async function uploadBuffer(
  path: string,
  contents: Buffer | Uint8Array | string,
  ops?: DropboxFilesOps,
): Promise<{ pathDisplay: string; id: string; name: string; size: number }> {
  const files = ops ?? (await getDropboxFilesOps());
  return files.uploadBuffer(path, contents);
}

export async function downloadFile(
  path: string,
  ops?: DropboxFilesOps,
): Promise<Buffer> {
  const files = ops ?? (await getDropboxFilesOps());
  return files.downloadFile(path);
}

export async function getMetadata(
  path: string,
  ops?: DropboxFilesOps,
): Promise<DropboxFileMetadata> {
  const files = ops ?? (await getDropboxFilesOps());
  return files.getMetadata(path);
}

export async function createSharedLink(
  path: string,
  ops?: DropboxFilesOps,
): Promise<DropboxSharedLink> {
  const files = ops ?? (await getDropboxFilesOps());
  return files.createSharedLink(path);
}

export async function deleteFile(
  path: string,
  ops?: DropboxFilesOps,
): Promise<void> {
  const files = ops ?? (await getDropboxFilesOps());
  return files.deleteFile(path);
}

export async function movePath(
  fromPath: string,
  toPath: string,
  ops?: DropboxFilesOps,
): Promise<{ pathDisplay: string }> {
  const files = ops ?? (await getDropboxFilesOps());
  return files.movePath(fromPath, toPath);
}
