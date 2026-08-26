import Link from "next/link";

export default function ArtworkNotFound() {
  return (
    <main className="relative mx-auto w-full min-w-0 max-w-3xl flex-1 px-5 pb-16 pt-10 md:px-8 md:pb-20 md:pt-28">
      <p className="text-xs uppercase tracking-[0.22em] text-[var(--accent)]">
        Kim Osgood Archive
      </p>
      <h1 className="mt-3 font-display text-4xl tracking-tight text-[var(--ink)]">
        Artwork not found
      </h1>
      <p className="mt-4 max-w-xl text-[var(--muted)] leading-relaxed">
        That inventory ID is not in the Artwork Inventory.
      </p>
      <p className="mt-6">
        <Link
          href="/artworks"
          className="inline-flex min-h-11 items-center text-sm text-[var(--accent)] underline-offset-2 hover:underline md:min-h-0"
        >
          ← Archive
        </Link>
      </p>
    </main>
  );
}
