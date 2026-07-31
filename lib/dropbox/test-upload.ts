import {
  DropboxIntegrationError,
  mapDropboxApiError,
} from "@/lib/dropbox/errors";
import type { DropboxFilesOps } from "@/lib/dropbox/files-ops";
import {
  DROPBOX_INTEGRATION_TEST_CONTENTS,
  DROPBOX_INTEGRATION_TEST_FILE_PATH,
  DROPBOX_INTEGRATION_TEST_FILENAME,
  DROPBOX_INTEGRATION_TEST_FOLDER,
} from "@/lib/dropbox/types";

export type FetchLike = typeof fetch;

export type DropboxUploadTestStep =
  | "create_folder"
  | "upload"
  | "verify_metadata"
  | "create_shared_link"
  | "download"
  | "delete_file"
  | "delete_folder";

export type DropboxUploadTestSuccess = {
  success: true;
  folderCreated: true;
  uploadSucceeded: true;
  metadataVerified: true;
  sharedLinkCreated: true;
  downloadVerified: true;
  fileDeleted: true;
  folderDeleted: true;
  metadata: {
    filename: string;
    size: number;
    path: string;
    id: string;
  };
  sharedLink: string;
};

export type DropboxUploadTestFailure = {
  success: false;
  completedStep: DropboxUploadTestStep | null;
  failedOperation: DropboxUploadTestStep;
  error: {
    code: string;
    message: string;
  };
  message: string;
  folderCreated: boolean;
  uploadSucceeded: boolean;
  metadataVerified: boolean;
  sharedLinkCreated: boolean;
  downloadVerified: boolean;
  fileDeleted: boolean;
  folderDeleted: boolean;
};

export type DropboxUploadTestResult =
  | DropboxUploadTestSuccess
  | DropboxUploadTestFailure;

const STEP_LABELS: Record<DropboxUploadTestStep, string> = {
  create_folder: "create folder",
  upload: "upload file",
  verify_metadata: "verify metadata",
  create_shared_link: "create shared link",
  download: "download file",
  delete_file: "delete file",
  delete_folder: "delete folder",
};

function toFailure(
  failedOperation: DropboxUploadTestStep,
  completedStep: DropboxUploadTestStep | null,
  error: unknown,
  flags: {
    folderCreated: boolean;
    uploadSucceeded: boolean;
    metadataVerified: boolean;
    sharedLinkCreated: boolean;
    downloadVerified: boolean;
    fileDeleted: boolean;
    folderDeleted: boolean;
  },
): DropboxUploadTestFailure {
  const mapped =
    error instanceof DropboxIntegrationError
      ? error
      : mapDropboxApiError(error, "api");

  return {
    success: false,
    completedStep,
    failedOperation,
    error: {
      code: mapped.code,
      message: mapped.safeMessage,
    },
    message: `Dropbox upload test failed while trying to ${STEP_LABELS[failedOperation]}. ${mapped.safeMessage}`,
    ...flags,
  };
}

async function verifySharedLinkWorks(
  url: string,
  fetchImpl: FetchLike,
): Promise<void> {
  if (!url || !/^https:\/\//i.test(url)) {
    throw new DropboxIntegrationError({
      code: "API_ERROR",
      message: "Dropbox did not return a usable shared link URL.",
    });
  }

  const response = await fetchImpl(url, {
    method: "GET",
    redirect: "follow",
  });

  if (!response.ok) {
    throw new DropboxIntegrationError({
      code: "API_ERROR",
      message: `Shared link did not respond successfully (HTTP ${response.status}).`,
      httpStatus: response.status,
    });
  }
}

/**
 * Best-effort cleanup so a failed test does not leave Integration Test artifacts.
 * Never touches any path outside the Integration Test folder.
 */
async function cleanupIntegrationTestArtifacts(
  ops: DropboxFilesOps,
): Promise<void> {
  try {
    if (await ops.pathExists(DROPBOX_INTEGRATION_TEST_FILE_PATH)) {
      await ops.deleteFile(DROPBOX_INTEGRATION_TEST_FILE_PATH);
    }
  } catch {
    // ignore cleanup failures
  }
  try {
    if (await ops.pathExists(DROPBOX_INTEGRATION_TEST_FOLDER)) {
      await ops.deleteFolder(DROPBOX_INTEGRATION_TEST_FOLDER);
    }
  } catch {
    // ignore cleanup failures
  }
}

/**
 * Standalone Dropbox upload integration test (injectable ops — no live API).
 * Touches only `/Integration Test` inside the App Folder when using real ops.
 */
export async function runDropboxUploadTest(options: {
  ops: DropboxFilesOps;
  fetchImpl?: FetchLike;
}): Promise<DropboxUploadTestResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const { ops } = options;

  let folderCreated = false;
  let uploadSucceeded = false;
  let metadataVerified = false;
  let sharedLinkCreated = false;
  let downloadVerified = false;
  let fileDeleted = false;
  let folderDeleted = false;
  let completedStep: DropboxUploadTestStep | null = null;

  const flags = () => ({
    folderCreated,
    uploadSucceeded,
    metadataVerified,
    sharedLinkCreated,
    downloadVerified,
    fileDeleted,
    folderDeleted,
  });

  const fail = async (
    failedOperation: DropboxUploadTestStep,
    error: unknown,
  ): Promise<DropboxUploadTestFailure> => {
    if (folderCreated && !folderDeleted) {
      await cleanupIntegrationTestArtifacts(ops);
    }
    return toFailure(failedOperation, completedStep, error, flags());
  };

  // Step 1 — create temporary folder (delete first if it already exists)
  try {
    if (await ops.pathExists(DROPBOX_INTEGRATION_TEST_FOLDER)) {
      await ops.deleteFolder(DROPBOX_INTEGRATION_TEST_FOLDER);
    }
    await ops.createFolder(DROPBOX_INTEGRATION_TEST_FOLDER);
    folderCreated = true;
    completedStep = "create_folder";
  } catch (error) {
    return fail("create_folder", error);
  }

  // Step 2 + 3 — in-memory buffer upload
  const contents = Buffer.from(DROPBOX_INTEGRATION_TEST_CONTENTS, "utf8");
  try {
    await ops.uploadBuffer(DROPBOX_INTEGRATION_TEST_FILE_PATH, contents);
    uploadSucceeded = true;
    completedStep = "upload";
  } catch (error) {
    return fail("upload", error);
  }

  // Step 4 — metadata verification
  let metadata: DropboxUploadTestSuccess["metadata"];
  try {
    const meta = await ops.getMetadata(DROPBOX_INTEGRATION_TEST_FILE_PATH);
    if (
      meta.name !== DROPBOX_INTEGRATION_TEST_FILENAME ||
      meta.size !== contents.byteLength ||
      !meta.id ||
      !(
        meta.pathDisplay === DROPBOX_INTEGRATION_TEST_FILE_PATH ||
        meta.pathLower === DROPBOX_INTEGRATION_TEST_FILE_PATH.toLowerCase()
      )
    ) {
      throw new DropboxIntegrationError({
        code: "API_ERROR",
        message:
          "Uploaded file metadata did not match the expected name, size, path, or id.",
      });
    }
    metadata = {
      filename: meta.name,
      size: meta.size,
      path: meta.pathDisplay || DROPBOX_INTEGRATION_TEST_FILE_PATH,
      id: meta.id,
    };
    metadataVerified = true;
    completedStep = "verify_metadata";
  } catch (error) {
    return fail("verify_metadata", error);
  }

  // Step 5 — shared link
  let sharedLink = "";
  try {
    const link = await ops.createSharedLink(DROPBOX_INTEGRATION_TEST_FILE_PATH);
    await verifySharedLinkWorks(link.url, fetchImpl);
    sharedLink = link.url;
    sharedLinkCreated = true;
    completedStep = "create_shared_link";
  } catch (error) {
    return fail("create_shared_link", error);
  }

  // Step 6 — download + content check
  try {
    const downloaded = await ops.downloadFile(DROPBOX_INTEGRATION_TEST_FILE_PATH);
    const text = downloaded.toString("utf8");
    if (text !== DROPBOX_INTEGRATION_TEST_CONTENTS) {
      throw new DropboxIntegrationError({
        code: "API_ERROR",
        message: "Downloaded file contents did not match the uploaded text.",
      });
    }
    downloadVerified = true;
    completedStep = "download";
  } catch (error) {
    return fail("download", error);
  }

  // Step 7 — delete file
  try {
    await ops.deleteFile(DROPBOX_INTEGRATION_TEST_FILE_PATH);
    if (await ops.pathExists(DROPBOX_INTEGRATION_TEST_FILE_PATH)) {
      throw new DropboxIntegrationError({
        code: "API_ERROR",
        message: "File still existed after delete.",
      });
    }
    fileDeleted = true;
    completedStep = "delete_file";
  } catch (error) {
    return fail("delete_file", error);
  }

  // Step 8 — delete folder
  try {
    await ops.deleteFolder(DROPBOX_INTEGRATION_TEST_FOLDER);
    if (await ops.pathExists(DROPBOX_INTEGRATION_TEST_FOLDER)) {
      throw new DropboxIntegrationError({
        code: "API_ERROR",
        message: "Integration Test folder still existed after delete.",
      });
    }
    folderDeleted = true;
    completedStep = "delete_folder";
  } catch (error) {
    return fail("delete_folder", error);
  }

  return {
    success: true,
    folderCreated: true,
    uploadSucceeded: true,
    metadataVerified: true,
    sharedLinkCreated: true,
    downloadVerified: true,
    fileDeleted: true,
    folderDeleted: true,
    metadata,
    sharedLink,
  };
}
