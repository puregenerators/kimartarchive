import { ArchiveSetupClient } from "@/app/setup/archive/SetupArchiveClient";
import { ARCHIVE_SETUP_COPY } from "@/lib/archive/setup-presentation";
import { requireAuthenticatedPage } from "@/lib/auth/access";
import { runDropboxDiagnostics } from "@/lib/dropbox/health";
import { runGoogleDiagnostics } from "@/lib/google/diagnostics";

export const metadata = {
  title: "Archive Setup · Kim Artwork Archive",
  description: ARCHIVE_SETUP_COPY.intro,
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
  await requireAuthenticatedPage();
  const params = await searchParams;
  const [google, dropbox] = await Promise.all([
    runGoogleDiagnostics(),
    runDropboxDiagnostics(),
  ]);

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
        {ARCHIVE_SETUP_COPY.pageTitle}
      </h1>
      <p className="mt-4 max-w-2xl text-sm text-[var(--muted)] leading-relaxed">
        {ARCHIVE_SETUP_COPY.intro}
      </p>

      <div className="mt-10">
        <ArchiveSetupClient
          google={google}
          dropbox={dropbox}
          flash={flash}
        />
      </div>
    </main>
  );
}
