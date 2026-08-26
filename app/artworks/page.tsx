import Link from "next/link";

import { ArtworksArchiveInteractive } from "@/components/archive/ArtworksArchiveInteractive";
import { loadArtworkArchive } from "@/lib/archive/load";
import { requireAuthenticatedPage } from "@/lib/auth/access";

export const metadata = {
  title: "Kim Artwork Archive",
  description: "Browse completed artworks in the Kim Artwork Archive.",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ArtworksPage() {
  await requireAuthenticatedPage();
  const result = await loadArtworkArchive();

  return (
    <main className="relative mx-auto w-full min-w-0 max-w-7xl flex-1 px-5 pb-20 pt-10 md:px-8 md:pb-28 md:pt-28">
      <h1 className="break-words font-display text-4xl leading-tight tracking-tight text-[var(--ink)] md:text-5xl">
        Kim&apos;s Artwork Archive
      </h1>

      <div className="mt-10 md:mt-12">
        {!result.ok ? (
          <p className="text-[var(--muted)]">
            {result.message}{" "}
            <Link
              href="/setup/archive"
              className="text-[var(--accent)] underline-offset-2 hover:underline"
            >
              Check Archive Setup
            </Link>
            .
          </p>
        ) : result.catalog.artworks.length === 0 &&
          result.catalog.warnings.length === 0 ? (
          <p className="text-[var(--muted)]">
            No artworks have been archived yet.
          </p>
        ) : (
          <ArtworksArchiveInteractive
            artworks={result.catalog.artworks}
            warnings={result.catalog.warnings}
          />
        )}
      </div>
    </main>
  );
}
