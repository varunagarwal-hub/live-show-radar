"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const LINKS = [
  { href: "/", label: "Next up", icon: "M4 20V9l8-5 8 5v11h-5v-6H9v6z" },
  { href: "/calendar", label: "Calendar", icon: "M4 6h16v14H4zM4 10h16M8 3v5M16 3v5" },
  { href: "/decide", label: "Decide", icon: "M5 12l4 4 10-10M4 20h16" },
  { href: "/list", label: "List", icon: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" },
  { href: "/more", label: "More", icon: "M5 12h.01M12 12h.01M19 12h.01" },
];
const DESKTOP = [...LINKS.slice(0, 4), { href: "/artists", label: "Artists", icon: "" }, { href: "/health", label: "Health", icon: "" }];

const isCurrent = (path: string, href: string) => (href === "/" ? path === "/" : path.startsWith(href) || (href === "/more" && (path.startsWith("/artists") || path.startsWith("/health"))));

export function DesktopNav() {
  const path = usePathname();
  return (
    <nav aria-label="Main">
      {DESKTOP.map((l) => (
        <Link key={l.href} href={l.href} aria-current={isCurrent(path, l.href) && l.href !== "/more" ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

export function BottomNav() {
  const path = usePathname();
  return (
    <nav className="bottom-nav" aria-label="Main">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={isCurrent(path, l.href) ? "page" : undefined}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d={l.icon} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

/** Follows prefers-color-scheme until toggled; the choice is remembered on this device. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  useEffect(() => {
    const stored = (() => {
      try {
        return localStorage.getItem("theme");
      } catch {
        return null;
      }
    })();
    setTheme(stored === "light" || stored === "dark" ? stored : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  }, []);
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => {
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem("theme", next);
        } catch {}
        setTheme(next);
      }}
      aria-label={theme ? `Switch to ${next === "dark" ? "after the show (dark)" : "in the venue (light)"} theme` : "Switch theme"}
    >
      {theme === "dark" ? "Lights up" : "After the show"}
    </button>
  );
}
