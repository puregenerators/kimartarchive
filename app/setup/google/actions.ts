"use server";

import { requireAuthenticatedAction } from "@/lib/auth/access";
import { GoogleIntegrationError } from "@/lib/google/errors";
import { createFailedIntakeFolder } from "@/lib/google/drive";
import {
  ARTWORK_INVENTORY_HEADERS,
  ARTWORK_INVENTORY_TAB,
  INVENTORY_CLAIMS_HEADERS,
  INVENTORY_CLAIMS_TAB,
} from "@/lib/google/headers";
import { FAILED_INTAKE_FOLDER_NAME } from "@/lib/google/drive-query";
import { initializeBlankHeaders, insertArtworkInventoryThumbnailColumn } from "@/lib/google/sheets";
import type { SheetTabName } from "@/lib/google/diagnostic-types";
import { runGoogleDiagnostics } from "@/lib/google/diagnostics";

export type SetupActionResult =
  | {
      ok: true;
      message: string;
      detail?: Record<string, string | number | boolean | readonly string[]>;
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

function toResult(error: unknown): SetupActionResult {
  if (error instanceof GoogleIntegrationError) {
    return error.toClientJSON();
  }
  return {
    ok: false,
    code: "UNKNOWN",
    message: "Setup action failed.",
  };
}

export async function refreshGoogleDiagnosticsAction() {
  const access = await requireAuthenticatedAction();
  if (!access.ok) return access;

  try {
    return { ok: true as const, diagnostics: await runGoogleDiagnostics() };
  } catch (error) {
    return toResult(error);
  }
}

export async function initializeSheetHeadersAction(
  tab: SheetTabName,
  confirmationToken: string,
): Promise<SetupActionResult> {
  const access = await requireAuthenticatedAction();
  if (!access.ok) return access;

  if (confirmationToken !== `INIT_HEADERS:${tab}`) {
    return {
      ok: false,
      code: "CONFIRMATION_REQUIRED",
      message: "Confirmation token mismatch. Setup was not run.",
    };
  }

  const expected =
    tab === ARTWORK_INVENTORY_TAB
      ? ARTWORK_INVENTORY_HEADERS
      : INVENTORY_CLAIMS_HEADERS;

  try {
    const result = await initializeBlankHeaders(tab);
    if (!result.ok) {
      return {
        ok: false,
        code: result.code,
        message: result.message,
      };
    }

    return {
      ok: true,
      message:
        result.action === "wrote_headers"
          ? `Wrote ${expected.length} header columns to “${tab}”.`
          : `Headers on “${tab}” already match. No changes made.`,
      detail: {
        tab,
        action: result.action,
        headers: result.headersWritten,
      },
    };
  } catch (error) {
    return toResult(error);
  }
}

export async function insertThumbnailColumnAction(
  confirmationToken: string,
): Promise<SetupActionResult> {
  const access = await requireAuthenticatedAction();
  if (!access.ok) return access;

  if (confirmationToken !== "INSERT_THUMBNAIL_COLUMN") {
    return {
      ok: false,
      code: "CONFIRMATION_REQUIRED",
      message: "Confirmation token mismatch. Setup was not run.",
    };
  }

  try {
    const result = await insertArtworkInventoryThumbnailColumn();
    if (!result.ok) {
      return {
        ok: false,
        code: result.code,
        message: result.message,
      };
    }

    return {
      ok: true,
      message:
        result.action === "inserted"
          ? "Inserted the Thumbnail display column after Inventory ID. Existing rows were shifted; no thumbnails were backfilled."
          : "Thumbnail column already present. No changes made.",
      detail: {
        action: result.action,
        headers: result.headers,
      },
    };
  } catch (error) {
    return toResult(error);
  }
}

export async function createFailedIntakeFolderAction(
  confirmationToken: string,
): Promise<SetupActionResult> {
  const access = await requireAuthenticatedAction();
  if (!access.ok) return access;

  if (confirmationToken !== `CREATE_FOLDER:${FAILED_INTAKE_FOLDER_NAME}`) {
    return {
      ok: false,
      code: "CONFIRMATION_REQUIRED",
      message: "Confirmation token mismatch. Setup was not run.",
    };
  }

  try {
    const result = await createFailedIntakeFolder();
    if (!result.ok) {
      return {
        ok: false,
        code: result.code,
        message: result.message,
      };
    }

    return {
      ok: true,
      message:
        result.action === "created"
          ? `Created folder “${result.folderName}”.`
          : `Folder “${result.folderName}” already exists. No changes made.`,
      detail: {
        action: result.action,
        folderId: result.folderId,
        folderName: result.folderName,
      },
    };
  } catch (error) {
    return toResult(error);
  }
}

export async function getExpectedSetupPreview() {
  const access = await requireAuthenticatedAction();
  if (!access.ok) return access;

  return {
    artworkInventoryTab: ARTWORK_INVENTORY_TAB,
    inventoryClaimsTab: INVENTORY_CLAIMS_TAB,
    artworkInventoryHeaders: ARTWORK_INVENTORY_HEADERS,
    inventoryClaimsHeaders: INVENTORY_CLAIMS_HEADERS,
    failedIntakeFolderName: FAILED_INTAKE_FOLDER_NAME,
  };
}
