import "server-only";

import { createDriveClient } from "@/lib/google/auth";
import { validateGoogleDriveStorageEnv } from "@/lib/google/env";
import {
  buildChildFolderQuery,
  escapeDriveQueryValue,
  FAILED_INTAKE_FOLDER_NAME,
} from "@/lib/google/drive-query";
import { GoogleIntegrationError, mapGoogleApiError } from "@/lib/google/errors";
import { decideFailedIntakeCreation } from "@/lib/google/setup-logic";

const FOLDER_MIME = "application/vnd.google-apps.folder";

function defaultDriveRootFolderId(): string {
  return validateGoogleDriveStorageEnv().driveRootFolderId;
}

export type DriveFileCapabilities = {
  canEdit: boolean | null;
  canAddChildren: boolean | null;
};

export type DriveFolderMetadata = {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  webViewLink?: string;
  capabilities: DriveFileCapabilities;
};

export type DriveChildFolder = {
  id: string;
  name: string;
};

function readCapabilities(
  capabilities: { canEdit?: boolean | null; canAddChildren?: boolean | null } | null | undefined,
): DriveFileCapabilities {
  return {
    canEdit:
      typeof capabilities?.canEdit === "boolean" ? capabilities.canEdit : null,
    canAddChildren:
      typeof capabilities?.canAddChildren === "boolean"
        ? capabilities.canAddChildren
        : null,
  };
}

/**
 * Read effective capabilities for a Drive file or folder (including Sheets files).
 * Uses a metadata GET only — never writes.
 */
export async function getDriveFileCapabilities(
  fileId: string,
): Promise<DriveFileCapabilities> {
  const drive = createDriveClient();
  try {
    const response = await drive.files.get({
      fileId,
      fields: "id,capabilities(canEdit,canAddChildren)",
      supportsAllDrives: true,
    });
    return readCapabilities(response.data.capabilities);
  } catch (error) {
    throw mapGoogleApiError(error, "drive");
  }
}

export async function getDriveFolderMetadata(
  folderId = defaultDriveRootFolderId(),
): Promise<DriveFolderMetadata> {
  const drive = createDriveClient();
  try {
    const response = await drive.files.get({
      fileId: folderId,
      fields: "id,name,mimeType,webViewLink,capabilities(canEdit,canAddChildren)",
      supportsAllDrives: true,
    });

    const mimeType = response.data.mimeType ?? "";
    const isFolder = mimeType === FOLDER_MIME;

    return {
      id: response.data.id ?? folderId,
      name: response.data.name ?? "(unnamed)",
      mimeType,
      isFolder,
      webViewLink: response.data.webViewLink ?? undefined,
      capabilities: readCapabilities(response.data.capabilities),
    };
  } catch (error) {
    throw mapGoogleApiError(error, "drive");
  }
}

export async function verifyDriveRootFolderAccess(
  folderId = defaultDriveRootFolderId(),
): Promise<DriveFolderMetadata> {
  const meta = await getDriveFolderMetadata(folderId);
  if (!meta.isFolder) {
    throw new GoogleIntegrationError({
      code: "DRIVE_NOT_A_FOLDER",
      message:
        "GOOGLE_DRIVE_ROOT_FOLDER_ID points to a file, not a folder. Use the archive root folder ID.",
      causeDetail: `mimeType=${meta.mimeType}`,
    });
  }
  return meta;
}

export async function listImmediateChildFolders(
  parentId = defaultDriveRootFolderId(),
): Promise<DriveChildFolder[]> {
  const drive = createDriveClient();
  const safeParent = escapeDriveQueryValue(parentId);
  const q = [
    `'${safeParent}' in parents`,
    `mimeType = '${FOLDER_MIME}'`,
    `trashed = false`,
  ].join(" and ");

  try {
    const response = await drive.files.list({
      q,
      fields: "files(id,name)",
      pageSize: 100,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      spaces: "drive",
    });

    return (
      response.data.files?.map((file) => ({
        id: file.id ?? "",
        name: file.name ?? "",
      })) ?? []
    ).filter((folder) => folder.id && folder.name);
  } catch (error) {
    throw mapGoogleApiError(error, "drive");
  }
}

export async function findChildFolderByName(
  parentId: string,
  name: string,
): Promise<DriveChildFolder | null> {
  const drive = createDriveClient();
  const q = buildChildFolderQuery(parentId, name);

  try {
    const response = await drive.files.list({
      q,
      fields: "files(id,name)",
      pageSize: 10,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      spaces: "drive",
    });

    const match = response.data.files?.[0];
    if (!match?.id || !match.name) return null;
    return { id: match.id, name: match.name };
  } catch (error) {
    throw mapGoogleApiError(error, "drive");
  }
}

export async function failedIntakeFolderExists(
  parentId = defaultDriveRootFolderId(),
): Promise<boolean> {
  const found = await findChildFolderByName(parentId, FAILED_INTAKE_FOLDER_NAME);
  return Boolean(found);
}

export type CreateFailedIntakeResult =
  | {
      ok: true;
      action: "created" | "already_exists";
      folderId: string;
      folderName: string;
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

export type UploadedDriveFile = {
  id: string;
  name: string;
  webViewLink: string;
  mimeType?: string;
};

/** Browser URL for a Drive file or folder (never makes the file public). */
export function driveBrowserUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

export function driveFolderBrowserUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`;
}

/**
 * Create an artwork folder as a direct child of parentId.
 * Caller must check for name conflicts first.
 */
export async function createArtworkFolder(params: {
  parentId: string;
  name: string;
}): Promise<UploadedDriveFile> {
  const drive = createDriveClient();
  try {
    const response = await drive.files.create({
      requestBody: {
        name: params.name,
        mimeType: FOLDER_MIME,
        parents: [params.parentId],
      },
      fields: "id,name,webViewLink,mimeType",
      supportsAllDrives: true,
    });

    if (!response.data.id) {
      throw new GoogleIntegrationError({
        code: "UNKNOWN",
        message: "Drive folder create returned no ID.",
      });
    }

    return {
      id: response.data.id,
      name: response.data.name ?? params.name,
      webViewLink:
        response.data.webViewLink ?? driveFolderBrowserUrl(response.data.id),
      mimeType: response.data.mimeType ?? FOLDER_MIME,
    };
  } catch (error) {
    throw mapGoogleApiError(error, "drive");
  }
}

/**
 * Upload a file (buffer or readable stream) into a Drive folder.
 * Does not alter permissions or make the file public.
 */
export async function uploadDriveFile(params: {
  parentId: string;
  name: string;
  mimeType: string;
  body: NodeJS.ReadableStream | Buffer;
}): Promise<UploadedDriveFile> {
  const drive = createDriveClient();
  try {
    const response = await drive.files.create({
      requestBody: {
        name: params.name,
        parents: [params.parentId],
      },
      media: {
        mimeType: params.mimeType,
        body: params.body,
      },
      fields: "id,name,webViewLink,mimeType",
      supportsAllDrives: true,
    });

    if (!response.data.id) {
      throw new GoogleIntegrationError({
        code: "UNKNOWN",
        message: "The upload completed but Drive did not return file metadata.",
        causeDetail: "files.create response missing id",
      });
    }

    return {
      id: response.data.id,
      name: response.data.name ?? params.name,
      webViewLink:
        response.data.webViewLink ?? driveBrowserUrl(response.data.id),
      mimeType: response.data.mimeType ?? params.mimeType,
    };
  } catch (error) {
    if (error instanceof GoogleIntegrationError) throw error;
    throw mapGoogleApiError(error, "drive");
  }
}

export async function getUploadedFileMetadata(
  fileId: string,
): Promise<UploadedDriveFile> {
  const drive = createDriveClient();
  try {
    const response = await drive.files.get({
      fileId,
      fields: "id,name,webViewLink,mimeType",
      supportsAllDrives: true,
    });

    if (!response.data.id) {
      throw new GoogleIntegrationError({
        code: "DRIVE_NOT_FOUND",
        message: "Uploaded Drive file metadata could not be read.",
      });
    }

    const isFolder = response.data.mimeType === FOLDER_MIME;
    return {
      id: response.data.id,
      name: response.data.name ?? "",
      webViewLink:
        response.data.webViewLink ??
        (isFolder
          ? driveFolderBrowserUrl(response.data.id)
          : driveBrowserUrl(response.data.id)),
      mimeType: response.data.mimeType ?? undefined,
    };
  } catch (error) {
    throw mapGoogleApiError(error, "drive");
  }
}

/**
 * Move a folder into Failed Intake (best-effort compensation).
 * Uses exact parent IDs. Does not delete files.
 */
export async function moveFolderToFailedIntake(params: {
  folderId: string;
  currentParentId: string;
  archiveRootId: string;
}): Promise<{ failedIntakeFolderId: string }> {
  const failedIntake = await findChildFolderByName(
    params.archiveRootId,
    FAILED_INTAKE_FOLDER_NAME,
  );
  if (!failedIntake) {
    throw new GoogleIntegrationError({
      code: "DRIVE_NOT_FOUND",
      message: `“${FAILED_INTAKE_FOLDER_NAME}” folder was not found under the archive root.`,
    });
  }

  const drive = createDriveClient();
  try {
    await drive.files.update({
      fileId: params.folderId,
      addParents: failedIntake.id,
      removeParents: params.currentParentId,
      fields: "id,parents",
      supportsAllDrives: true,
    });
    return { failedIntakeFolderId: failedIntake.id };
  } catch (error) {
    throw mapGoogleApiError(error, "drive");
  }
}

/**
 * Create the Failed Intake child folder only when missing.
 * Idempotent if it already exists. Does not alter permissions or make public.
 */
export async function createFailedIntakeFolder(
  parentId = defaultDriveRootFolderId(),
): Promise<CreateFailedIntakeResult> {
  await verifyDriveRootFolderAccess(parentId);

  const existing = await findChildFolderByName(
    parentId,
    FAILED_INTAKE_FOLDER_NAME,
  );
  const decision = decideFailedIntakeCreation(Boolean(existing));

  if (decision.action === "noop" && existing) {
    return {
      ok: true,
      action: "already_exists",
      folderId: existing.id,
      folderName: existing.name,
    };
  }

  const drive = createDriveClient();
  try {
    // Re-check just before create
    const again = await findChildFolderByName(
      parentId,
      FAILED_INTAKE_FOLDER_NAME,
    );
    if (again) {
      return {
        ok: true,
        action: "already_exists",
        folderId: again.id,
        folderName: again.name,
      };
    }

    const response = await drive.files.create({
      requestBody: {
        name: FAILED_INTAKE_FOLDER_NAME,
        mimeType: FOLDER_MIME,
        parents: [parentId],
      },
      fields: "id,name",
      supportsAllDrives: true,
    });

    if (!response.data.id) {
      return {
        ok: false,
        code: "UNKNOWN",
        message: "Drive folder create returned no ID.",
      };
    }

    return {
      ok: true,
      action: "created",
      folderId: response.data.id,
      folderName: response.data.name ?? FAILED_INTAKE_FOLDER_NAME,
    };
  } catch (error) {
    throw mapGoogleApiError(error, "drive");
  }
}
