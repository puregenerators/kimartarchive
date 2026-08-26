"use client";

import Link from "next/link";
import { useId, type ReactNode, type Ref } from "react";

export const APP_NAV_ITEMS = [
  { href: "/", label: "Home", match: (path: string) => path === "/" },
  {
    href: "/artworks",
    label: "Artwork Archive",
    match: (path: string) => path === "/artworks" || path.startsWith("/artworks/"),
  },
  {
    href: "/new-artwork",
    label: "Add New Artwork",
    match: (path: string) => path.startsWith("/new-artwork"),
  },
  {
    href: "/setup/archive",
    label: "Settings",
    match: (path: string) => path.startsWith("/setup"),
  },
] as const;

export function navLinkClass(active: boolean): string {
  return [
    "text-xs uppercase tracking-[0.14em] transition",
    active ? "text-[var(--ink)]" : "text-[var(--muted)] hover:text-[var(--ink)]",
  ].join(" ");
}

function MenuIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 7h16M4 12h16M4 17h16"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function AppNavView({
  pathname,
  menuOpen,
  onMenuToggle,
  onNavigate,
  headerRef,
  desktopLogout,
  mobileLogout,
}: {
  pathname: string;
  menuOpen: boolean;
  onMenuToggle: () => void;
  onNavigate?: () => void;
  headerRef?: Ref<HTMLElement>;
  desktopLogout?: ReactNode;
  mobileLogout?: ReactNode;
}) {
  const menuId = useId();

  return (
    <header
      ref={headerRef}
      className={[
        "relative z-20 border-b border-[var(--line)]",
        "md:absolute md:inset-x-8 md:top-6 md:z-10 md:border-b-0",
        "md:flex md:items-start md:justify-between md:gap-6",
      ].join(" ")}
    >
      <div className="flex h-[68px] items-center justify-between px-5 md:contents">
        <Link
          href="/"
          className="shrink-0 text-xs uppercase tracking-[0.22em] text-[var(--accent)] transition hover:text-[var(--ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] md:pt-0.5"
        >
          Kim Osgood Archive
        </Link>
        <button
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center text-[var(--ink)] transition hover:text-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] md:hidden"
          aria-label="Open navigation"
          aria-expanded={menuOpen}
          aria-controls={menuId}
          onClick={onMenuToggle}
        >
          <MenuIcon />
        </button>
      </div>

      <nav
        aria-label="App"
        className="hidden min-w-0 flex-wrap items-center justify-end gap-x-5 gap-y-2 md:flex"
      >
        {APP_NAV_ITEMS.map((item) => {
          const active = item.match(pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={navLinkClass(active)}
            >
              {item.label}
            </Link>
          );
        })}
        {desktopLogout}
      </nav>

      <nav
        id={menuId}
        aria-label="App"
        className={
          menuOpen
            ? "border-t border-[var(--line)] px-5 py-3 md:hidden"
            : "hidden"
        }
      >
        <ul className="flex flex-col">
          {APP_NAV_ITEMS.map((item) => {
            const active = item.match(pathname);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  onClick={onNavigate}
                  className={[
                    "flex min-h-11 items-center",
                    navLinkClass(active),
                  ].join(" ")}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
          {mobileLogout ? (
            <li className="mt-1 border-t border-[var(--line)] pt-1">
              {mobileLogout}
            </li>
          ) : null}
        </ul>
      </nav>
    </header>
  );
}

