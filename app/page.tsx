import Link from "next/link";

export default function Home() {
  return (
    <main className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-5 py-20 sm:px-8">
      <p className="text-xs uppercase tracking-[0.22em] text-[var(--accent)]">
        Kim Artwork Archive
      </p>
      <h1 className="mt-4 font-display text-5xl tracking-tight text-[var(--ink)] sm:text-6xl">
        Artwork Intake Tool
      </h1>
      <p className="mt-5 max-w-xl text-[var(--muted)] leading-relaxed">
        Prepare a batch of artworks for the archive. This milestone is local
        only—nothing is uploaded or saved yet.
      </p>
      <div className="mt-10">
        <Link
          href="/new-artwork"
          className="inline-flex border border-[var(--ink)] bg-[var(--ink)] px-6 py-3 text-sm uppercase tracking-[0.14em] text-[var(--paper)] transition hover:bg-[var(--ink-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          Add New Artwork
        </Link>
      </div>
    </main>
  );
}
