/**
 * Shortcuts from the visual archive to its working resources.
 * Destinations come from existing archive configuration — not a second catalog.
 */

import { DROPBOX_ARCHIVE_ROOT_WEB_URL } from "@/lib/dropbox/types";

export const ARCHIVE_RESOURCE_LINK_COPY = {
  spreadsheet: "Metadata spreadsheet",
  dropbox: "Dropbox files",
  navLabel: "Archive resources",
  externalArrow: "↗",
} as const;

export type ArchiveResourceLink = {
  key: "spreadsheet" | "dropbox";
  href: string;
  label: string;
};

/**
 * Production Artwork Inventory URL from GOOGLE_SHEET_ID.
 * Uses the existing spreadsheet browser-URL helper; does not invent a second destination.
 */
export function productionSpreadsheetHref(
  sheetId: string | undefined,
  toBrowserUrl: (spreadsheetId: string) => string,
): string | null {
  const trimmed = sheetId?.trim() ?? "";
  return trimmed ? toBrowserUrl(trimmed) : null;
}

/**
 * Compact archive utility links. Dropbox uses the canonical App Folder web URL.
 * Spreadsheet is omitted when the production sheet ID is not configured.
 */
export function archiveResourceLinks(input: {
  spreadsheetHref: string | null;
  dropboxHref?: string;
}): ArchiveResourceLink[] {
  const links: ArchiveResourceLink[] = [];
  if (input.spreadsheetHref) {
    links.push({
      key: "spreadsheet",
      href: input.spreadsheetHref,
      label: ARCHIVE_RESOURCE_LINK_COPY.spreadsheet,
    });
  }
  links.push({
    key: "dropbox",
    href: input.dropboxHref ?? DROPBOX_ARCHIVE_ROOT_WEB_URL,
    label: ARCHIVE_RESOURCE_LINK_COPY.dropbox,
  });
  return links;
}
