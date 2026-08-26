/**
 * Lightweight intake stage timings for server logs / dev diagnostics.
 * Not stored as artwork metadata.
 */

export type IntakeStageTimings = {
  masterReadDecodeMs: number;
  hrGenerationMs: number;
  webGenerationMs: number;
  thumbnailGenerationMs: number;
  dropboxMasterUploadMs: number;
  dropboxDerivativeUploadsMs: number;
  sheetsAppendMs: number;
  totalIntakeMs: number;
};

export function emptyIntakeTimings(): IntakeStageTimings {
  return {
    masterReadDecodeMs: 0,
    hrGenerationMs: 0,
    webGenerationMs: 0,
    thumbnailGenerationMs: 0,
    dropboxMasterUploadMs: 0,
    dropboxDerivativeUploadsMs: 0,
    sheetsAppendMs: 0,
    totalIntakeMs: 0,
  };
}

export function formatIntakeTimings(timings: IntakeStageTimings): string {
  return [
    `master_read_decode=${timings.masterReadDecodeMs}ms`,
    `hr_generation=${timings.hrGenerationMs}ms`,
    `web_generation=${timings.webGenerationMs}ms`,
    `thumbnail_generation=${timings.thumbnailGenerationMs}ms`,
    `dropbox_master_upload=${timings.dropboxMasterUploadMs}ms`,
    `dropbox_derivative_uploads=${timings.dropboxDerivativeUploadsMs}ms`,
    `sheets_append=${timings.sheetsAppendMs}ms`,
    `total_intake=${timings.totalIntakeMs}ms`,
  ].join(" ");
}
