import { Fragment } from "react";

import {
  ARCHIVE_RESOURCE_LINK_COPY,
  archiveResourceLinks,
} from "@/lib/archive/resource-links";

const resourceLinkClass =
  "text-[10px] uppercase tracking-[0.14em] text-[var(--muted)] underline-offset-4 transition hover:text-[var(--ink-soft)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)]";

export function ArtworksArchiveHeader({
  spreadsheetHref,
}: {
  spreadsheetHref: string | null;
}) {
  const links = archiveResourceLinks({ spreadsheetHref });

  return (
    <header>
      <h1 className="break-words font-display text-4xl leading-tight tracking-tight text-[var(--ink)] md:text-5xl">
        Kim&apos;s Artwork Archive
      </h1>
      <nav
        aria-label={ARCHIVE_RESOURCE_LINK_COPY.navLabel}
        className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1.5 md:mt-4"
      >
        {links.map((link, index) => (
          <Fragment key={link.key}>
            {index > 0 ? (
              <span
                aria-hidden="true"
                className="text-[10px] text-[var(--muted)]"
              >
                ·
              </span>
            ) : null}
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className={resourceLinkClass}
            >
              {link.label}
              <span aria-hidden="true">
                {" "}
                {ARCHIVE_RESOURCE_LINK_COPY.externalArrow}
              </span>
            </a>
          </Fragment>
        ))}
      </nav>
    </header>
  );
}

