import { XMLParser } from "fast-xml-parser";
import { radarConfig } from "@radar/config";
import { BROWSER_UA, fetchText, normalizeName, type WatchArtist } from "@radar/core";
import type { RawItem, Source, SourceContext, SourceHealth } from "./types";

/** Spec 4.2: `"<artist>" (India OR Bengaluru OR Mumbai) concert OR tour` */
export function newsQuery(artist: string): string {
  return `"${artist.replace(/"/g, "")}" (India OR Bengaluru OR Mumbai) concert OR tour`;
}

export const newsFeedUrl = (artist: string) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(newsQuery(artist))}&hl=en-IN&gl=IN&ceid=IN:en`;

const parser = new XMLParser({ ignoreAttributes: false, isArray: (name) => name === "item" });

interface RssItem {
  title?: string;
  link?: string;
  guid?: string | { "#text"?: string };
  pubDate?: string;
  description?: string;
  source?: string | { "#text"?: string };
}

const stripHtml = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const text = (v: unknown) => (typeof v === "string" ? v : v && typeof v === "object" && "#text" in v ? String((v as { "#text": unknown })["#text"]) : "");

/** Parses one Google News RSS feed, keeping only recent articles that actually name the artist. */
export function parseNewsFeed(xml: string, artist: WatchArtist, now = new Date(), maxAgeDays = 30): RawItem[] {
  const doc = parser.parse(xml) as { rss?: { channel?: { item?: RssItem[] } } };
  const names = [artist.name, ...artist.aliases].map(normalizeName).filter((n) => n.length >= 3);
  const out: RawItem[] = [];
  for (const it of doc.rss?.channel?.item ?? []) {
    const title = stripHtml(text(it.title));
    const desc = stripHtml(text(it.description));
    const published = it.pubDate ? new Date(it.pubDate) : null;
    if (published && now.getTime() - published.getTime() > maxAgeDays * 86_400_000) continue;
    const hay = ` ${normalizeName(`${title} ${desc}`)} `;
    if (!names.some((n) => hay.includes(` ${n} `))) continue;
    const link = text(it.link);
    out.push({
      source: "news",
      externalId: text(it.guid) || link,
      url: link || null,
      text: `News headline: ${title}\n${desc && desc !== title ? `Summary: ${desc}\n` : ""}Publisher: ${text(it.source)}\nPublished: ${published?.toISOString() ?? "unknown"}`,
      publishedAt: published,
      meta: { artistId: artist.id, artistHint: artist.name },
    });
  }
  return out;
}

const INTERVAL_MIN: Record<WatchArtist["priorityTier"], number> = { A: 60, B: 120, C: 240 };

// NOTE: news.google.com's robots.txt disallows /rss for crawlers. These feeds are published
// for feed readers, and the spec asks for them, so we read them like one: one feed per artist
// every 1–4 hours depending on tier. Turn off features.news to stop entirely.
export class NewsSource implements Source {
  readonly name = "news" as const;
  private last: SourceHealth = { ok: true, itemCount: 0, error: null };

  constructor(
    private readonly fetchFeed: (url: string) => Promise<string> = (u) => fetchText(u, { headers: { "user-agent": BROWSER_UA }, attempts: 2 }),
    private readonly maxFeedsPerRun = 25,
  ) {}

  health(): SourceHealth {
    return this.last;
  }

  async fetchNewItems(ctx: SourceContext): Promise<RawItem[]> {
    const due = ctx.watchlist
      .filter((a) => !a.muted)
      .map((a) => {
        const last = ctx.cursors[`news:${a.id}`];
        const overdue = last ? (ctx.now.getTime() - Date.parse(last)) / 60_000 - INTERVAL_MIN[a.priorityTier] : Infinity;
        return { a, overdue };
      })
      .filter((x) => x.overdue >= -radarConfig.intervals.pollMinutes / 2)
      .sort((x, y) => y.overdue - x.overdue)
      .slice(0, this.maxFeedsPerRun);
    const items: RawItem[] = [];
    let failures = 0;
    let lastError: string | null = null;
    for (const { a } of due) {
      try {
        items.push(...parseNewsFeed(await this.fetchFeed(newsFeedUrl(a.name)), a, ctx.now));
        ctx.cursors[`news:${a.id}`] = ctx.now.toISOString();
      } catch (err) {
        failures++;
        lastError = (err as Error).message;
      }
    }
    this.last = { ok: due.length === 0 || failures < due.length, itemCount: items.length, error: lastError };
    return items;
  }
}
