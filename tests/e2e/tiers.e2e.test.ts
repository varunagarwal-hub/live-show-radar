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
const URL = "https://www.district.in/events/when-chai-met-toast-live-bengaluru-buy-tickets";
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
