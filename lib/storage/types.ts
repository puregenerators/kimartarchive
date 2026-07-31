/**
 * File-storage abstraction for the artwork submission pipeline.
 * Google Sheets / inventory claims stay outside this layer.
 */

export type StorageProviderKind = "dropbox" | "drive";

/** Uploaded folder or file reference used by the submission pipeline. */
export type StoredResourceRef = {
  /** Drive file ID, or Dropbox path (e.g. `/2026_KO_1000_Title`). */
  id: string;
  name: string;
  /** Drive webViewLink, or Dropbox shared URL. */
  webViewLink: string;
};

export type StorageChildFolder = {
  id: string;
  name: string;
};

export type StorageVerifyReadyResult =
  | { ok: true; rootName: string; archiveRootUrl: string | null }
  | { ok: false; message: string };

export type StorageProvider = {
  readonly kind: StorageProviderKind;

  /**
   * Confirm the archive root is writable and Failed Intake exists
   * (create Failed Intake when missing for Dropbox).
   */
  verifyReady: () => Promise<StorageVerifyReadyResult>;

  /** Exact-name direct child under the archive root. */
  findChildFolderByName: (
    name: string,
  ) => Promise<StorageChildFolder | null>;

  /** Create artwork folder as a direct child of the archive root. */
  createArtworkFolder: (name: string) => Promise<StoredResourceRef>;

  /** Upload file bytes into an artwork folder. */
  uploadFile: (params: {
    parentId: string;
    name: string;
    mimeType: string;
    contents: Buffer | Uint8Array;
  }) => Promise<StoredResourceRef>;

  /** Best-effort move of an artwork folder into Failed Intake. */
  moveFolderToFailedIntake: (params: {
    folderId: string;
  }) => Promise<void>;

  /** Operator-facing archive root URL (Drive folder or Dropbox web home). */
  getArchiveRootUrl: () => string | null;
};
