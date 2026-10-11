import { describe, expect, it } from "vitest";
import { NewsSource, newsFeedUrl, newsQuery, parseNewsFeed } from "../src/news";
import { InstagramSource, appUsagePercent, planTargets, posterUrl, type InstagramConfig } from "../src/instagram";
import { exchangeToken, openToken, sealToken, daysLeft } from "../src/instagram-token";
import { emailToRawItem, cleanEmailBody } from "../src/email";
import { parseTierPage } from "../src/tier-page";
import { diffTierState, tierStateHash, type TierState, HttpError, isAllowed, parseRobots } from "@radar/core";
import { ctx, fakeFetcher, fixture, WATCHLIST } from "./helpers";

const now = new Date("2026-10-11T06:00:00Z");

describe("news", () => {
  it("builds the spec's query", () => {
    expect(newsQuery("Prateek Kuhad")).toBe('"Prateek Kuhad" (India OR Bengaluru OR Mumbai) concert OR tour');
    expect(newsFeedUrl("Lifafa")).toContain("hl=en-IN&gl=IN&ceid=IN:en");
  });

  it("keeps recent articles that name the artist", () => {
    const items = parseNewsFeed(fixture("google-news.xml"), WATCHLIST[0]!, now);
    expect(items).toHaveLength(1);
    expect(items[0]!.text).toContain("Bengaluru on December 12");
    expect(items[0]!.externalId).toBe("CBMiAAA1");
  });

  it("polls overdue artists first and records cursors", async () => {
    const f = fakeFetcher({ [newsFeedUrl("Prateek Kuhad")]: fixture("google-news.xml") });
    const c = ctx({ cursors: { "news:2": now.toISOString(), "news:3": now.toISOString(), "news:4": now.toISOString() } });
    const items = await new NewsSource(f).fetchNewItems(c);
    expect(f.calls).toEqual([newsFeedUrl("Prateek Kuhad")]);
    expect(items).toHaveLength(1);
    expect(c.cursors["news:1"]).toBe(now.toISOString());
  });
});

describe("robots.txt", () => {
  const district = `User-Agent: *\nAllow: /\nDisallow: /profile\nDisallow: /*?\nDisallow: */order/*\n\nUser-Agent: GPTBot\nDisallow: /`;
  it("applies the * group with wildcards and longest match", () => {
    const r = parseRobots(district, "Mozilla/5.0 Chrome");
    expect(isAllowed(r, "/events/music-in-bengaluru-book-tickets")).toBe(true);
    expect(isAllowed(r, "/events/x?utm=1")).toBe(false);
    expect(isAllowed(r, "/events/123/order/abc")).toBe(false);
  });
  it("uses a specific group when the agent matches", () => {
    expect(isAllowed(parseRobots(district, "GPTBot/1.0"), "/events/x")).toBe(false);
  });
});

describe("instagram", () => {
  const cfg: InstagramConfig = {
    userId: "17841400000000000",
    accessToken: "token-abc",
    version: "v25.0",
    callsPerHour: 4,
    postsPerCall: 6,
    pollMinutes: 30,
    intervals: { A: 30, B: 60, C: 120, account: 30 },
  };

  it("plans the most overdue handles within the per-run budget", () => {
    const targets = planTargets(cfg, {
      ...ctx({ accounts: [{ handle: "fandomatgilly", kind: "venue", city: "Bengaluru" }] }),
      cursors: { "ig:prateekkuhad": "2026-10-11T05:00:00Z" },
    });
    // budget = 4 calls/hour * 30/60 = 2; never-polled handles come first.
    expect(targets.map((t) => t.handle)).toEqual(["whenchaimettoast", "fandomatgilly"]);
  });

  it("reads X-App-Usage", () => {
    expect(appUsagePercent('{"call_count":87,"total_time":10,"total_cputime":5}')).toBe(87);
    expect(appUsagePercent(null)).toBe(0);
  });

  it("picks the poster from carousels and video thumbnails", () => {
    expect(posterUrl({ id: "1", media_type: "CAROUSEL_ALBUM", children: { data: [{ media_type: "VIDEO", media_url: "v" }, { media_type: "IMAGE", media_url: "i" }] } })).toBe("i");
    expect(posterUrl({ id: "2", media_type: "VIDEO", media_url: "v", thumbnail_url: "t" })).toBe("t");
  });

  it("turns posts into items, flags unresolvable handles, and downloads images only on request", async () => {
    const http = (async (url: string) => {
      if (url.includes("prateekkuhad")) {
        return new Response(
          JSON.stringify({
            business_discovery: {
              username: "prateekkuhad",
              media: {
                data: [
                  { id: "m1", caption: "BENGALURU! 12 Dec. Early bird live at 12 PM tomorrow 🎟️ link in bio", media_type: "IMAGE", media_url: "https://cdn/img1.jpg", permalink: "https://www.instagram.com/p/AAA/", timestamp: "2026-10-10T10:00:00+0000" },
                  { id: "m0", caption: "old", media_type: "IMAGE", media_url: "https://cdn/old.jpg", timestamp: "2026-08-01T10:00:00+0000" },
                ],
              },
            },
          }),
          { headers: { "x-app-usage": '{"call_count":10}' } },
        );
      }
      throw new HttpError(400, url, JSON.stringify({ error: { message: "Invalid user id", code: 110 } }));
    }) as never;
    const images: string[] = [];
    const src = new InstagramSource({ ...cfg, callsPerHour: 100 }, async (u) => (images.push(u), { mime: "image/jpeg", data: Buffer.from("x") }), http);
    const items = await src.fetchNewItems(ctx({ watchlist: [WATCHLIST[0]!, WATCHLIST[1]!] }));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ externalId: "m1", url: "https://www.instagram.com/p/AAA/", meta: { handle: "prateekkuhad", artistId: 1 } });
    expect(images).toEqual([]);
    await src.attachImages(items);
    expect(images).toEqual(["https://cdn/img1.jpg"]);
    expect(src.health().notes?.[0]).toContain("@whenchaimettoast");
  });

  it("raises a token error on code 190", async () => {
    const http = (async (url: string) => {
      throw new HttpError(400, url, JSON.stringify({ error: { message: "Session has expired", code: 190 } }));
    }) as never;
    const src = new InstagramSource({ ...cfg, callsPerHour: 100 }, async () => null, http);
    await expect(src.fetchNewItems(ctx())).rejects.toThrow(/token rejected/);
  });

  it("seals the refreshed token so the Actions cache never holds it in clear text", () => {
    const sealed = sealToken({ token: "EAAB-secret", expiresAt: "2026-12-01T00:00:00.000Z" }, "app-secret");
    expect(sealed).not.toContain("EAAB");
    expect(openToken(sealed, "app-secret")).toEqual({ token: "EAAB-secret", expiresAt: "2026-12-01T00:00:00.000Z" });
    expect(openToken(sealed, "other-secret")).toBeNull();
    expect(daysLeft({ token: "t", expiresAt: "2026-10-21T06:00:00Z" }, now)).toBeCloseTo(10);
  });

  it("exchange needs network; its shape is covered by zod", () => {
    expect(typeof exchangeToken).toBe("function");
  });
});

describe("fan-app email", () => {
  it("keeps the show part, drops footers, and finds the event link", () => {
    const item = emailToRawItem({
      messageId: "<abc@bandsintown.com>",
      subject: "Prateek Kuhad just announced a show near you",
      from: "Bandsintown <notifications@bandsintown.com>",
      date: "Sat, 10 Oct 2026 09:00:00 +0000",
      body: "Prateek Kuhad\nSat, Dec 12 · Phoenix Marketcity Arena, Bengaluru\nhttps://www.bandsintown.com/e/1034567890\n\nYou are receiving this because you track Prateek Kuhad. Unsubscribe: https://x",
    });
    expect(item.url).toBe("https://www.bandsintown.com/e/1034567890");
    expect(item.text).not.toMatch(/unsubscribe/i);
    expect(item.meta.knownSender).toBe(true);
  });

  it("caps body length", () => {
    expect(cleanEmailBody("a".repeat(20_000)).length).toBe(8000);
  });
});

describe("tier page parsing", () => {
  it("reads early-bird and scarcity from a District event page, ignoring FAQ text", () => {
    const s = parseTierPage(fixture("district-event-early-bird.html"), now);
    expect(s.parseable).toBe(true);
    expect(s.earlyBirdStatus).toBe("open");
    expect(s.availability).toBe("fast_filling");
    expect(s.tiers.map((t) => t.status)).toEqual(["open", "upcoming", "upcoming"]);
  });

  it("detects sold out", () => {
    const s = parseTierPage(fixture("district-event-sold-out.html"), now);
    expect(s.tiers.every((t) => t.status === "sold_out")).toBe(true);
    expect(s.earlyBirdStatus).toBe("sold_out");
  });

  it("marks pages without offers unparseable (LLM fallback)", () => {
    expect(parseTierPage("<html><body><h1>Tickets</h1><p>Early bird ₹799</p></body></html>", now)).toMatchObject({ parseable: false });
  });

  it("produces each change once and nothing for an unchanged page", () => {
    const open = parseTierPage(fixture("district-event-early-bird.html"), now) as TierState;
    const later = new Date("2026-10-17T00:00:00Z"); // EB window ended, Phase 2 open
    const phase2 = parseTierPage(fixture("district-event-early-bird.html"), later) as TierState;
    const sold = parseTierPage(fixture("district-event-sold-out.html"), later) as TierState;
    expect(diffTierState(null, open)).toEqual(["early_bird_opened", "low_availability"]);
    expect(diffTierState(open, open)).toEqual([]);
    expect(tierStateHash(open)).toBe(tierStateHash({ ...open }));
    expect(diffTierState(open, phase2)).toEqual(["early_bird_closed"]);
    expect(diffTierState(phase2, sold)).toEqual(["sold_out"]);
    expect(diffTierState(sold, sold)).toEqual([]);
  });

  it("flags the next price phase", () => {
    const a: TierState = { tiers: [{ name: "Phase 1", price_inr: 999, status: "open" }, { name: "Phase 2", price_inr: 1299, status: "upcoming" }], earlyBirdStatus: "none", availability: null, method: "html" };
    const b: TierState = { ...a, tiers: [{ name: "Phase 1", price_inr: 999, status: "sold_out" }, { name: "Phase 2", price_inr: 1299, status: "open" }] };
    expect(diffTierState(a, b)).toEqual(["next_phase"]);
  });
});
