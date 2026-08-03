import Link from "next/link";
import { SetupGoogleClient } from "@/app/setup/google/SetupGoogleClient";
import { runGoogleDiagnostics } from "@/lib/google/diagnostics";

export const metadata = {
  title: "Google Sheet Tools · Kim Artwork Archive",
  description: "Diagnostics for Google Sheets (metadata) and legacy Drive tooling.",
};

export const dynamic = "force-dynamic";

export default async function SetupGooglePage() {
  const diagnostics = await runGoogleDiagnostics();

  return (
    <main className="relative mx-auto w-full max-w-3xl flex-1 px-5 py-12 sm:px-8 sm:py-16">
      <p className="text-xs uppercase tracking-[0.22em] text-[var(--accent)]">
        Kim Osgood Archive
      </p>
      <h1 className="mt-3 font-display text-4xl tracking-tight text-[var(--ink)]">
        Google sheet tools
      </h1>
      <p className="mt-4 max-w-2xl text-sm text-[var(--muted)] leading-relaxed">
        Google Sheets is the permanent metadata store. Artwork files will live in
        Dropbox (see Archive setup). Credentials are validated on the server only
        and are never shown here.
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
        <SetupGoogleClient initialDiagnostics={diagnostics} />
      </div>
    </main>
  );
}
