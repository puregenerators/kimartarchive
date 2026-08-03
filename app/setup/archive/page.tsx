import Link from "next/link";

import { ArchiveSetupClient } from "@/app/setup/archive/SetupArchiveClient";
import { runDropboxDiagnostics } from "@/lib/dropbox/health";
import { buildArchiveOverallStatus } from "@/lib/dropbox/status";
import { runGoogleDiagnostics } from "@/lib/google/diagnostics";

export const metadata = {
  title: "Archive Setup · Kim Artwork Archive",
  description:
    "Connect Google Sheets (metadata) and Dropbox (files) for this local archive.",
};

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  dropbox?: string;
  reason?: string;
  message?: string;
}>;

export default async function SetupArchivePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const [google, dropbox] = await Promise.all([
    runGoogleDiagnostics(),
    runDropboxDiagnostics(),
  ]);

  const googleSheetsReady = google.sheets.complete;
  const overall = buildArchiveOverallStatus({
    googleSheetsReady,
    dropboxReady: dropbox.overall.ready,
  });

  let flash: {
    kind: "success" | "error" | null;
    message: string | null;
  } = { kind: null, message: null };

  if (params.dropbox === "connected") {
    flash = {
      kind: "success",
      message: params.message ?? "Dropbox connected successfully.",
    };
  } else if (params.dropbox === "error") {
    flash = {
      kind: "error",
      message:
        params.message ??
        `Dropbox connection failed${params.reason ? ` (${params.reason})` : ""}.`,
    };
  }

  return (
    <main className="relative mx-auto w-full max-w-3xl flex-1 px-5 py-12 sm:px-8 sm:py-16">
      <p className="text-xs uppercase tracking-[0.22em] text-[var(--accent)]">
        Kim Osgood Archive
      </p>
      <h1 className="mt-3 font-display text-4xl tracking-tight text-[var(--ink)]">
        Archive setup
      </h1>
      <p className="mt-4 max-w-2xl text-sm text-[var(--muted)] leading-relaxed">
        Connect providers for this local archive. Google Sheets holds permanent
        metadata; Dropbox holds artwork files. Credentials stay on the server
        and are never shown here.
      </p>
      <p className="mt-2 text-sm">
        <Link
          href="/setup/google"
          className="text-[var(--accent)] underline-offset-2 hover:underline"
        >
          Google sheet tools
        </Link>
      </p>

      <div className="mt-10">
        <ArchiveSetupClient
          google={google}
          dropbox={dropbox}
          flash={flash}
          overall={overall}
        />
      </div>
    </main>
  );
}
