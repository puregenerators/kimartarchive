import { isVercelRuntime } from "@/lib/dropbox/credentials-logic";

/**
 * Legacy multipart `/api/artwork-batches/submit` must not accept master
 * bytes on Vercel (4.5 MB function body cap). Local scripts may still use it.
 */
export function multipartMasterSubmitAllowed(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return !isVercelRuntime(env);
}

export const MULTIPART_SUBMIT_BLOCKED_MESSAGE =
  "This multipart intake path is disabled in production. Upload masters directly to Dropbox from the intake UI.";
