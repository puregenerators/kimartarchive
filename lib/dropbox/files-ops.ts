import type {
  DropboxFileMetadata,
  DropboxSharedLink,
} from "@/lib/dropbox/types";

/**
 * Reusable Dropbox file operations for the archive.
 * These are the helpers the artwork submission pipeline will call later.
 * Kept free of `server-only` so unit tests can mock this surface.
 */
export type DropboxFilesOps = {
  createFolder: (path: string) => Promise<{ pathDisplay: string }>;
  deleteFolder: (path: string) => Promise<void>;
  uploadBuffer: (
    path: string,
    contents: Buffer | Uint8Array | string,
  ) => Promise<{ pathDisplay: string; id: string; name: string; size: number }>;
  downloadFile: (path: string) => Promise<Buffer>;
  getMetadata: (path: string) => Promise<DropboxFileMetadata>;
  createSharedLink: (path: string) => Promise<DropboxSharedLink>;
  deleteFile: (path: string) => Promise<void>;
  /** Move a file or folder (e.g. artwork folder → Failed Intake). */
  movePath: (
    fromPath: string,
    toPath: string,
  ) => Promise<{ pathDisplay: string }>;
  /** True when path exists (false on path/not_found). */
  pathExists: (path: string) => Promise<boolean>;
};
