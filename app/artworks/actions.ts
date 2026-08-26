"use server";

import { refresh, revalidatePath } from "next/cache";

import { deleteArtworkArchiveRecord } from "@/lib/archive/delete";
import {
  ARCHIVE_DELETE_FAILED_MESSAGE,
  ARCHIVE_DELETE_INVALID_ID_MESSAGE,
  ARCHIVE_DELETE_TOUCHES_STORED_FILES,
  parseDeleteInventoryId,
} from "@/lib/archive/delete-logic";
import { requireAuthenticatedAction } from "@/lib/auth/access";

export type DeleteArtworkActionResult =
  | {
      ok: true;
      inventoryId: number;
      title: string;
      filesDeleted: false;
      message: string;
    }
  | {
      ok: false;
      code: string;
      message: string;
      filesDeleted: false;
    };

export async function deleteArtworkAction(
  inventoryId: unknown,
): Promise<DeleteArtworkActionResult> {
  const access = await requireAuthenticatedAction();
  if (!access.ok) {
    return {
      ok: false,
      code: access.code,
      message: access.message,
      filesDeleted: ARCHIVE_DELETE_TOUCHES_STORED_FILES,
    };
  }

  const parsedId = parseDeleteInventoryId(inventoryId);
  if (parsedId == null) {
    return {
      ok: false,
      code: "invalid_inventory_id",
      message: ARCHIVE_DELETE_INVALID_ID_MESSAGE,
      filesDeleted: ARCHIVE_DELETE_TOUCHES_STORED_FILES,
    };
  }

  let result;
  try {
    result = await deleteArtworkArchiveRecord(parsedId);
  } catch (error) {
    console.error("[archive]", {
      operation: "deleteArtwork",
      inventoryId: parsedId,
      code: "UNKNOWN",
      message:
        error instanceof Error ? error.message : ARCHIVE_DELETE_FAILED_MESSAGE,
      filesDeleted: ARCHIVE_DELETE_TOUCHES_STORED_FILES,
    });
    return {
      ok: false,
      code: "UNKNOWN",
      message: ARCHIVE_DELETE_FAILED_MESSAGE,
      filesDeleted: ARCHIVE_DELETE_TOUCHES_STORED_FILES,
    };
  }

  if (!result.ok) {
    return {
      ok: false,
      code: result.code,
      message: result.message,
      filesDeleted: ARCHIVE_DELETE_TOUCHES_STORED_FILES,
    };
  }

  try {
    revalidatePath("/artworks");
    revalidatePath("/artworks/[inventoryId]", "page");
    refresh();
  } catch (error) {
    console.error("[archive]", {
      operation: "deleteArtworkRevalidate",
      inventoryId: result.inventoryId,
      code: "UNKNOWN",
      message:
        error instanceof Error ? error.message : "Cache revalidation failed.",
      filesDeleted: ARCHIVE_DELETE_TOUCHES_STORED_FILES,
    });
  }

  return {
    ok: true,
    inventoryId: result.inventoryId,
    title: result.title,
    filesDeleted: ARCHIVE_DELETE_TOUCHES_STORED_FILES,
    message: result.message,
  };
}
