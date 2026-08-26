"use client";

import { useState } from "react";

import {
  splitYearNavigation,
  yearSectionId,
} from "@/lib/archive/presentation";

const desktopYearLinkClass =
  "text-sm tracking-wide text-[var(--muted)] transition hover:text-[var(--ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)]";

const mobileYearLinkClass =
  "inline-flex h-11 items-center px-3 text-sm tracking-wide text-[var(--muted)] transition hover:text-[var(--ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]";

export function ArchiveYearNav({ years }: { years: readonly string[] }) {
  const [moreOpen, setMoreOpen] = useState(false);

  if (years.length === 0) return null;

  const { primary, more } = splitYearNavigation(years);

  return (
    <nav aria-label="Artwork years">
      <ul className="hidden flex-wrap items-baseline gap-x-6 gap-y-2 md:flex">
        {primary.map((year) => (
          <li key={year}>
            <a href={`#${yearSectionId(year)}`} className={desktopYearLinkClass}>
              {year}
            </a>
          </li>
        ))}
        {more.length > 0 ? (
          <li>
            <details>
              <summary
                aria-label="More years"
                className={`${desktopYearLinkClass} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
              >
                More
              </summary>
              <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                {more.map((year) => (
                  <li key={year}>
                    <a href={`#${yearSectionId(year)}`} className={desktopYearLinkClass}>
                      {year}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ) : null}
      </ul>

      <div className="min-w-0 md:hidden">
        <div className="flex min-w-0 items-center">
          <ul className="year-nav-scroll flex min-w-0 flex-1 flex-nowrap items-center overflow-x-auto overscroll-x-contain">
            {primary.map((year) => (
              <li key={year} className="shrink-0">
                <a href={`#${yearSectionId(year)}`} className={mobileYearLinkClass}>
                  {year}
                </a>
              </li>
            ))}
          </ul>
          {more.length > 0 ? (
            <button
              type="button"
              aria-expanded={moreOpen}
              aria-label="More years"
              onClick={() => setMoreOpen((open) => !open)}
              className={`${mobileYearLinkClass} shrink-0 cursor-pointer`}
            >
              More
            </button>
          ) : null}
        </div>
        {more.length > 0 ? (
          <ul
            className={
              moreOpen
                ? "mt-1 flex flex-wrap gap-x-1 gap-y-1"
                : "hidden"
            }
          >
            {more.map((year) => (
              <li key={year} className="shrink-0">
                <a href={`#${yearSectionId(year)}`} className={mobileYearLinkClass}>
                  {year}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </nav>
  );
}
