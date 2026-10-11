import { radarConfig } from "@radar/config";
import { politeFetch, type PageFetcher } from "./polite";
import { artistInSlug, parseSitemap, slugToWords } from "./sitemap";
import { ListingSource } from "./ticketing";
import type { RawItem, SourceContext } from "./types";

const EVENT_SITEMAP = "https://www.skillboxes.com/media/sitemap/sitemap-event.xml";

// NOTE: SkillBox city pages (/events-<city>) and event pages are rendered in the browser: the
// HTML has no event data, JSON-LD or embedded state. Rather than call an undocumented internal
// API, this adapter reads the public event sitemap (allowed by robots.txt) and turns recently
// updated event URLs whose slug names a watched artist into items. The extractor only sees the
// slug words, so these usually arrive as quiet "possible show" messages with the link.
export class SkillboxSource extends ListingSource {
  readonly name = "skillbox" as const;

  constructor(
    private readonly fetchPage: PageFetcher = politeFetch,
    intervalMinutes = radarConfig.intervals.ticketingMinutes,
    private readonly recentDays = 21,
  ) {
    super(intervalMinutes);
  }

  async fetchNewItems(ctx: SourceContext): Promise<RawItem[]> {
    if (!this.due(ctx)) return [];
    const items: RawItem[] = [];
    const errors: unknown[] = [];
    try {
      const { urls } = parseSitemap(await this.fetchPage(EVENT_SITEMAP));
      const cutoff = ctx.now.getTime() - this.recentDays * 86_400_000;
      for (const u of urls) {
        if (u.lastmod && Date.parse(u.lastmod) < cutoff) continue;
        const artist = artistInSlug(u.loc, ctx.watchlist);
        if (!artist) continue;
        items.push({
          source: "skillbox",
          externalId: u.loc,
          url: u.loc,
          text: `SkillBox event listing (title from URL): "${slugToWords(u.loc)}"\nLast updated: ${u.lastmod ?? "unknown"}\nURL: ${u.loc}`,
          meta: { via: "sitemap", lastmod: u.lastmod, artistHint: artist.name },
        });
      }
    } catch (err) {
      errors.push(err);
      ctx.log(`skillbox: ${(err as Error).message}`);
    }
    this.record(items, errors);
    return items;
  }
}
