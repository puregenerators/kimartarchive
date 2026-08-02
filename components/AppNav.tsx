"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Home", match: (path: string) => path === "/" },
  {
    href: "/setup/archive",
    label: "Settings",
    match: (path: string) => path.startsWith("/setup"),
  },
] as const;

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="App"
      className="absolute right-5 top-5 z-10 flex items-center gap-5 sm:right-8 sm:top-6"
    >
      {items.map((item) => {
        const active = item.match(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={[
              "text-xs uppercase tracking-[0.14em] transition",
              active
                ? "text-[var(--ink)]"
                : "text-[var(--muted)] hover:text-[var(--ink)]",
            ].join(" ")}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
