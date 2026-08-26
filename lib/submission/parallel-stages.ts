import type {
  ArtworkSubmissionStage,
  SubmissionFailedOperation,
} from "@/lib/submission/types";

/**
 * Linear last-completed stage after concurrent HR / web / thumb uploads.
 * Earlier files in the pipeline still have to succeed before a later stage counts.
 */
export function lastCompletedDerivativeUploadStage(params: {
  hr: boolean;
  web: boolean;
  thumb: boolean;
  previous: ArtworkSubmissionStage;
}): ArtworkSubmissionStage {
  if (params.hr && params.web && params.thumb) return "thumb_uploaded";
  if (params.hr && params.web) return "web_uploaded";
  if (params.hr) return "hr_uploaded";
  return params.previous;
}

/**
 * Prefer the earliest failed derivative upload so reports stay specific
 * even when HR, web, and thumbnail run concurrently.
 */
export function firstFailedDerivativeUpload(params: {
  hr?: unknown;
  web?: unknown;
  thumb?: unknown;
}): { operation: SubmissionFailedOperation; error: unknown } | null {
  if (params.hr !== undefined) {
    return { operation: "upload_hr", error: params.hr };
  }
  if (params.web !== undefined) {
    return { operation: "upload_web", error: params.web };
  }
  if (params.thumb !== undefined) {
    return { operation: "upload_thumb", error: params.thumb };
  }
  return null;
}
