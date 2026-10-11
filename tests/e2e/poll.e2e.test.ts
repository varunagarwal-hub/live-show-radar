/**
 * `pnpm test:e2e-dry`: one full poll cycle in dry-run mode against fixtures — real sources code
 * (District parser on a saved page), real pipeline, real schema (PGlite), recorded LLM answers,
 * and a recording Telegram sink standing in for the test chat.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { emptyJobState } from "@radar/core";
import { connectPglite } from "@radar/core/db/pglite";
import type { DbHandle } from "@radar/core/db";
import { alerts, artists, events, eventSources, rawItems } from "@radar/core/db/schema";
import { runPoll } from "../../jobs/lib/poll-pipeline";
import { districtFromFixture, FixtureSource, fixtureLlm, IG_PRATEEK, IG_PROMOTER_TEASER, NEWS_PRATEEK, NEWS_UNRELATED, NOW, recordingSink } from "./fixtures";

let h: DbHandle;
const state = emptyJobState();
const tg = recordingSink();
const llm = fixtureLlm();

const run = (now = NOW) =>
  runPoll({
    getDb: async () => h,
    llm,
    tg,
    chatId: "TEST_CHAT",
    dryRun: true,
    sources: [
      new FixtureSource("instagram", [IG_PRATEEK, IG_PROMOTER_TEASER]),
      districtFromFixture(),
      new FixtureSource("news", [NEWS_PRATEEK, NEWS_UNRELATED]),
    ],
    state,
    snapshot: null,
    now,
    log: () => {},
  });

beforeAll(async () => {
  h = await connectPglite();
  await h.db.insert(artists).values([
    { id: 1, name: "Prateek Kuhad", priorityTier: "A", followed: true, instagramHandle: "prateekkuhad", handleStatus: "confirmed", spotifyId: "0tC995Rfn9k2l7nqgCZsV7" },
    { id: 2, name: "When Chai Met Toast", priorityTier: "C", followed: true, instagramHandle: "whenchaimettoast", handleStatus: "unconfirmed" },
    { id: 3, name: "Lifafa", priorityTier: "B", followed: true },
  ]);
}, 60_000);

describe("dry-run poll cycle", () => {
  it("alerts exactly once per show, merges sources, and sends nothing to the real chat", async () => {
    const r = await run();
    expect(r.stats.fetched_district).toBe(3);
    // The unrelated headline and the unwatched District listing never reach the LLM or DB.
    const stored = await h.db.select().from(rawItems);
    expect(stored.map((s) => s.externalId)).not.toContain("CBMiNEWS2");
    expect(stored.find((s) => s.externalId.includes("bankai"))).toBeUndefined();

    const evs = await h.db.select().from(events);
    const prateek = evs.find((e) => e.artistId === 1)!;
    expect(prateek).toMatchObject({ city: "Bengaluru", date: "2026-12-12", urgency: "urgent", status: "announced", venue: "Phoenix Marketcity Arena", earlyBirdStatus: "open" });
    // Ticket URL filled in by District (Instagram's link was in the caption too); history recorded.
    expect(prateek.ticketUrl).toBe("https://www.district.in/events/prateek-kuhad-silhouettes-india-tour-bengaluru-2026-buy-tickets");
    const srcs = await h.db.select().from(eventSources).where(eq(eventSources.eventId, prateek.id));
    expect(new Set(srcs.map((s) => s.source))).toEqual(new Set(["instagram", "district", "news"]));

    // One loud alert for Prateek (tier A → 🔴), one for When Chai Met Toast (District, upcoming sale),
    // one quiet possible-show note for the Lifafa teaser. All to the test chat, all marked dry-run.
    const loud = tg.messages.filter((m) => !m.silent);
    const quiet = tg.messages.filter((m) => m.silent);
    expect(loud.filter((m) => m.html.includes("Prateek Kuhad"))).toHaveLength(1);
    expect(loud.find((m) => m.html.includes("Prateek Kuhad"))!.html).toMatch(/^🔴 <b>Prateek Kuhad<\/b> · tier A/);
    expect(loud.find((m) => m.html.includes("Prateek Kuhad"))!.html).toContain("Early-bird ends Fri 11:59 PM");
    expect(loud.filter((m) => m.html.includes("When Chai Met Toast"))).toHaveLength(1);
    expect(quiet).toHaveLength(1);
    expect(quiet[0]!.html).toContain("Possible show, please check");
    expect(tg.messages.every((m) => m.chatId === "TEST_CHAT")).toBe(true);
    const al = await h.db.select().from(alerts);
    expect(al.every((a) => a.dryRun)).toBe(true);
  });

  it("does nothing on the next cycle when nothing changed (no LLM calls, no alerts, no DB)", async () => {
    const before = { msgs: tg.messages.length, llm: llm.calls };
    let opened = false;
    const r = await runPoll({
      getDb: async () => ((opened = true), h),
      llm,
      tg,
      chatId: "TEST_CHAT",
      dryRun: true,
      sources: [new FixtureSource("instagram", [IG_PRATEEK, IG_PROMOTER_TEASER]), new FixtureSource("news", [NEWS_PRATEEK, NEWS_UNRELATED])],
      state: { ...state, lastFlushAt: NOW.toISOString() },
      snapshot: (await run()).snapshot, // warm snapshot, as restored from the Actions cache
      now: new Date(NOW.getTime() + 30 * 60_000),
      log: () => {},
    });
    expect(tg.messages.length).toBe(before.msgs);
    expect(llm.calls).toBe(before.llm);
    expect(r.stats.new).toBe(0);
    expect(opened).toBe(false);
  });

  it("upgrades a possible show into one real alert when a confident source confirms it", async () => {
    const confirm = {
      ...IG_PROMOTER_TEASER,
      externalId: "17900000000000003",
      text: "Instagram post by @lifafa:\nBLR aa rahe hain!! 13 Dec ko Fandom at Gilly's",
      meta: { handle: "lifafa", kind: "artist", artistId: 3 },
    };
    const confirmed = { ...confirm, text: confirm.text };
    const llm2 = fixtureLlm();
    const sink = recordingSink();
    // Teach the replay LLM the confirming post: undated teaser + dated confirmation for the same city.
    const r = await runPoll({
      getDb: async () => h,
      llm: {
        generateJson: async (req, schema) =>
          req.user.includes("BLR aa rahe hain")
            ? { provider: "fixture", data: schema.parse({ is_show_announcement: true, artist_names: ["Lifafa"], city: "Bengaluru", venue: "Fandom at Gilly's", date: "2026-12-13", event_type: "concert", tiers: [], early_bird: { status: "unknown", opens_at: null, closes_at: null }, confidence: 0.9, evidence: "13 Dec ko Fandom", other_dates: [], country: "India" }) }
            : llm2.generateJson(req, schema),
      },
      tg: sink,
      chatId: "TEST_CHAT",
      dryRun: true,
      sources: [new FixtureSource("instagram", [confirmed])],
      state,
      snapshot: null,
      now: new Date(NOW.getTime() + 60 * 60_000),
      log: () => {},
    });
    expect(r.stats.eventsMerged).toBe(1);
    const lifafa = (await h.db.select().from(events).where(eq(events.artistId, 3)))[0]!;
    expect(lifafa).toMatchObject({ status: "announced", date: "2026-12-13", fingerprint: "3|bengaluru|2026-12-13" });
    expect(sink.messages.filter((m) => !m.silent && m.html.includes("Lifafa"))).toHaveLength(1);
  });

  it("queues items when every LLM provider is down, without dropping them", async () => {
    const down = {
      generateJson: async () => {
        const { LlmUnavailableError } = await import("@radar/core");
        throw new LlmUnavailableError(["gemini: HTTP 429", "groq: HTTP 503"]);
      },
    };
    const item = { ...NEWS_PRATEEK, externalId: "CBMiNEWS9", text: "News headline: Prateek Kuhad to play Hyderabad on December 18" };
    const r = await runPoll({ getDb: async () => h, llm: down, tg: recordingSink(), chatId: "TEST_CHAT", dryRun: true, sources: [new FixtureSource("news", [item])], state, snapshot: null, now: NOW, log: () => {} });
    expect(r.stats.llmUnavailable).toBe(1);
    const row = (await h.db.select().from(rawItems).where(eq(rawItems.externalId, "CBMiNEWS9")))[0]!;
    expect(row).toMatchObject({ processed: false, processAttempts: 0 });
  });
});
