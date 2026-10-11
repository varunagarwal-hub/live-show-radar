import { describe, expect, it } from "vitest";
import { DistrictSource, districtListingUrl } from "../src/district";
import { BookMyShowSource, bookMyShowListingUrl } from "../src/bookmyshow";
import { SkillboxSource } from "../src/skillbox";
import { extractLdEvents } from "../src/jsonld";
import { ldEventsToItems, structuredExtraction } from "../src/ticketing";
import { BlockedError } from "../src/types";
import { artistInSlug } from "../src/sitemap";
import { looksLikeBotChallenge, toCandidates } from "@radar/core";
import { ctx, fakeFetcher, fixture, WATCHLIST } from "./helpers";

const now = new Date("2026-10-11T06:00:00Z");
const DETAIL_SITEMAP = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://www.district.in/events/kidzania-mumbai-buy-tickets</loc><lastmod>2026-10-10</lastmod></url>
<url><loc>https://www.district.in/events/when-chai-met-toast-live-bengaluru-buy-tickets</loc><lastmod>2026-10-10</lastmod></url>
<url><loc>https://www.district.in/events/lifafa-live-in-pune-2026-buy-tickets</loc><lastmod>2026-10-10</lastmod></url>
</urlset>`;

describe("JSON-LD parsing", () => {
  it("finds events inside ItemLists and skips broken blocks", () => {
    const events = extractLdEvents(fixture("district-listing-bengaluru.html"));
    expect(events.map((e) => e.name)).toEqual([
      "Prateek Kuhad - Silhouettes India Tour | Bengaluru",
      "Bankai Beats | Bengaluru",
      "When Chai Met Toast Live | Bengaluru",
    ]);
  });

  it("finds MusicEvent arrays", () => {
    expect(extractLdEvents(fixture("bookmyshow-listing.html"))).toHaveLength(2);
  });

  it("builds a structured extraction with early-bird state from offers", () => {
    const [e] = extractLdEvents(fixture("district-event-early-bird.html"));
    const ex = structuredExtraction(e!, "When Chai Met Toast", now);
    expect(ex).toMatchObject({
      is_show_announcement: true,
      artist_names: ["When Chai Met Toast"],
      venue: "The Humming Tree",
      date: "2026-11-07",
      early_bird: { status: "open", closes_at: "2026-10-16T18:29:00.000Z" },
      sale_starts_at: "2026-10-16T18:30:00.000Z",
      ticket_url: "https://www.district.in/events/when-chai-met-toast-live-bengaluru-buy-tickets",
    });
    expect(ex.tiers.map((t) => `${t.name}:${t.price_inr}:${t.status}`)).toEqual(["Early Bird:799:open", "Phase 2:1099:upcoming", "Gate Price:1499:upcoming"]);
  });

  it("only attaches structured data when a watched artist is named", () => {
    const items = ldEventsToItems(fixture("district-listing-bengaluru.html"), "district", "District", WATCHLIST, {}, now);
    expect(items).toHaveLength(3);
    expect(items.filter((i) => i.meta.structured).map((i) => i.meta.artistId)).toEqual([1, 2]);
    const cands = toCandidates(items[0]!.meta.structured as never, items[0]!.text, now);
    expect(cands[0]).toMatchObject({ artistName: "Prateek Kuhad", city: "Bengaluru", date: "2026-12-12" });
  });
});

describe("DistrictSource", () => {
  const routes = (): Record<string, string> => ({
    [districtListingUrl("bengaluru")]: fixture("district-listing-bengaluru.html"),
    "https://cdn.district.in/sitemap/event-detail-pages.xml": DETAIL_SITEMAP,
    "https://www.district.in/events/lifafa-live-in-pune-2026-buy-tickets": fixture("district-event-early-bird.html")
      .replaceAll("When Chai Met Toast", "Lifafa")
      .replaceAll("when-chai-met-toast-live-bengaluru", "lifafa-live-in-pune-2026")
      .replace("Bengaluru, Karnataka 560038", "Pune, Maharashtra"),
  });

  it("reads city listings plus sitemap detail pages for watched artists only", async () => {
    const f = fakeFetcher(routes());
    const src = new DistrictSource(f, 60);
    const items = await src.fetchNewItems(ctx());
    // Listing gives 3; sitemap adds Lifafa (WCMT is already in the listing; kidzania isn't watched).
    expect(items.map((i) => i.url)).toContain("https://www.district.in/events/lifafa-live-in-pune-2026-buy-tickets");
    expect(f.calls).not.toContain("https://www.district.in/events/kidzania-mumbai-buy-tickets");
    expect(f.calls.filter((c) => c.includes("when-chai-met-toast"))).toHaveLength(0);
    // Other cities 404 in this fixture set, but the run still produced items, so it's healthy.
    expect(src.health()).toMatchObject({ ok: true, itemCount: 4 });
  });

  it("skips runs inside its polling interval", async () => {
    const src = new DistrictSource(fakeFetcher(routes()), 60);
    const c = ctx({ cursors: { "district:last": "2026-10-11T05:30:00.000Z" } });
    expect(await src.fetchNewItems(c)).toEqual([]);
    expect(src.health().skipped).toBe(true);
  });

  it("reports failure when everything errors", async () => {
    const src = new DistrictSource(fakeFetcher({}), 60);
    expect(await src.fetchNewItems(ctx())).toEqual([]);
    expect(src.health()).toMatchObject({ ok: false, itemCount: 0 });
  });
});

describe("BookMyShowSource", () => {
  it("detects the Cloudflare challenge", () => {
    expect(looksLikeBotChallenge(403, fixture("bookmyshow-challenge.html"))).toBe(true);
    expect(looksLikeBotChallenge(200, fixture("bookmyshow-listing.html"))).toBe(false);
  });

  it("reports blocked and stops after the first challenge", async () => {
    const f = fakeFetcher({ [bookMyShowListingUrl("bengaluru")]: new BlockedError(bookMyShowListingUrl("bengaluru")) });
    const src = new BookMyShowSource(f, 60);
    expect(await src.fetchNewItems(ctx())).toEqual([]);
    expect(f.calls).toHaveLength(1);
    expect(src.health()).toMatchObject({ ok: false, blocked: true });
  });

  it("parses listings when pages are served", async () => {
    const f = fakeFetcher({ [bookMyShowListingUrl("mumbai")]: fixture("bookmyshow-listing.html") });
    const items = await new BookMyShowSource(f, 60).fetchNewItems(ctx());
    expect(items.map((i) => i.meta.title)).toEqual(["Lifafa - Jaago Tour, Mumbai", "Sufi Night with Unknown Ensemble"]);
    expect(items[0]!.meta.structured).toMatchObject({ city: "Mumbai", date: "2026-11-28", venue: "NSCI Dome: Mumbai" });
  });
});

describe("SkillboxSource", () => {
  it("keeps recent sitemap events whose slug names a watched artist", async () => {
    const f = fakeFetcher({ "https://www.skillboxes.com/media/sitemap/sitemap-event.xml": fixture("skillbox-sitemap.xml") });
    const items = await new SkillboxSource(f, 60).fetchNewItems(ctx());
    // Old (April) and unwatched (Kayan, dance workshop) entries are dropped. "lifafa-kitchen-pop-up"
    // names Lifafa as a whole token, so it passes the cheap filter; the extractor decides later.
    expect(items.map((i) => i.url)).toEqual([
      "https://www.skillboxes.com/events/the-local-train-live-in-pune-sbqwerty",
      "https://www.skillboxes.com/events/lifafa-kitchen-pop-up-sbpopupx",
    ]);
    expect(items[0]!.text).toContain('"the local train live in pune"');
  });

  it("matches short names only as whole slug tokens", () => {
    expect(artistInSlug("https://x/events/lifafa-live-sb123456", WATCHLIST)?.id).toBe(3);
    expect(artistInSlug("https://x/events/lifafalicious-night", WATCHLIST)).toBeNull();
  });
});
