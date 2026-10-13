import type { Metadata, Viewport } from "next";
import { Big_Shoulders, Schibsted_Grotesk } from "next/font/google";
import { BottomNav, DesktopNav, SignOutButton, ThemeToggle } from "@/components/Chrome";
import { Effects } from "@/components/Effects";
import { Logo } from "@/components/Logo";
import { getViewer } from "@/lib/auth";
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


export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer().catch(() => null);
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
            {/* Their home city once signed in; before that, the whole country. */}
            <Logo sub={`${viewer ? `${viewer.homeCity} & beyond` : "Live in India"} · ${mastheadDate()}`} />
            <DesktopNav isOwner={viewer?.isOwner ?? false} />
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
