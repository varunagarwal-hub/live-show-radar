import { describe, expect, it } from "vitest";
import { fingerprint, findExisting, mergeEvent, type EventFields, type ExistingEvent } from "../src/events";

const now = new Date("2026-10-11T06:00:00Z");
const fields = (over: Partial<EventFields> = {}): EventFields => ({
  artistId: 7,
  city: "Bengaluru",
  venue: null,
  date: "2026-12-12",
  endDate: null,
  eventType: "concert",
  ticketUrl: null,
  saleStartsAt: null,
  earlyBirdStatus: "unknown",
  earlyBirdOpensAt: null,
  earlyBirdClosesAt: null,
  tiers: [],
  confidence: 0.8,
  title: null,
  evidence: "first quote",
  ...over,
});
const existing = (over: Partial<ExistingEvent> = {}): ExistingEvent => {
  const f = fields(over);
  return { id: 1, fingerprint: fingerprint(f.artistId, f.city, f.date), fieldHistory: [], ...f, ...over };
};

describe("fingerprint", () => {
  it("normalises city spellings so sources agree", () => {
    expect(fingerprint(7, "Bangalore", "2026-12-12")).toBe(fingerprint(7, "Bengaluru", "2026-12-12"));
    expect(fingerprint(7, "Gurugram", "2026-12-12")).toBe(fingerprint(7, "Delhi NCR", "2026-12-12"));
  });
  it("differs by artist, city and date", () => {
    const fp = fingerprint(7, "Bengaluru", "2026-12-12");
    expect(fingerprint(8, "Bengaluru", "2026-12-12")).not.toBe(fp);
    expect(fingerprint(7, "Mumbai", "2026-12-12")).not.toBe(fp);
    expect(fingerprint(7, "Bengaluru", "2026-12-13")).not.toBe(fp);
  });
  it("marks undated shows tbd", () => {
    expect(fingerprint(7, "Pune", null)).toBe("7|pune|tbd");
  });
});

describe("findExisting", () => {
  it("matches by fingerprint", () => {
    const e = existing();
    expect(findExisting({ artistId: 7, city: "bangalore", date: "2026-12-12" }, [e])).toBe(e);
  });
  it("upgrades an undated event when a dated source arrives", () => {
    const tbd = existing({ date: null, fingerprint: "7|bengaluru|tbd" });
    expect(findExisting({ artistId: 7, city: "Bengaluru", date: "2026-12-12" }, [tbd])).toBe(tbd);
  });
  it("does not merge different dates in the same city", () => {
    expect(findExisting({ artistId: 7, city: "Bengaluru", date: "2026-12-13" }, [existing()])).toBeUndefined();
  });
});

describe("mergeEvent", () => {
  it("fills nulls from a later source without recording history", () => {
    const r = mergeEvent(existing(), fields({ ticketUrl: "https://www.district.in/events/x", venue: "Phoenix Arena" }), "district", now);
    expect(r.patch).toMatchObject({ ticketUrl: "https://www.district.in/events/x", venue: "Phoenix Arena" });
    expect(r.changes).toEqual([]);
  });

  it("records every overwrite of a non-null field", () => {
    const r = mergeEvent(existing({ venue: "Old Venue" }), fields({ venue: "New Venue", confidence: 0.9 }), "instagram", now);
    expect(r.patch.venue).toBe("New Venue");
    expect(r.changes).toEqual([{ field: "venue", from: "Old Venue", to: "New Venue", at: now.toISOString(), source: "instagram" }]);
    expect(r.patch.fieldHistory).toHaveLength(1);
  });

  it("keeps the existing value when the newer source is less confident", () => {
    const r = mergeEvent(existing({ venue: "Phoenix Arena", confidence: 0.95 }), fields({ venue: "Somewhere", confidence: 0.6 }), "news", now);
    expect(r.patch.venue).toBeUndefined();
  });

  it("always takes the newest ticket state, recording the change", () => {
    const r = mergeEvent(existing({ earlyBirdStatus: "open", confidence: 0.95 }), fields({ earlyBirdStatus: "sold_out", confidence: 0.6 }), "district", now);
    expect(r.patch.earlyBirdStatus).toBe("sold_out");
    expect(r.changes[0]?.field).toBe("earlyBirdStatus");
  });

  it("re-fingerprints a tbd event once it gets a date", () => {
    const r = mergeEvent(existing({ date: null, fingerprint: "7|bengaluru|tbd" }), fields(), "district", now);
    expect(r.patch.fingerprint).toBe("7|bengaluru|2026-12-12");
  });

  it("reports no change for an identical source", () => {
    expect(mergeEvent(existing(), fields(), "news", now).changed).toBe(false);
  });
});
