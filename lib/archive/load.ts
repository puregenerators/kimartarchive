import "server-only";

import { cache } from "react";

import {
  ARCHIVE_UNAVAILABLE_MESSAGE,
  loadArtworkArchiveWithReader,
} from "@/lib/archive/load-logic";
import type { ArchiveLoadResult } from "@/lib/archive/types";
import { readArtworkInventoryTable } from "@/lib/google/sheets";
import { resolveArchiveResources } from "@/lib/submission/archive-target";

/**
 * Load the visual archive from the live Artwork Inventory sheet.
 * No app-side persistence — every request re-reads Google Sheets.
 * `cache()` only dedupes within a single request (e.g. page + generateMetadata).
 */
export const loadArtworkArchive = cache(
  async (): Promise<ArchiveLoadResult> => {
    try {
      const resources = resolveArchiveResources();
      if ("code" in resources) {
        return { ok: false, message: ARCHIVE_UNAVAILABLE_MESSAGE };
      }
      return loadArtworkArchiveWithReader(() =>
        readArtworkInventoryTable(resources.sheetId),
      );
    } catch {
      return { ok: false, message: ARCHIVE_UNAVAILABLE_MESSAGE };
    }
  },
);
