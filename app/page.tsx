import Link from "next/link";

import { requireAuthenticatedPage } from "@/lib/auth/access";

export default async function Home() {
  await requireAuthenticatedPage();

  return (
    <main className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-5 py-20 sm:px-8">
      <h1 className="font-display text-5xl tracking-tight text-[var(--ink)] sm:text-6xl">
        Kim&apos;s Artwork Archive
      </h1>
      <p className="mt-5 max-w-xl text-[var(--muted)] leading-relaxed">
        Browse completed work, or add a new batch to the archive.
      </p>
      <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center">
        <Link
          href="/new-artwork"
          className="inline-flex border border-[var(--ink)] bg-[var(--ink)] px-6 py-3 text-sm uppercase tracking-[0.14em] text-[var(--paper)] transition hover:bg-[var(--ink-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          Add New Artwork
        </Link>
        <Link
          href="/artworks"
          className="inline-flex border border-[var(--ink)] bg-transparent px-6 py-3 text-sm uppercase tracking-[0.14em] text-[var(--ink)] transition hover:bg-[var(--accent-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          View Artwork
        </Link>
      </div>
    </main>
  );
}
