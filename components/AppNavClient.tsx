"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { logoutAction } from "@/app/login/actions";
import { AppNavView, navLinkClass } from "@/components/AppNav";

function LogoutControl({
  className,
  onNavigate,
}: {
  className: string;
  onNavigate?: () => void;
}) {
  return (
    <form action={logoutAction}>
      <button type="submit" className={className} onClick={onNavigate}>
        Log out
      </button>
    </form>
  );
}

function AppNavInner({ pathname }: { pathname: string }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!menuOpen) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (headerRef.current && !headerRef.current.contains(target)) {
        setMenuOpen(false);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [menuOpen]);

  return (
    <AppNavView
      pathname={pathname}
      menuOpen={menuOpen}
      onMenuToggle={() => setMenuOpen((open) => !open)}
      onNavigate={() => setMenuOpen(false)}
      headerRef={headerRef}
      desktopLogout={
        <LogoutControl
          className={navLinkClass(false)}
          onNavigate={() => setMenuOpen(false)}
        />
      }
      mobileLogout={
        <LogoutControl
          className={["flex min-h-11 items-center", navLinkClass(false)].join(
            " ",
          )}
          onNavigate={() => setMenuOpen(false)}
        />
      }
    />
  );
}

export function AppNav() {
  const pathname = usePathname();
  if (pathname === "/login") return null;
  return <AppNavInner key={pathname} pathname={pathname} />;
}
