import { describe, expect, it } from "vitest";
import { dueReminders } from "../src/reminders";
import type { SnapshotEvent } from "../src/state";

const ev = (over: Partial<SnapshotEvent> = {}): SnapshotEvent => ({
  id: 1,
  artistId: 1,
  artistName: "Lifafa",
  priorityTier: "B",
  city: "Bengaluru",
  venue: null,
  date: "2026-12-13",
  endDate: null,
  ticketUrl: null,
  saleStartsAt: "2026-10-12T06:30:00.000Z", // 12:00 IST
  earlyBirdStatus: "unknown",
  earlyBirdOpensAt: null,
  earlyBirdClosesAt: null,
  tiers: [],
  confidence: 0.9,
  urgency: "urgent",
  handleUnconfirmed: false,
  decision: null,
  lastStateHash: null,
  sources: [],
  ...over,
});
const opts = { saleWindowMin: 30, decideWindowHours: 24 };
const at = (iso: string) => new Date(iso);

describe("dueReminders", () => {
  it("is quiet before the window opens", () => {
    expect(dueReminders([ev()], at("2026-10-12T05:59:00Z"), new Set(), opts)).toEqual([]);
  });

  it("fires on the first run inside the 30-minute window (≈15 min before on schedule)", () => {
    const r = dueReminders([ev()], at("2026-10-12T06:15:00Z"), new Set(), opts);
    expect(r).toEqual([{ kind: "sale_reminder", eventId: 1, dedupKey: "sale:1:2026-10-12T06:30:00.000Z", at: at("2026-10-12T06:30:00Z") }]);
  });

  it("still fires when cron runs late, as long as sale hasn't started", () => {
    expect(dueReminders([ev()], at("2026-10-12T06:28:00Z"), new Set(), opts)).toHaveLength(1);
    expect(dueReminders([ev()], at("2026-10-12T06:31:00Z"), new Set(), opts)).toEqual([]);
  });

  it("never repeats a sent reminder, but a rescheduled sale gets a new one", () => {
    const sent = new Set(["sale:1:2026-10-12T06:30:00.000Z"]);
    expect(dueReminders([ev()], at("2026-10-12T06:20:00Z"), sent, opts)).toEqual([]);
    expect(dueReminders([ev({ saleStartsAt: "2026-10-12T06:45:00.000Z" })], at("2026-10-12T06:20:00Z"), sent, opts)).toHaveLength(1);
  });

  it("reminds about early-bird opening", () => {
    const r = dueReminders([ev({ saleStartsAt: null, earlyBirdStatus: "opening", earlyBirdOpensAt: "2026-10-12T06:30:00.000Z" })], at("2026-10-12T06:10:00Z"), new Set(), opts);
    expect(r.map((x) => x.kind)).toEqual(["early_bird_reminder"]);
  });

  it("sends the decide-by reminder 24h before a Maybe show's deadline", () => {
    const maybe = ev({ decision: "maybe", saleStartsAt: null, earlyBirdStatus: "open", earlyBirdClosesAt: "2026-10-16T18:29:00.000Z", tiers: [{ name: "EB", price_inr: 799, status: "open" }] });
    expect(dueReminders([maybe], at("2026-10-15T18:00:00Z"), new Set(), opts)).toEqual([]);
    expect(dueReminders([maybe], at("2026-10-15T18:30:00Z"), new Set(), opts).map((x) => x.kind)).toEqual(["decide_reminder"]);
    expect(dueReminders([{ ...maybe, decision: "going" }], at("2026-10-15T18:30:00Z"), new Set(), opts)).toEqual([]);
  });

  it("skips shows he passed on and unconfirmed possible shows", () => {
    expect(dueReminders([ev({ decision: "pass" }), ev({ id: 2, urgency: "possible" })], at("2026-10-12T06:15:00Z"), new Set(), opts)).toEqual([]);
  });
});
