/** Tier watcher against saved District pages: each change alerts once; unchanged pages cost nothing. */
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { emptyJobState } from "@radar/core";
import { connectPglite } from "@radar/core/db/pglite";
import type { DbHandle } from "@radar/core/db";
import { artists, decisions, events, tierSnapshots } from "@radar/core/db/schema";
import { loadSnapshot } from "@radar/core/db/queries";
import { runTiers } from "../../jobs/lib/tiers-pipeline";
import { fixtureLlm, recordingSink } from "./fixtures";

const page = (name: string) => readFileSync(join(import.meta.dirname, "../../packages/sources/test/fixtures", name), "utf8");
const URL = "https://www.skillboxes.com/events/when-chai-met-toast-live-bengaluru-buy-tickets";
let h: DbHandle;
const state = emptyJobState();
const tg = recordingSink();

const tick = async (now: Date, html: string, opened?: { v: boolean }) =>
  runTiers({
    getDb: async () => {
      if (opened) opened.v = true;
      return h;
    },
    llm: () => fixtureLlm(),
    tg,
    chatId: "TEST_CHAT",
    dryRun: true,
    state,
    snapshot: await loadSnapshot(h, now),
    now,
    log: () => {},
    fetchPage: async () => html,
  });

beforeAll(async () => {
  h = await connectPglite();
  await h.db.insert(artists).values({ id: 2, name: "When Chai Met Toast", priorityTier: "B" });
  await h.db.insert(events).values({ id: 10, artistId: 2, city: "Bengaluru", date: "2026-11-07", fingerprint: "2|bengaluru|2026-11-07", confidence: 0.95, ticketUrl: URL, urgency: "urgent" });
  await h.db.insert(decisions).values({ eventId: 10, status: "maybe", via: "telegram" });
}, 60_000);

describe("tier watcher", () => {
  it("alerts when early-bird opens and tickets run low", async () => {
    const r = await tick(new Date("2026-10-11T06:00:00Z"), page("district-event-early-bird.html"));
    expect(r.stats.tierAlerts).toBe(2);
    expect(tg.messages.map((m) => m.html.split("\n")[0])).toEqual([
      "🎟 <b>When Chai Met Toast, Bengaluru: Early-bird is open</b>",
      "🎟 <b>When Chai Met Toast, Bengaluru: Tickets are running low</b>",
    ]);
    expect((await h.db.select().from(events).where(eq(events.id, 10)))[0]!.earlyBirdStatus).toBe("open");
  });

  it("does not re-alert or touch the database for an unchanged page", async () => {
    const opened = { v: false };
    const before = tg.messages.length;
    // Snapshot is loaded by the test harness; the job itself must not open the DB.
    const r = await tick(new Date("2026-10-11T06:15:00Z"), page("district-event-early-bird.html"), opened);
    expect(tg.messages.length).toBe(before);
    expect(r.dbOpened).toBe(false);
    expect(await h.db.select().from(tierSnapshots)).toHaveLength(1);
  });

  it("alerts once when early-bird closes, then once when it sells out", async () => {
    await tick(new Date("2026-10-17T00:00:00Z"), page("district-event-early-bird.html"));
    await tick(new Date("2026-10-17T00:15:00Z"), page("district-event-early-bird.html"));
    await tick(new Date("2026-10-20T00:00:00Z"), page("district-event-sold-out.html"));
    await tick(new Date("2026-10-20T00:15:00Z"), page("district-event-sold-out.html"));
    const heads = tg.messages.map((m) => m.html.split("\n")[0]);
    expect(heads.filter((x) => x?.includes("Early-bird has closed"))).toHaveLength(1);
    expect(heads.filter((x) => x?.includes("Sold out"))).toHaveLength(1);
    expect(await h.db.select().from(tierSnapshots)).toHaveLength(3);
  });

  it("sends the decide-by reminder for a Maybe show once, even across late runs", async () => {
    await h.db.update(events).set({ earlyBirdStatus: "open", earlyBirdClosesAt: new Date("2026-10-30T18:29:00Z"), tiers: [{ name: "Early Bird", price_inr: 799, status: "open" }] }).where(eq(events.id, 10));
    const before = tg.messages.length;
    await tick(new Date("2026-10-29T20:00:00Z"), page("district-event-sold-out.html"));
    await tick(new Date("2026-10-29T20:47:00Z"), page("district-event-sold-out.html"));
    const reminders = tg.messages.slice(before).filter((m) => m.html.startsWith("⏰"));
    expect(reminders).toHaveLength(1);
    expect(reminders[0]!.html).toContain("Decide on When Chai Met Toast");
  });
});

describe("booking lookup", () => {
  it("stores the booking page from the artist's link-in-bio, and searches only for shows Karan is going to", async () => {
    await h.db.insert(artists).values({ id: 3, name: "Anuv Jain", priorityTier: "A", bioUrl: "https://linktr.ee/anuvjainshows" });
    await h.db.insert(events).values([
      { id: 20, artistId: 3, city: "Goa", date: "2026-11-01", fingerprint: "3|goa|2026-11-01", confidence: 0.9, urgency: "normal" },
      { id: 21, artistId: 3, city: "Pune", date: "2026-11-08", fingerprint: "3|pune|2026-11-08", confidence: 0.9, urgency: "normal" },
      { id: 22, artistId: 3, city: "Kochi", date: "2026-11-15", fingerprint: "3|kochi|2026-11-15", confidence: 0.9, urgency: "normal" },
    ]);
    await h.db.insert(decisions).values({ eventId: 21, status: "going", via: "dashboard" });
    const searched: string[] = [];
    const now = new Date("2026-10-30T00:00:00Z");
    await runTiers({
      getDb: async () => h,
      llm: () => fixtureLlm(),
      tg,
      chatId: "TEST_CHAT",
      dryRun: true,
      state,
      snapshot: await loadSnapshot(h, now),
      now,
      log: () => {},
      fetchPage: async () => page("district-event-sold-out.html"),
      linkPage: async () => [{ title: "Oktoberfest | Goa - 1st November 2026", url: "https://www.district.in/events/oktoberfest-goa-2026-oct30-2026-buy-tickets" }],
      searchBooking: async (s) => {
        searched.push(s.city);
        return s.city === "Pune" ? "https://in.bookmyshow.com/events/anuv-jain-live-pune/ET00500001" : null;
      },
    });
    const rows = await h.db.select({ id: events.id, url: events.bookingUrl, checked: events.bookingCheckedAt }).from(events);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(20)!.url).toBe("https://www.district.in/events/oktoberfest-goa-2026-oct30-2026-buy-tickets");
    expect(byId.get(21)!.url).toBe("https://in.bookmyshow.com/events/anuv-jain-live-pune/ET00500001");
    // Kochi: not in the bio, not going, so no web search: checked, left without a link.
    expect(byId.get(22)!.url).toBeNull();
    expect(byId.get(22)!.checked).not.toBeNull();
    expect(searched).toEqual(["Pune"]);
  });
});

describe("booking lookup with a stale snapshot", () => {
  it("never erases a link stored after the snapshot was taken", async () => {
    const now = new Date("2026-10-31T00:00:00Z");
    const stale = await loadSnapshot(h, now);
    await h.db.update(events).set({ bookingUrl: "https://in.bookmyshow.com/events/anuv-jain-kochi/ET00500002" }).where(eq(events.id, 22));
    for (const e of stale.upcoming) e.bookingCheckedAt = null;
    await runTiers({
      getDb: async () => h, llm: () => fixtureLlm(), tg, chatId: "TEST_CHAT", dryRun: true, state, snapshot: stale, now, log: () => {},
      fetchPage: async () => page("district-event-sold-out.html"),
      linkPage: async () => [],
      searchBooking: async () => null,
    });
    const [row] = await h.db.select({ url: events.bookingUrl }).from(events).where(eq(events.id, 22));
    expect(row!.url).toBe("https://in.bookmyshow.com/events/anuv-jain-kochi/ET00500002");
  });
});
