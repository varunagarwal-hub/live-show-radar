import { radarConfig } from "@radar/config";
import { politeFetch, type PageFetcher } from "./polite";
import { ListingSource, ldEventsToItems } from "./ticketing";
import { BlockedError, type RawItem, type SourceContext } from "./types";

// NOTE: BookMyShow's /explore pages are allowed by robots.txt but currently answer automated
// requests with a Cloudflare "Just a moment..." challenge (checked 2026-10). We never try to
// solve or evade it: the adapter reports "blocked" on the Health page and in the digest, and
// starts working by itself if the pages are ever served normally. The music category slug
// (`music-shows-<city>`) is inferred from BookMyShow's sitemap patterns and is unconfirmed.
export const bookMyShowListingUrl = (slug: string) => `https://in.bookmyshow.com/explore/music-shows-${slug}`;

export class BookMyShowSource extends ListingSource {
  readonly name = "bookmyshow" as const;

  constructor(
    private readonly fetchPage: PageFetcher = politeFetch,
    intervalMinutes = radarConfig.intervals.ticketingMinutes,
  ) {
    super(intervalMinutes);
  }

  async fetchNewItems(ctx: SourceContext): Promise<RawItem[]> {
    if (!this.due(ctx)) return [];
    const items: RawItem[] = [];
    const errors: unknown[] = [];
    for (const city of radarConfig.cities) {
      const slug = city.slugs.bookmyshow;
      if (!slug) continue;
      try {
        const html = await this.fetchPage(bookMyShowListingUrl(slug));
        items.push(...ldEventsToItems(html, "bookmyshow", "BookMyShow", ctx.watchlist, { city: city.name }, ctx.now));
      } catch (err) {
        errors.push(err);
        // One challenge means every city page will get one; stop instead of hammering.
        if (err instanceof BlockedError) break;
      }
    }
    this.record(items, errors);
    return items;
  }
}
