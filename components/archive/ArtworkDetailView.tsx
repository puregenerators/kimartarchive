import type { ReactNode } from "react";

import { ArchiveDeleteControlView } from "@/components/archive/ArchiveDeleteControlView";
import { ArchivePreviewImage } from "@/components/archive/ArchivePreviewImage";
import {
  archiveCollectionFields,
  archiveFileLinks,
  archiveLabeledFields,
  archivePrimaryFacts,
  artworkPreviewAlt,
  formatInventoryId,
} from "@/lib/archive/presentation";
import type { ArchiveArtwork } from "@/lib/archive/types";

function FileLink({
  href,
  children,
}: {
  href: string;
  children: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-h-11 max-w-full items-center break-words text-sm text-[var(--ink-soft)] underline-offset-4 transition hover:text-[var(--accent)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)] md:min-h-0"
    >
      {children}
    </a>
  );
}

export function ArtworkDetailView({
  artwork,
  deleteControl,
}: {
  artwork: ArchiveArtwork;
  deleteControl?: ReactNode;
}) {
  const inventoryId = formatInventoryId(artwork.inventoryId);
  const facts = archivePrimaryFacts(artwork);
  const labeledFields = archiveLabeledFields(artwork);
  const fileLinks = archiveFileLinks(artwork);
  const collectionFields = archiveCollectionFields();

  return (
    <article className="flex min-w-0 flex-col gap-16">
      <header className="flex min-w-0 flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-8">
        <h1 className="break-words font-display text-4xl tracking-tight text-[var(--ink)] md:text-5xl">
          {artwork.title}
        </h1>
        <div className="flex items-center justify-between gap-2 md:justify-end">
          <p className="font-mono text-sm tracking-wide text-[var(--muted)] md:text-right">
            {inventoryId}
          </p>
          {deleteControl ?? (
            <ArchiveDeleteControlView
              title={artwork.title}
              variant="detail"
            />
          )}
        </div>
      </header>

      <figure className="min-w-0 w-full">
        <ArchivePreviewImage
          displayUrl={artwork.webFileDisplayUrl}
          alt={artworkPreviewAlt(artwork)}
          sizes="detail"
        />
        {!artwork.webFileDisplayUrl && artwork.webFileUrl ? (
          <figcaption className="mt-4 text-xs text-[var(--muted)]">
            Preview unavailable.{" "}
            <a
              href={artwork.webFileUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--accent)] underline-offset-2 hover:underline"
            >
              Open file
            </a>
          </figcaption>
        ) : null}
      </figure>

      {facts.length > 0 ? (
        <section className="flex max-w-xl flex-col gap-2">
          {facts.map((fact, index) => (
            <p
              key={`${index}-${fact}`}
              className="text-base leading-relaxed text-[var(--ink-soft)]"
            >
              {fact}
            </p>
          ))}
        </section>
      ) : null}

      {labeledFields.length > 0 ? (
        <dl className="flex max-w-xl flex-col gap-8">
          {labeledFields.map((field) => (
            <div key={field.label} className="flex min-w-0 flex-col gap-2">
              <dt className="text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
                {field.label}
              </dt>
              <dd className="break-words text-base leading-relaxed text-[var(--ink)]">
                {field.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {fileLinks.length > 0 ? (
        <section className="max-w-xl border-t border-[var(--line)] pt-10">
          <h2 className="text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
            Files
          </h2>
          <ul className="mt-5 flex flex-col gap-1 md:gap-3">
            {fileLinks.map((link) => (
              <li key={link.label} className="min-w-0">
                <FileLink href={link.href}>{link.label}</FileLink>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {collectionFields.length > 0 ? (
        <section className="max-w-xl border-t border-[var(--line)] pt-10">
          <h2 className="text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
            Collection Information
          </h2>
          <dl className="mt-5 flex flex-col gap-8">
            {collectionFields.map((field) => (
              <div key={field.label} className="flex min-w-0 flex-col gap-2">
                <dt className="text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
                  {field.label}
                </dt>
                <dd className="break-words text-base leading-relaxed text-[var(--ink)]">
                  {field.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </article>
  );
}
