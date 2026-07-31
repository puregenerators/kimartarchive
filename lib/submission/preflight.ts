import "server-only";

import { getDriveFileCapabilities } from "@/lib/google/drive";
import {
  getTabHeaderStatus,
  verifySpreadsheetAccess,
} from "@/lib/google/sheets";
import {
  runSubmissionPreflightWithDeps,
  type PreflightFailure,
  type PreflightSuccess,
} from "@/lib/submission/preflight-logic";
import { createStorageProvider } from "@/lib/storage";

export type { PreflightSuccess, PreflightFailure };

/**
 * Global preflight before any inventory claims or storage writes.
 * Fail closed: create nothing / claim nothing on failure.
 */
export async function runSubmissionPreflight(): Promise<
  PreflightSuccess | PreflightFailure
> {
  return runSubmissionPreflightWithDeps({
    createStorage: createStorageProvider,
    verifySpreadsheetAccess,
    getTabHeaderStatus,
    getDriveFileCapabilities,
  });
}
