import Link from "next/link";
import { SetupGoogleClient } from "@/app/setup/google/SetupGoogleClient";
import { requireAuthenticatedPage } from "@/lib/auth/access";
import { runDropboxDiagnostics } from "@/lib/dropbox/health";
import { ARCHIVE_STATUS_COPY } from "@/lib/google/archive-status-presentation";
import { runGoogleDiagnostics } from "@/lib/google/diagnostics";

export const metadata = {
  title: "Archive status · Kim Artwork Archive",
  description: ARCHIVE_STATUS_COPY.intro,
};

export const dynamic = "force-dynamic";

export default async function SetupGooglePage() {
  await requireAuthenticatedPage();
  const [diagnostics, dropbox] = await Promise.all([
    runGoogleDiagnostics(),
    runDropboxDiagnostics(),
  ]);

  return (
    <main className="relative mx-auto w-full max-w-3xl flex-1 px-5 py-12 sm:px-8 sm:py-16">
      <p className="text-xs uppercase tracking-[0.22em] text-[var(--accent)]">
        Kim Osgood Archive
      </p>
      <h1 className="mt-3 font-display text-4xl tracking-tight text-[var(--ink)]">
        {ARCHIVE_STATUS_COPY.pageTitle}
      </h1>
      <p className="mt-4 max-w-2xl text-sm text-[var(--muted)] leading-relaxed">
        {ARCHIVE_STATUS_COPY.intro}
      </p>
      <p className="mt-2 text-sm">
        <Link
          href="/setup/archive"
          className="text-[var(--accent)] underline-offset-2 hover:underline"
        >
          Archive setup
        </Link>
      </p>

      <div className="mt-10">
        <SetupGoogleClient
          initialDiagnostics={diagnostics}
          dropbox={dropbox}
        />
      </div>
    </main>
  );
}
