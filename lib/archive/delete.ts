import "server-only";

import {
  ARCHIVE_DELETE_FAILED_MESSAGE,
  ARCHIVE_DELETE_TOUCHES_STORED_FILES,
  archiveDeleteFailureLog,
  deleteArtworkArchiveRecordWithDeps,
  type DeleteArtworkRecordResult,
} from "@/lib/archive/delete-logic";
import { GoogleIntegrationError } from "@/lib/google/errors";
import { MissingGoogleEnvError } from "@/lib/google/env";
import {
  deleteArtworkInventorySheetRow,
  readArtworkInventoryTable,
} from "@/lib/google/sheets";
import { resolveArchiveResources } from "@/lib/submission/archive-target";

function logArchiveDeleteFailure(
  payload: ReturnType<typeof archiveDeleteFailureLog>,
): void {
  console.error("[archive]", payload);
}

function causeDetailFromUnknown(error: unknown): string | undefined {
  if (error instanceof GoogleIntegrationError) {
    return error.causeDetail ?? error.googleReason;
  }
  if (error instanceof Error) return error.message;
  return undefined;
}

/**
 * Remove one Artwork Inventory row. Stored image files are left in place.
 */
export async function deleteArtworkArchiveRecord(
  inventoryId: number,
): Promise<DeleteArtworkRecordResult> {
  const resources = resolveArchiveResources();
  if ("code" in resources) {
    logArchiveDeleteFailure(
      archiveDeleteFailureLog({
        inventoryId,
        code: resources.code,
        message: resources.message,
      }),
    );
    return {
      ok: false,
      code: resources.code,
      message: ARCHIVE_DELETE_FAILED_MESSAGE,
      filesDeleted: ARCHIVE_DELETE_TOUCHES_STORED_FILES,
    };
  }

  try {
    const result = await deleteArtworkArchiveRecordWithDeps({
      inventoryId,
      readTable: () => readArtworkInventoryTable(resources.sheetId),
      deleteSheetRow: (sheetRowNumber) =>
        deleteArtworkInventorySheetRow(sheetRowNumber, resources.sheetId),
    });

    if (!result.ok) {
      logArchiveDeleteFailure(
        archiveDeleteFailureLog({
          inventoryId,
          code: result.code,
          message: result.message,
          causeDetail: result.causeDetail,
        }),
      );
    }

    return result;
  } catch (error) {
    if (
      error instanceof GoogleIntegrationError ||
      error instanceof MissingGoogleEnvError
    ) {
      const code =
        error instanceof GoogleIntegrationError
          ? error.code
          : "MISSING_GOOGLE_ENV";
      logArchiveDeleteFailure(
        archiveDeleteFailureLog({
          inventoryId,
          code,
          message: ARCHIVE_DELETE_FAILED_MESSAGE,
          causeDetail: causeDetailFromUnknown(error),
        }),
      );
      return {
        ok: false,
        code,
        message: ARCHIVE_DELETE_FAILED_MESSAGE,
        filesDeleted: ARCHIVE_DELETE_TOUCHES_STORED_FILES,
      };
    }

    logArchiveDeleteFailure(
      archiveDeleteFailureLog({
        inventoryId,
        code: "UNKNOWN",
        message: ARCHIVE_DELETE_FAILED_MESSAGE,
        causeDetail: causeDetailFromUnknown(error),
      }),
    );
    return {
      ok: false,
      code: "UNKNOWN",
      message: ARCHIVE_DELETE_FAILED_MESSAGE,
      filesDeleted: ARCHIVE_DELETE_TOUCHES_STORED_FILES,
    };
  }
}
