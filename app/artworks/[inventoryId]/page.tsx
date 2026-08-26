import Link from "next/link";
import { notFound } from "next/navigation";

import { ArchiveDeleteControl } from "@/components/archive/ArchiveDeleteControl";
import { ArtworkDetailView } from "@/components/archive/ArtworkDetailView";
import { loadArtworkArchive } from "@/lib/archive/load";
import {
  lookupCatalogArtwork,
  parseInventoryIdParam,
} from "@/lib/archive/records";
import { requireAuthenticatedPage } from "@/lib/auth/access";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  params: Promise<{ inventoryId: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  const { inventoryId: rawId } = await params;
  const inventoryId = parseInventoryIdParam(rawId);
  if (inventoryId == null) {
    return { title: "Artwork · Kim Artwork Archive" };
  }

  const result = await loadArtworkArchive();
  if (!result.ok) {
    return { title: "Artwork · Kim's Artwork Archive" };
  }

  const lookup = lookupCatalogArtwork(result.catalog, inventoryId);
  if (lookup.kind === "found") {
    return { title: `${lookup.artwork.title} · Kim's Artwork Archive` };
  }
  return { title: "Artwork · Kim's Artwork Archive" };
}

const backLinkClass =
  "inline-flex min-h-11 items-center text-sm text-[var(--muted)] underline-offset-4 transition hover:text-[var(--ink)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)] md:min-h-0";

export default async function ArtworkDetailPage({ params }: PageProps) {
  await requireAuthenticatedPage();
  const { inventoryId: rawId } = await params;
  const inventoryId = parseInventoryIdParam(rawId);
  if (inventoryId == null) {
    notFound();
  }

  const result = await loadArtworkArchive();

  if (!result.ok) {
    return (
      <main className="relative mx-auto w-full min-w-0 max-w-6xl flex-1 px-5 pb-16 pt-10 md:px-8 md:pb-20 md:pt-28">
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
      </main>
    );
  }

  const lookup = lookupCatalogArtwork(result.catalog, inventoryId);

  if (lookup.kind === "not_found") {
    notFound();
  }

  if (lookup.kind === "duplicate") {
    return (
      <main className="relative mx-auto w-full min-w-0 max-w-6xl flex-1 px-5 pb-16 pt-10 md:px-8 md:pb-20 md:pt-28">
        <p className="text-xs uppercase tracking-[0.22em] text-[var(--accent)]">
          Kim Osgood Archive
        </p>
        <h1 className="mt-3 break-words font-display text-4xl tracking-tight text-[var(--ink)]">
          Inventory ID {lookup.inventoryId}
        </h1>
        <p className="mt-4 max-w-xl text-[var(--muted)] leading-relaxed">
          This inventory ID appears more than once in the Artwork Inventory
          sheet, so the archive cannot open a single record.
        </p>
        <p className="mt-6">
          <Link href="/artworks" className={backLinkClass}>
            ← Archive
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className="relative mx-auto w-full min-w-0 max-w-5xl flex-1 px-5 pb-20 pt-10 md:px-8 md:pb-28 md:pt-28">
      <p className="mb-10 md:mb-12">
        <Link href="/artworks" className={backLinkClass}>
          ← Archive
        </Link>
      </p>
      <ArtworkDetailView
        artwork={lookup.artwork}
        deleteControl={
          <ArchiveDeleteControl
            inventoryId={lookup.artwork.inventoryId}
            title={lookup.artwork.title}
            variant="detail"
          />
        }
      />
    </main>
  );
}
