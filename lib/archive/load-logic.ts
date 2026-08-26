import { GoogleIntegrationError } from "@/lib/google/errors";
import { MissingGoogleEnvError } from "@/lib/google/env";
import { buildArchiveCatalog } from "@/lib/archive/records";
import type { ArchiveLoadResult, InventoryTable } from "@/lib/archive/types";

export const ARCHIVE_UNAVAILABLE_MESSAGE =
  "The archive could not be loaded.";

export const ARCHIVE_MISSING_COLUMNS_MESSAGE =
  "The Artwork Inventory sheet is missing required columns.";

export type InventoryTableReader = () => Promise<InventoryTable>;

function isMissingHeadersCatalog(catalog: ReturnType<typeof buildArchiveCatalog>) {
  return catalog.warnings.some(
    (warning) => warning.code === "missing_required_headers",
  );
}

/**
 * Build the archive catalog from an injected Sheet reader.
 * Safe for tests: pass a mock reader — never call live Google APIs from tests.
 */
export async function loadArtworkArchiveWithReader(
  readTable: InventoryTableReader,
): Promise<ArchiveLoadResult> {
  try {
    const table = await readTable();
    const catalog = buildArchiveCatalog(table);
    if (isMissingHeadersCatalog(catalog) && catalog.artworks.length === 0) {
      return { ok: false, message: ARCHIVE_MISSING_COLUMNS_MESSAGE };
    }
    return { ok: true, catalog };
  } catch (error) {
    if (
      error instanceof GoogleIntegrationError ||
      error instanceof MissingGoogleEnvError
    ) {
      return { ok: false, message: ARCHIVE_UNAVAILABLE_MESSAGE };
    }
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "MISSING_TARGET_CONFIG" || error.code === "INVALID_TARGET")
    ) {
      return { ok: false, message: ARCHIVE_UNAVAILABLE_MESSAGE };
    }
    return { ok: false, message: ARCHIVE_UNAVAILABLE_MESSAGE };
  }
}
