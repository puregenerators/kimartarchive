import { isVercelRuntime } from "@/lib/dropbox/credentials-logic";

/**
 * Multipart `/api/dev/process-artwork-image` is local diagnostics only.
 * Vercel function bodies cap at 4.5 MB; never send source files through
 * production routes.
 */
export function localDevMultipartProcessingAllowed(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return !isVercelRuntime(env);
}

export const LOCAL_DEV_MULTIPART_BLOCKED_MESSAGE =
  "Local image-processing tests cannot send source files through production Vercel routes. Use Archive setup on a local `npm run dev` server.";
