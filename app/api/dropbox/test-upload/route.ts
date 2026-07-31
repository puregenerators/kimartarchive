import { NextResponse } from "next/server";

import { DropboxIntegrationError } from "@/lib/dropbox/errors";
import { getDropboxFilesOps } from "@/lib/dropbox/files";
import { runDropboxUploadTest } from "@/lib/dropbox/test-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Standalone Dropbox upload integration test.
 * Does not touch the artwork submission pipeline.
 */
export async function POST() {
  try {
    const ops = await getDropboxFilesOps();
    const result = await runDropboxUploadTest({ ops });
    return NextResponse.json(result, {
      status: result.success ? 200 : 502,
    });
  } catch (error) {
    if (error instanceof DropboxIntegrationError) {
      return NextResponse.json(
        {
          success: false,
          completedStep: null,
          failedOperation: "create_folder",
          error: {
            code: error.code,
            message: error.safeMessage,
          },
          message: error.safeMessage,
          folderCreated: false,
          uploadSucceeded: false,
          metadataVerified: false,
          sharedLinkCreated: false,
          downloadVerified: false,
          fileDeleted: false,
          folderDeleted: false,
        },
        { status: 502 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        completedStep: null,
        failedOperation: "create_folder",
        error: {
          code: "UNKNOWN",
          message: "Dropbox upload test failed.",
        },
        message: "Dropbox upload test failed.",
        folderCreated: false,
        uploadSucceeded: false,
        metadataVerified: false,
        sharedLinkCreated: false,
        downloadVerified: false,
        fileDeleted: false,
        folderDeleted: false,
      },
      { status: 500 },
    );
  }
}
