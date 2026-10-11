import { XMLParser } from "fast-xml-parser";
import { normalizeName, type WatchArtist } from "@radar/core";

export interface SitemapEntry {
  loc: string;
  lastmod: string | null;
}

const parser = new XMLParser({ ignoreAttributes: true, isArray: (name) => name === "url" || name === "sitemap" });

export function parseSitemap(xml: string): { urls: SitemapEntry[]; sitemaps: string[] } {
  const doc = parser.parse(xml) as {
    urlset?: { url?: { loc?: string; lastmod?: string }[] };
    sitemapindex?: { sitemap?: { loc?: string }[] };
  };
  return {
    urls: (doc.urlset?.url ?? []).filter((u) => u.loc).map((u) => ({ loc: String(u.loc).trim(), lastmod: u.lastmod ? String(u.lastmod) : null })),
    sitemaps: (doc.sitemapindex?.sitemap ?? []).map((s) => String(s.loc ?? "").trim()).filter(Boolean),
  };
}

export const slugify = (s: string) => normalizeName(s).replace(/ /g, "-");

/**
 * Which watched artist (if any) appears in an event URL slug. Names shorter than 4 characters
 * must appear as a whole slug token to avoid matching inside other words.
 */
export function artistInSlug(url: string, watchlist: WatchArtist[]): WatchArtist | null {
  const slug = (url.split("/").pop() ?? "").toLowerCase();
  const tokens = new Set(slug.split("-"));
  for (const a of watchlist) {
    if (a.muted) continue;
    for (const n of [a.name, ...a.aliases]) {
      const s = slugify(n);
      if (!s) continue;
      if (s.length < 4 ? tokens.has(s) : `-${slug}-`.includes(`-${s}-`)) return a;
    }
  }
  return null;
}

/** Turns "prateek-kuhad-live-in-bangalore-sbxyz" into readable words for the extractor. */
export const slugToWords = (url: string) => (url.split("/").pop() ?? "").replace(/-(sb[a-z0-9]{6,}|buy-tickets)$/i, "").replace(/-/g, " ");
