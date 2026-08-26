"use server";

import { requireAuthenticatedAction } from "@/lib/auth/access";
import { disconnectDropbox, runDropboxDiagnostics } from "@/lib/dropbox/health";
import { DropboxIntegrationError } from "@/lib/dropbox/errors";

export type DropboxSetupActionResult =
  | {
      ok: true;
      message: string;
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

function toResult(error: unknown): DropboxSetupActionResult {
  if (error instanceof DropboxIntegrationError) {
    return error.toClientJSON();
  }
  return {
    ok: false,
    code: "UNKNOWN",
    message: "Dropbox setup action failed.",
  };
}

export async function disconnectDropboxAction(): Promise<DropboxSetupActionResult> {
  const access = await requireAuthenticatedAction();
  if (!access.ok) return access;

  try {
    await disconnectDropbox();
    return {
      ok: true,
      message: "Dropbox disconnected. Local refresh token removed.",
    };
  } catch (error) {
    return toResult(error);
  }
}

export async function runDropboxDiagnosticsAction() {
  const access = await requireAuthenticatedAction();
  if (!access.ok) return access;

  try {
    const diagnostics = await runDropboxDiagnostics();
    return { ok: true as const, diagnostics };
  } catch (error) {
    return toResult(error);
  }
}
