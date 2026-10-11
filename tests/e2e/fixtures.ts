import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createLlm, type Llm, type TelegramSink } from "@radar/core";
import { DistrictSource, districtListingUrl, type RawItem, type Source, type SourceHealth } from "@radar/sources";

export const NOW = new Date("2026-10-11T06:00:00Z");

/** A source that returns fixed items, for the dry-run cycle. */
export class FixtureSource implements Source {
  constructor(
    readonly name: RawItem["source"],
    private readonly items: RawItem[],
  ) {}
  async fetchNewItems(): Promise<RawItem[]> {
    return this.items;
  }
  health(): SourceHealth {
    return { ok: true, itemCount: this.items.length, error: null };
  }
}

export const IG_PRATEEK: RawItem = {
  source: "instagram",
  externalId: "17900000000000001",
  url: "https://www.instagram.com/p/PRATEEK1/",
  text: "Instagram post by @prateekkuhad:\nBENGALURU 🖤 12 December at Phoenix Marketcity Arena. Early bird live NOW till Friday midnight. Tickets: https://www.district.in/events/prateek-kuhad-silhouettes-india-tour-bengaluru-2026-buy-tickets",
  imageUrl: "https://scontent.cdninstagram.com/poster1.jpg",
  image: { mime: "image/jpeg", data: Buffer.from("poster-bytes") },
  publishedAt: new Date("2026-10-11T04:30:00Z"),
  meta: { handle: "prateekkuhad", kind: "artist", artistId: 1 },
};

export const NEWS_PRATEEK: RawItem = {
  source: "news",
  externalId: "CBMiNEWS1",
  url: "https://news.google.com/rss/articles/CBMiNEWS1",
  text: "News headline: Prateek Kuhad announces India tour, Bengaluru show on December 12\nPublisher: Rolling Stone India",
  publishedAt: new Date("2026-10-11T05:00:00Z"),
  meta: { artistId: 1 },
};

export const IG_PROMOTER_TEASER: RawItem = {
  source: "instagram",
  externalId: "17900000000000002",
  url: "https://www.instagram.com/p/TEASE1/",
  text: "Instagram post by @someblrpromoter (promoter, Bengaluru):\nSomething special for Lifafa fans… Bengaluru, November 👀",
  imageUrl: null,
  publishedAt: new Date("2026-10-11T03:00:00Z"),
  meta: { handle: "someblrpromoter", kind: "promoter", artistId: null },
};

export const NEWS_UNRELATED: RawItem = {
  source: "news",
  externalId: "CBMiNEWS2",
  url: "https://news.google.com/rss/articles/CBMiNEWS2",
  text: "News headline: Ten albums to hear this week\nPublisher: Some Blog",
  meta: {},
};

const RESPONSES: [RegExp, object][] = [
  [
    /BENGALURU 🖤 12 December/,
    {
      is_show_announcement: true,
      artist_names: ["Prateek Kuhad"],
      city: "Bengaluru",
      venue: "Phoenix Marketcity Arena",
      date: "2026-12-12",
      end_date: null,
      event_type: "concert",
      tiers: [{ name: "Early Bird", price_inr: 1299, status: "open" }],
      early_bird: { status: "open", opens_at: null, closes_at: "2026-10-16T23:59:00+05:30" },
      sale_starts_at: null,
      ticket_url: null,
      confidence: 0.92,
      evidence: "BENGALURU 🖤 12 December at Phoenix Marketcity Arena. Early bird live NOW",
      other_dates: [],
      country: "India",
    },
  ],
  [
    /announces India tour, Bengaluru show on December 12/,
    {
      is_show_announcement: true,
      artist_names: ["Prateek Kuhad"],
      city: "Bangalore",
      venue: null,
      date: "2026-12-12",
      end_date: null,
      event_type: "concert",
      tiers: [],
      early_bird: { status: "unknown", opens_at: null, closes_at: null },
      sale_starts_at: null,
      ticket_url: null,
      confidence: 0.75,
      evidence: "Bengaluru show on December 12",
      other_dates: [],
      country: "India",
    },
  ],
  [
    /Something special for Lifafa fans/,
    {
      is_show_announcement: true,
      artist_names: ["Lifafa"],
      city: "Bengaluru",
      venue: null,
      date: null,
      end_date: null,
      event_type: "concert",
      tiers: [],
      early_bird: { status: "unknown", opens_at: null, closes_at: null },
      sale_starts_at: null,
      ticket_url: null,
      confidence: 0.4,
      evidence: "Something special for Lifafa fans… Bengaluru, November",
      other_dates: [],
      country: "India",
    },
  ],
];

/** Replays recorded model answers by matching the prompt; counts calls so tests can assert budgets. */
export function fixtureLlm(): Llm & { calls: number } {
  const state = { calls: 0 };
  const llm = createLlm([
    {
      name: "fixture",
      supportsImages: true,
      async complete(req) {
        state.calls++;
        if (req.task === "verify-match") return JSON.stringify({ same_artist: true, confidence: 0.9, reason: "fixture" });
        const hit = RESPONSES.find(([re]) => re.test(req.user));
        if (!hit) return JSON.stringify({ is_show_announcement: false, artist_names: [], confidence: 0.1, evidence: "" });
        return JSON.stringify(hit[1]);
      },
    },
  ]);
  return Object.assign(llm, {
    get calls() {
      return state.calls;
    },
  });
}

export function recordingSink(): TelegramSink & { messages: { chatId: string; html: string; silent: boolean }[] } {
  const messages: { chatId: string; html: string; silent: boolean }[] = [];
  return {
    messages,
    async sendMessage(chatId, html, opts) {
      messages.push({ chatId, html, silent: opts?.silent ?? false });
      return { messageId: messages.length };
    },
    async sendDocument() {
      return { messageId: 0 };
    },
    async answerCallback() {},
    async editKeyboard() {},
  };
}

/** The real District adapter, fed the saved listing page instead of the network. */
export function districtFromFixture(): DistrictSource {
  const html = readFileSync(join(import.meta.dirname, "../../packages/sources/test/fixtures/district-listing-bengaluru.html"), "utf8");
  return new DistrictSource(async (url) => {
    if (url === districtListingUrl("bengaluru")) return html;
    if (url.includes("sitemap")) return `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`;
    throw new Error(`HTTP 404 for ${url}`);
  }, 60);
}
