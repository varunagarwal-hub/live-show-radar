"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import { MORE, moreFor } from "@/lib/nav";
import { gsap, prefersReducedMotion } from "./motion";

const LINKS = [
  { href: "/", label: "Next up", icon: "M4 20V9l8-5 8 5v11h-5v-6H9v6z" },
  { href: "/calendar", label: "Calendar", icon: "M4 6h16v14H4zM4 10h16M8 3v5M16 3v5" },
  { href: "/decide", label: "Decide", icon: "M5 12l4 4 10-10M4 20h16" },
  { href: "/list", label: "List", icon: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" },
  { href: "/more", label: "More", icon: "M5 12h.01M12 12h.01M19 12h.01" },
];
const DESKTOP = LINKS.slice(0, 4);

const isCurrent = (path: string, href: string) => (href === "/" ? path === "/" : path.startsWith(href) || (href === "/more" && MORE.some((m) => path.startsWith(m.href))));
/** Signed out (or not let in yet) there is nowhere to go: the sign-in and invite pages stand alone. */
const isDoor = (path: string) => path.startsWith("/signin") || path.startsWith("/join");

/** Three bouncing bars: the "now playing" mark on the current tab. */
function Equalizer() {
  return (
    <span className="eq" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

export function DesktopNav({ isOwner = false }: { isOwner?: boolean }) {
  const path = usePathname();
  if (isDoor(path)) return null;
  return (
    <nav aria-label="Main">
      {DESKTOP.map((l) => (
        <Link key={l.href} href={l.href} aria-current={isCurrent(path, l.href) ? "page" : undefined}>
          {isCurrent(path, l.href) && <Equalizer />}
          {l.label}
        </Link>
      ))}
      <MoreMenu path={path} items={moreFor(isOwner)} />
    </nav>
  );
}

/** "More ▾" in the desktop nav: your pages (and the owner's tools) in a small drop-down set list. */
function MoreMenu({ path, items }: { path: string; items: typeof MORE }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const active = items.some((m) => path.startsWith(m.href));

  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    if (menu.current && !prefersReducedMotion()) {
      gsap.fromTo(menu.current, { y: -8, opacity: 0, rotate: -2 }, { y: 0, opacity: 1, rotate: 0, duration: 0.28, ease: "back.out(2)" });
      gsap.fromTo(menu.current.querySelectorAll("a"), { x: -10, opacity: 0 }, { x: 0, opacity: 1, duration: 0.25, stagger: 0.05, delay: 0.05 });
    }
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div ref={wrap} className="more-menu">
      <button type="button" className="more-trigger" aria-expanded={open} aria-haspopup="true" aria-current={active ? "page" : undefined} onClick={() => setOpen((o) => !o)}>
        {active && <Equalizer />}
        More <span className="caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div ref={menu} className="more-panel">
          {items.map((m) => (
            <Link key={m.href} href={m.href} aria-current={path.startsWith(m.href) ? "page" : undefined}>
              <b>{m.label}</b>
              <small>{m.note}</small>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function BottomNav() {
  const path = usePathname();
  if (isDoor(path)) return null;
  return (
    <nav className="bottom-nav" aria-label="Main">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={isCurrent(path, l.href) ? "page" : undefined}>
          {isCurrent(path, l.href) ? (
            <Equalizer />
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d={l.icon} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
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

/** Ends the Google session; hidden on the sign-in page (on the invite page it switches accounts). */
export function SignOutButton({ className = "signout" }: { className?: string }) {
  const path = usePathname();
  if (path.startsWith("/signin")) return null;
  return (
    <button type="button" className={className} onClick={() => signOut({ callbackUrl: "/signin" })}>
      Log out
    </button>
  );
}
