import { radarConfig } from "@radar/config";
import { politeFetch, type PageFetcher } from "./polite";
import { artistInSlug, parseSitemap } from "./sitemap";
import { ListingSource, ldEventsToItems } from "./ticketing";
import type { RawItem, SourceContext } from "./types";

const BASE = "https://www.district.in";
const DETAIL_SITEMAP = "https://cdn.district.in/sitemap/event-detail-pages.xml";

export const districtListingUrl = (slug: string) => `${BASE}/events/music-in-${slug}-book-tickets`;

/**
 * District (by Zomato). City "music" pages embed a schema.org ItemList of Events. The listing
 * only shows the top ~12 per city, so we also read the public event-detail sitemap and open
 * the detail page of any event whose URL slug names a watched artist.
 */
export class DistrictSource extends ListingSource {
  readonly name = "district" as const;

  constructor(
    private readonly fetchPage: PageFetcher = politeFetch,
    intervalMinutes = radarConfig.intervals.ticketingMinutes,
    private readonly maxDetailPages = 15,
  ) {
    super(intervalMinutes);
  }

  async fetchNewItems(ctx: SourceContext): Promise<RawItem[]> {
    if (!this.due(ctx)) return [];
    const items: RawItem[] = [];
    const errors: unknown[] = [];

    for (const city of radarConfig.cities) {
      const slug = city.slugs.district;
      if (!slug) continue;
      try {
        const html = await this.fetchPage(districtListingUrl(slug));
        items.push(...ldEventsToItems(html, "district", "District", ctx.watchlist, { city: city.name, via: "listing" }, ctx.now));
      } catch (err) {
        errors.push(err);
        ctx.log(`district ${city.name}: ${(err as Error).message}`);
      }
    }

    try {
      const { urls } = parseSitemap(await this.fetchPage(DETAIL_SITEMAP));
      const listed = new Set(items.map((i) => i.url));
      const candidates = urls.filter((u) => !listed.has(u.loc) && !ctx.seen.has(`url:${u.loc}@${u.lastmod ?? ""}`) && artistInSlug(u.loc, ctx.watchlist));
      for (const u of candidates.slice(0, this.maxDetailPages)) {
        try {
          const html = await this.fetchPage(u.loc);
          items.push(...ldEventsToItems(html, "district", "District", ctx.watchlist, { via: "sitemap", seenKey: `url:${u.loc}@${u.lastmod ?? ""}` }, ctx.now));
        } catch (err) {
          errors.push(err);
        }
      }
    } catch (err) {
      errors.push(err);
      ctx.log(`district sitemap: ${(err as Error).message}`);
    }

    this.record(items, errors);
    return items;
  }
}
