/**
 * Multi-user: the owner keeps everything they had, other people get their own artists, alerts,
 * decisions, reminders and questions, and nobody sees or changes anyone else's.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { emptyJobState, encodeCallback, handleUpdate, runAsk, AskFilterSchema, setDecision } from "@radar/core";
import { connectPglite } from "@radar/core/db/pglite";
import type { DbHandle } from "@radar/core/db";
import { followArtist, followsArtist, recipientsFor, refreshArtistGlobals } from "@radar/core/db/people";
import { loadSnapshot } from "@radar/core/db/queries";
import { upsertSpotifyArtist } from "@radar/core/db/spotify-import";
import { alerts, artists, decisions, events, follows, OWNER_USER_ID, users } from "@radar/core/db/schema";
import { runPoll } from "../../jobs/lib/poll-pipeline";
import { runTiers } from "../../jobs/lib/tiers-pipeline";
import { FixtureSource, fixtureLlm, IG_PRATEEK, NOW, recordingSink } from "./fixtures";

let h: DbHandle;
const MEMBER = 2;
const STRANGER_CHAT = "555";

beforeAll(async () => {
  h = await connectPglite();
  await h.db.insert(artists).values([
    { id: 1, name: "Prateek Kuhad", priorityTier: "A", followed: true, instagramHandle: "prateekkuhad", handleStatus: "confirmed", spotifyId: "0tC995Rfn9k2l7nqgCZsV7" },
    { id: 2, name: "When Chai Met Toast", priorityTier: "C", followed: true },
  ]);
  await h.db.insert(users).values({ id: MEMBER, email: "mentor@example.com", role: "member", calendarToken: "member-calendar-token-0123456789", telegramChatId: "222", homeCity: "Mumbai" });
  // Fixed ids above don't move the sequences; later inserts need fresh ones.
  await h.db.execute(sql`select setval(pg_get_serial_sequence('artists', 'id'), 100)`);
  await h.db.execute(sql`select setval(pg_get_serial_sequence('users', 'id'), 100)`);
}, 60_000);

describe("artists are shared, follows are personal", () => {
  it("someone following an artist the owner already had never takes it away from the owner", async () => {
    await followArtist(h, MEMBER, 1, { tier: "A" });
    const rows = await h.db.select().from(follows).where(eq(follows.artistId, 1));
    expect(rows.map((r) => r.userId).sort()).toEqual([OWNER_USER_ID, MEMBER]);
    const [owner] = await h.db.select({ ok: followsArtist(OWNER_USER_ID) }).from(artists).where(eq(artists.id, 1));
    expect(owner!.ok).toBe(true);
  });

  it("a brand-new artist added by search belongs only to whoever added it", async () => {
    const id = await upsertSpotifyArtist(h, { spotifyId: "4UXqAaa6dQYAk18Lv7PEgX", name: "Fall Out Boy", imageUrl: null });
    await followArtist(h, MEMBER, id, { tier: "B" });
    const [r] = await h.db.select({ owner: followsArtist(OWNER_USER_ID), member: followsArtist(MEMBER) }).from(artists).where(eq(artists.id, id));
    expect(r).toEqual({ owner: false, member: true });
  });

  it("an artist stays watched while anyone follows it unmuted", async () => {
    await followArtist(h, MEMBER, 1, { muted: true });
    let [a] = await h.db.select().from(artists).where(eq(artists.id, 1));
    expect(a!.muted).toBe(false); // the owner still follows it
    await h.db.update(follows).set({ muted: true }).where(eq(follows.artistId, 1));
    await refreshArtistGlobals(h, [1]);
    [a] = await h.db.select().from(artists).where(eq(artists.id, 1));
    expect(a!.muted).toBe(true);
    await h.db.update(follows).set({ muted: false }).where(eq(follows.artistId, 1));
    await refreshArtistGlobals(h, [1]);
  });
});

describe("alerts reach every follower in their own chat", () => {
  it("a new show alerts the owner and the member once each, and not people who don't follow the artist", async () => {
    expect((await recipientsFor(h, 1)).map((r) => r.userId).sort()).toEqual([OWNER_USER_ID, MEMBER]);
    const tg = recordingSink();
    await runPoll({
      getDb: async () => h,
      llm: fixtureLlm(),
      tg,
      chatId: "OWNER_CHAT",
      dryRun: false,
      sources: [new FixtureSource("instagram", [IG_PRATEEK])],
      state: emptyJobState(),
      snapshot: null,
      now: NOW,
      log: () => {},
    });
    const prateek = tg.messages.filter((m) => m.html.includes("Prateek Kuhad"));
    expect(prateek.map((m) => m.chatId).sort()).toEqual(["222", "OWNER_CHAT"]);
    const keys = (await h.db.select({ k: alerts.dedupKey, u: alerts.userId }).from(alerts)).map((a) => `${a.u}:${a.k}`);
    expect(keys.some((k) => k.startsWith(`${MEMBER}:u${MEMBER}:new:`))).toBe(true);
    expect(keys.some((k) => /^1:new:\d+$/.test(k))).toBe(true);
  });
});

describe("decisions, questions and reminders are personal", () => {
  let eventId: number;
  beforeAll(async () => {
    const [e] = await h.db.select().from(events).where(eq(events.artistId, 1));
    eventId = e!.id;
  });

  it("each person's decision is their own", async () => {
    await setDecision(h, eventId, "going", "dashboard", NOW, OWNER_USER_ID);
    await setDecision(h, eventId, "maybe", "telegram", NOW, MEMBER);
    const rows = await h.db.select().from(decisions).where(eq(decisions.eventId, eventId));
    expect(Object.fromEntries(rows.map((r) => [r.userId, r.status]))).toEqual({ [OWNER_USER_ID]: "going", [MEMBER]: "maybe" });
  });

  it("questions only see the asker's artists and decisions", async () => {
    const going = AskFilterSchema.parse({ decision_status: ["going"], date_from: "2026-10-01" });
    expect((await runAsk(h, going, NOW, OWNER_USER_ID)).map((r) => r.id)).toContain(eventId);
    expect(await runAsk(h, going, NOW, MEMBER)).toEqual([]);
    const all = AskFilterSchema.parse({ date_from: "2026-10-01" });
    const wcmt = await h.db.insert(events).values({ artistId: 2, city: "Pune", date: "2026-12-01", fingerprint: "2|pune|2026-12-01", confidence: 0.95 }).returning();
    expect((await runAsk(h, all, NOW, MEMBER)).map((r) => r.id)).not.toContain(wcmt[0]!.id);
  });

  it("Telegram buttons decide for whoever tapped them; unknown chats are ignored", async () => {
    const tg = recordingSink();
    const deps = { h, tg, allowedChats: new Set(["111"]), llm: () => fixtureLlm(), now: NOW };
    const tap = (chat: number, status: "going" | "pass") => ({
      update_id: 1,
      callback_query: { id: "cb", data: encodeCallback({ kind: "decide", status, eventId }), message: { message_id: 9, chat: { id: chat } } },
    });
    await handleUpdate(tap(222, "pass"), deps);
    expect(await handleUpdate(tap(Number(STRANGER_CHAT), "pass"), deps)).toBe("ignored");
    const rows = await h.db.select().from(decisions).where(eq(decisions.eventId, eventId));
    expect(Object.fromEntries(rows.map((r) => [r.userId, r.status]))).toEqual({ [OWNER_USER_ID]: "going", [MEMBER]: "pass" });
  });

  it("/start with someone's one-time code connects their chat, once", async () => {
    await h.db.insert(users).values({ id: 3, email: "friend@example.com", role: "member", calendarToken: "friend-calendar-token-0123456789", telegramLinkToken: "LINKCODE1234" });
    const tg = recordingSink();
    const deps = { h, tg, allowedChats: new Set(["111"]), llm: () => fixtureLlm(), now: NOW };
    const start = (chat: number) => ({ update_id: 2, message: { message_id: 1, chat: { id: chat }, text: "/start LINKCODE1234" } });
    expect(await handleUpdate(start(333), deps)).toBe("handled");
    const [u] = await h.db.select().from(users).where(eq(users.id, 3));
    expect(u).toMatchObject({ telegramChatId: "333", telegramLinkToken: null });
    expect(tg.messages[0]!.html).toContain("You're connected");
    // The code is spent: another chat can't reuse it.
    expect(await handleUpdate(start(444), deps)).toBe("ignored");
  });

  it("sale reminders go to each follower who hasn't said no, in their own chat", async () => {
    const saleAt = new Date(NOW.getTime() + 20 * 60_000);
    await h.db.update(events).set({ saleStartsAt: saleAt, date: "2026-12-12" }).where(eq(events.id, eventId));
    await h.db.update(decisions).set({ status: "maybe" }).where(and(eq(decisions.eventId, eventId), eq(decisions.userId, MEMBER)));
    const tg = recordingSink();
    await runTiers({
      getDb: async () => h,
      llm: () => fixtureLlm(),
      tg,
      chatId: "OWNER_CHAT",
      dryRun: false,
      state: emptyJobState(),
      snapshot: await loadSnapshot(h, NOW),
      now: NOW,
      log: () => {},
      fetchPage: async () => "",
      linkPage: async () => [],
      searchBooking: async () => null,
    });
    const sale = tg.messages.filter((m) => m.html.includes("go on sale"));
    expect(sale.map((m) => m.chatId).sort()).toEqual(["222", "OWNER_CHAT"]);
  });
});
