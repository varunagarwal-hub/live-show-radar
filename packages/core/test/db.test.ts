import { beforeAll, describe, expect, it } from "vitest";
import { connectPglite } from "../src/db/pglite";
import type { DbHandle } from "../src/db/index";
import { artists, events } from "../src/db/schema";
import { loadSnapshot } from "../src/db/queries";
import { sendOnce } from "../src/alerts";
import type { TelegramSink } from "../src/telegram";

let h: DbHandle;
beforeAll(async () => {
  h = await connectPglite();
}, 30_000);

const sink = (): TelegramSink & { sent: string[] } => {
  const sent: string[] = [];
  return {
    sent,
    async sendMessage(_c, html) {
      sent.push(html);
      return { messageId: sent.length };
    },
    async sendDocument() {
      return { messageId: 0 };
    },
    async answerCallback() {},
    async editKeyboard() {},
  };
};

describe("database", () => {
  it("applies migrations and builds a snapshot", async () => {
    const [a] = await h.db.insert(artists).values({ name: "Lifafa", priorityTier: "A" }).returning();
    await h.db.insert(events).values({ fingerprint: `${a!.id}|bengaluru|2099-01-01`, artistId: a!.id, city: "Bengaluru", date: "2099-01-01", confidence: 0.9 });
    const snap = await loadSnapshot(h);
    expect(snap.artists.map((x) => x.name)).toContain("Lifafa");
    expect(snap.upcoming[0]).toMatchObject({ artistName: "Lifafa", priorityTier: "A", decision: null });
  });

  it("sends an alert at most once per dedup key, separately for dry-run", async () => {
    const tg = sink();
    const base = { dedupKey: "k1", kind: "test", eventId: null, chatId: "1", html: "hi" };
    expect(await sendOnce(h, tg, { ...base, dryRun: false })).toBe("sent");
    expect(await sendOnce(h, tg, { ...base, dryRun: false })).toBe("duplicate");
    expect(await sendOnce(h, tg, { ...base, dryRun: true })).toBe("sent");
    expect(tg.sent).toHaveLength(2);
  });

  it("releases the claim when Telegram fails so the next run retries", async () => {
    const failing: TelegramSink = { ...sink(), sendMessage: async () => { throw new Error("down"); } };
    const base = { dedupKey: "k2", kind: "test", eventId: null, chatId: "1", html: "hi", dryRun: false };
    await expect(sendOnce(h, failing, base)).rejects.toThrow("down");
    expect(await sendOnce(h, sink(), base)).toBe("sent");
  });

  it("runs read-only queries and rejects writes on that path", async () => {
    const rows = await h.readOnly<{ n: number }>("select count(*)::int as n from artists where name = $1", ["Lifafa"]);
    expect(rows[0]?.n).toBe(1);
    await expect(h.readOnly("delete from artists", [])).rejects.toThrow(/read-only/i);
  });
});
