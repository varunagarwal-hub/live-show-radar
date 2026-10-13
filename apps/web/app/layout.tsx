import type { Metadata, Viewport } from "next";
import { Big_Shoulders, Schibsted_Grotesk } from "next/font/google";
import Link from "next/link";
import { BottomNav, DesktopNav, SignOutButton, ThemeToggle } from "@/components/Chrome";
import { Effects } from "@/components/Effects";
import { mastheadDate } from "@/lib/format";
import "./globals.css";
import "./stage.css";

// Big Shoulders (formerly "Big Shoulders Display"; Google merged the families behind an optical-size axis).
const display = Big_Shoulders({ subsets: ["latin"], weight: "variable", axes: ["opsz"], variable: "--font-display", display: "swap" });
const body = Schibsted_Grotesk({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--font-body", display: "swap" });

export const metadata: Metadata = {
  title: "Early Access",
  description: "Every show your artists announce in India, before the early-birds are gone.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#E4E6E1" },
    { media: "(prefers-color-scheme: dark)", color: "#141B30" },
  ],
};

// Applies the saved theme before first paint so there's no flash.
const themeInit = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;


export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${display.variable} ${body.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
          {/* Two-colour riso duotones for artist photos: navy shadows → city ink → paper highlights. */}
          <filter id="duo-home" colorInterpolationFilters="sRGB">
            <feColorMatrix type="saturate" values="0" />
            <feComponentTransfer>
              <feFuncR type="table" tableValues="0.106 0 0.894" />
              <feFuncG type="table" tableValues="0.153 0.471 0.902" />
              <feFuncB type="table" tableValues="0.271 0.749 0.882" />
            </feComponentTransfer>
          </filter>
          <filter id="duo-away" colorInterpolationFilters="sRGB">
            <feColorMatrix type="saturate" values="0" />
            <feComponentTransfer>
              <feFuncR type="table" tableValues="0.106 0.894" />
              <feFuncG type="table" tableValues="0.153 0.902" />
              <feFuncB type="table" tableValues="0.271 0.882" />
            </feComponentTransfer>
          </filter>
        </svg>
        <div className="frame">
          <header className="masthead">
            <Link href="/" className="wordmark" aria-label="Early Access, home">
              <svg className="logo-mark" viewBox="0 0 48 32" aria-hidden="true">
                {/* a ticket stub: notched sides, perforation, admit-one star */}
                <path d="M4 2h40a2 2 0 0 1 2 2v7a5 5 0 0 0 0 10v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-7a5 5 0 0 0 0-10V4a2 2 0 0 1 2-2z" />
                <path className="logo-perf" d="M33 6v20" />
                <path className="logo-star" d="M17 9l2.1 4.4 4.8.6-3.5 3.3.9 4.7-4.3-2.3-4.3 2.3.9-4.7-3.5-3.3 4.8-.6z" />
              </svg>
              <span className="logo-text">
                Early Access
                <small suppressHydrationWarning>Bengaluru &amp; beyond · {mastheadDate()}</small>
              </span>
            </Link>
            <DesktopNav />
            <div className="masthead-tools">
              <ThemeToggle />
              <SignOutButton />
            </div>
          </header>
          <main id="main">{children}</main>
        </div>
        <BottomNav />
        <Effects />
      </body>
    </html>
  );
}
