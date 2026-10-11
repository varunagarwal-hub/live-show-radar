import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { connectPglite } from "../src/db/pglite";
import type { DbHandle } from "../src/db/index";
import { alerts, artists, decisions, events, feedback } from "../src/db/schema";
import { AskFilterSchema, answerQuestion, buildAskQuery, runAsk } from "../src/ask";
import { handleUpdate } from "../src/bot";
import { createLlm, type Llm } from "../src/llm";
import { encodeCallback, type TelegramSink } from "../src/telegram";

const NOW = new Date("2026-10-11T06:00:00Z");
let h: DbHandle;

/** The filters a model returned for the spec's example questions (4.9). */
const FILTERS: Record<string, object> = {
  "anything in Bengaluru in December under ₹2,000?": { cities: ["Bengaluru"], date_from: "2026-12-01", date_to: "2026-12-31", max_price_inr: 2000 },
  "who's playing Mumbai in January?": { cities: ["Mumbai"], date_from: "2027-01-01", date_to: "2027-01-31" },
  "what do I need to decide on this week?": { decision_status: ["maybe", "undecided"], deadline_within_days: 7, focus: "deadline", sort: "deadline" },
  "when does When Chai Met Toast go on sale?": { artists: ["When Chai Met Toast"], focus: "sale" },
  "which shows am I going to next month?": { decision_status: ["going"], date_from: "2026-11-01", date_to: "2026-11-30" },
  "anything on 2026-12-12'; drop table events; --": { cities: ["Bengaluru'); delete from events; --"] },
};

function askLlm(replyOk = true): Llm {
  return createLlm([
    {
      name: "replay",
      supportsImages: false,
      async complete(req) {
        if (req.task === "ask-filter") {
          const q = /<<<QUESTION \(from the user\)\n([\s\S]*?)\nQUESTION>>>/.exec(req.user)![1]!;
          return JSON.stringify(FILTERS[q] ?? {});
        }
        if (!replyOk) throw new Error("quota");
        return JSON.stringify({ reply: `Here you go:\n${req.user.split("\n").filter((l) => /^\d+\./.test(l)).join("\n")}` });
      },
    },
  ]);
}

const ask = async (q: string) => runAsk(h, AskFilterSchema.parse(FILTERS[q]), NOW);
const names = (rows: { artist_name: string }[]) => rows.map((r) => r.artist_name);

beforeAll(async () => {
  h = await connectPglite();
  await h.db.insert(artists).values([
    { id: 1, name: "Prateek Kuhad", priorityTier: "A" },
    { id: 2, name: "Lifafa", priorityTier: "B" },
    { id: 3, name: "When Chai Met Toast", priorityTier: "C", aliases: ["WCMT"] },
    { id: 4, name: "The Local Train", priorityTier: "B" },
    { id: 5, name: "Sid Sriram", priorityTier: "B" },
    { id: 6, name: "Kayan", priorityTier: "C" },
  ]);
  const ev = (id: number, artistId: number, city: string, date: string, extra: Partial<typeof events.$inferInsert> = {}) => ({
    id,
    artistId,
    city,
    date,
    fingerprint: `${artistId}|${city.toLowerCase()}|${date}`,
    confidence: 0.95,
    ...extra,
  });
  await h.db.insert(events).values([
    ev(1, 1, "Bengaluru", "2026-12-12", {
      venue: "Phoenix Marketcity Arena",
      ticketUrl: "https://www.district.in/events/pk",
      earlyBirdStatus: "open",
      earlyBirdClosesAt: new Date("2026-10-16T18:29:00Z"),
      tiers: [
        { name: "Early Bird", price_inr: 1299, status: "open" },
        { name: "GA", price_inr: 1999, status: "upcoming" },
      ],
    }),
    ev(2, 2, "Bengaluru", "2026-12-05", { tiers: [{ name: "GA", price_inr: 2499, status: "open" }], earlyBirdStatus: "none" }),
    ev(3, 3, "Mumbai", "2027-01-16", { saleStartsAt: new Date("2026-10-20T06:30:00Z") }),
    ev(4, 4, "Mumbai", "2027-01-30", { tiers: [{ name: "GA", price_inr: 999, status: "open" }] }),
    ev(5, 5, "Pune", "2026-11-14", { tiers: [{ name: "GA", price_inr: 1500, status: "open" }] }),
    ev(6, 6, "Bengaluru", "2026-12-20", { tiers: [{ name: "GA", price_inr: 1500, status: "open" }] }),
  ]);
  await h.db.insert(decisions).values([
    { eventId: 1, status: "maybe", via: "telegram" },
    { eventId: 4, status: "going", via: "dashboard" },
    { eventId: 5, status: "going", via: "telegram" },
    { eventId: 6, status: "pass", via: "dashboard" },
  ]);
}, 60_000);

describe("ask: question → filter → query", () => {
  it("anything in Bengaluru in December under ₹2,000?", async () => {
    // Lifafa is ₹2,499; Kayan was passed on.
    expect(names(await ask("anything in Bengaluru in December under ₹2,000?"))).toEqual(["Prateek Kuhad"]);
  });

  it("who's playing Mumbai in January?", async () => {
    expect(names(await ask("who's playing Mumbai in January?"))).toEqual(["When Chai Met Toast", "The Local Train"]);
  });

  it("what do I need to decide on this week?", async () => {
    // Prateek's early-bird closes in 5 days; WCMT's sale starts in 9; Lifafa is simply on sale.
    expect(names(await ask("what do I need to decide on this week?"))).toEqual(["Prateek Kuhad"]);
  });

  it("when does [artist] go on sale?", async () => {
    expect(names(await ask("when does When Chai Met Toast go on sale?"))).toEqual(["When Chai Met Toast"]);
  });

  it("which shows am I going to next month?", async () => {
    expect(names(await ask("which shows am I going to next month?"))).toEqual(["Sid Sriram"]);
  });

  it("keeps every value in bind parameters", () => {
    const f = AskFilterSchema.parse({ cities: ["Bengaluru'); delete from events; --"], artists: ["x' or 1=1"], max_price_inr: 2000 });
    const q = buildAskQuery(h, f, NOW);
    expect(q.sql).not.toContain("delete from");
    expect(q.sql).not.toContain("1=1");
    expect(q.params).toContain("bengaluru'); delete from events; --");
  });

  it("treats injection attempts as plain values and writes nothing", async () => {
    const before = (await h.db.select().from(events)).length;
    const a = await answerQuestion(h, askLlm(), "anything on 2026-12-12'; drop table events; --", NOW);
    expect(a.rows).toEqual([]);
    expect(a.html).toMatch(/^Nothing matches that/);
    expect((await h.db.select().from(events)).length).toBe(before);
  });

  it("writes a reply with Going / Maybe buttons, and falls back when the reply model fails", async () => {
    const a = await answerQuestion(h, askLlm(), "when does When Chai Met Toast go on sale?", NOW);
    expect(a.html).toContain("Tickets go on sale");
    expect(a.keyboard?.[0]?.map((b) => b.text)).toEqual(["Going: When Chai Met Toast", "Maybe: When Chai Met Toast"]);
    const b = await answerQuestion(h, askLlm(false), "when does When Chai Met Toast go on sale?", NOW);
    expect(b.html).toMatch(/^• When Chai Met Toast — Sat, 16 Jan 2027, Mumbai/);
  });
});

describe("telegram bot", () => {
  const sink = () => {
    const out = { messages: [] as string[], answers: [] as (string | undefined)[], docs: [] as string[], edits: 0 };
    const tg: TelegramSink = {
      async sendMessage(_c, html) {
        out.messages.push(html);
        return { messageId: 1 };
      },
      async sendDocument(_c, name, content) {
        out.docs.push(`${name}\n${content}`);
        return { messageId: 2 };
      },
      async answerCallback(_id, text) {
        out.answers.push(text);
      },
      async editKeyboard() {
        out.edits++;
      },
    };
    return { tg, out };
  };
  const deps = (tg: TelegramSink, onGoing?: (id: number) => Promise<void>) => ({ h, tg, allowedChats: new Set(["111"]), llm: () => askLlm(), onGoing, now: NOW });
  const tap = (data: string, chat = 111) => ({ update_id: 1, callback_query: { id: "cq", data, message: { message_id: 9, chat: { id: chat } } } });
  const say = (text: string, chat = 111) => ({ update_id: 2, message: { message_id: 10, chat: { id: chat }, text } });

  it("ignores chats that aren't on the allow-list", async () => {
    const { tg, out } = sink();
    expect(await handleUpdate(tap(encodeCallback({ kind: "decide", status: "going", eventId: 2 }), 999), deps(tg))).toBe("ignored");
    expect(await handleUpdate(say("anything in Bengaluru?", 999), deps(tg))).toBe("ignored");
    expect(out.messages).toEqual([]);
    expect((await h.db.select().from(decisions).where(eq(decisions.eventId, 2))).length).toBe(0);
  });

  it("records Going, marks the button, and triggers the playlist", async () => {
    const { tg, out } = sink();
    const going: number[] = [];
    await handleUpdate(tap(encodeCallback({ kind: "decide", status: "going", eventId: 2 })), deps(tg, async (id) => void going.push(id)));
    expect((await h.db.select().from(decisions).where(eq(decisions.eventId, 2)))[0]).toMatchObject({ status: "going", via: "telegram" });
    expect(out.answers).toEqual(["Marked Going"]);
    expect(out.edits).toBe(1);
    expect(going).toEqual([2]);
  });

  it("Wrong artist lowers the match weight and logs feedback", async () => {
    const { tg } = sink();
    await handleUpdate(tap(encodeCallback({ kind: "wrong_artist", eventId: 6 })), deps(tg));
    expect((await h.db.select().from(artists).where(eq(artists.id, 6)))[0]!.matchWeight).toBeCloseTo(0.7);
    expect(await h.db.select().from(feedback).where(eq(feedback.eventId, 6))).toHaveLength(1);
  });

  it("Add to calendar replies with an .ics", async () => {
    const { tg, out } = sink();
    await handleUpdate(tap(encodeCallback({ kind: "ics", eventId: 1 })), deps(tg));
    expect(out.docs[0]).toMatch(/^prateek-kuhad-2026-12-12\.ics/);
    expect(out.docs[0]).toContain("UID:show-1@liveshowradar");
  });

  it("answers questions read-only via /ask or plain text", async () => {
    const { tg, out } = sink();
    const alertCount = (await h.db.select().from(alerts)).length;
    await handleUpdate(say("/ask who's playing Mumbai in January?"), deps(tg));
    await handleUpdate(say("which shows am I going to next month?"), deps(tg));
    expect(out.messages[0]).toContain("When Chai Met Toast");
    expect(out.messages[1]).toContain("Sid Sriram");
    expect((await h.db.select().from(alerts)).length).toBe(alertCount);
  });
});
