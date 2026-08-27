import { formatFileSize } from "@/lib/artwork/validation";

export const SUBMIT_CONFIRM_DELIVERY =
  "When you submit, the artwork files will be saved to Dropbox and their details will be added to Google Sheets.";

export const SUBMIT_CONFIRM_KEEP_OPEN =
  "Keep this page open until the submission is complete.";

export const SUBMIT_CONFIRM_LARGE_FILES =
  "Large files will use the prepared Dropbox-folder process.";

export const SUBMIT_CONFIRM_MIXED_NEXT_STEP =
  "You will upload those files in Dropbox next. The other files will submit from this page.";

export const SUBMIT_CONFIRM_BACK_LABEL = "Go back";

export type SubmitFailureInfo = {
  message: string;
  stage?: string | null;
  inventoryId?: number | null;
};

export function artworkCountPhrase(count: number): string {
  return `${count} artwork${count === 1 ? "" : "s"}`;
}

export function submitConfirmHeading(count: number): string {
  return `Ready to add ${artworkCountPhrase(count)}?`;
}

export function submitConfirmActionLabel(count: number): string {
  return `Add ${artworkCountPhrase(count)}`;
}

export function submitConfirmSizeLabel(bytes: number): string {
  return `${formatFileSize(bytes)} total`;
}

export function submitConfirmLargeFileNote(params: {
  artworkCount: number;
  largeFileCount: number;
}): string | null {
  if (params.largeFileCount <= 0) return null;
  if (params.largeFileCount < params.artworkCount) {
    return `${SUBMIT_CONFIRM_LARGE_FILES} ${SUBMIT_CONFIRM_MIXED_NEXT_STEP}`;
  }
  return SUBMIT_CONFIRM_LARGE_FILES;
}

export function submitFailureDetail(failure: SubmitFailureInfo): string | null {
  const parts: string[] = [];
  if (failure.inventoryId != null) {
    parts.push(`Inventory ${failure.inventoryId}`);
  }
  if (failure.stage) {
    parts.push(failure.stage);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}
