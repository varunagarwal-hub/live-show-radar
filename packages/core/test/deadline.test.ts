import { describe, expect, it } from "vitest";
import { decideByDeadline, type DeadlineInput } from "../src/deadline";

const now = new Date("2026-10-11T06:00:00Z");
const base: DeadlineInput = {
  date: "2026-12-12",
  earlyBirdStatus: "unknown",
  earlyBirdOpensAt: null,
  earlyBirdClosesAt: null,
  saleStartsAt: null,
  tiers: [],
};

describe("decideByDeadline", () => {
  it("uses the early-bird close time while early-bird is open", () => {
    const closes = new Date("2026-10-16T18:29:00Z");
    expect(decideByDeadline({ ...base, earlyBirdStatus: "open", earlyBirdClosesAt: closes, tiers: [{ name: "EB", price_inr: 999, status: "open" }] }, now)).toEqual({
      at: closes,
      kind: "early_bird_closes",
    });
  });

  it("uses sale start when tickets aren't live yet", () => {
    const sale = new Date("2026-10-14T06:30:00Z");
    expect(decideByDeadline({ ...base, saleStartsAt: sale }, now)).toEqual({ at: sale, kind: "sale_starts" });
  });

  it("prefers the earlier of early-bird opening and sale start", () => {
    const eb = new Date("2026-10-13T06:30:00Z");
    const sale = new Date("2026-10-14T06:30:00Z");
    expect(decideByDeadline({ ...base, earlyBirdStatus: "opening", earlyBirdOpensAt: eb, saleStartsAt: sale }, now)).toEqual({ at: eb, kind: "early_bird_opens" });
  });

  it("ignores deadlines that already passed", () => {
    const past = new Date("2026-10-10T06:30:00Z");
    expect(decideByDeadline({ ...base, earlyBirdStatus: "open", earlyBirdClosesAt: past, saleStartsAt: past }, now)).toBeNull();
  });

  it("returns null when tickets are simply on sale", () => {
    expect(decideByDeadline({ ...base, earlyBirdStatus: "sold_out", tiers: [{ name: "GA", price_inr: 1999, status: "open" }] }, now)).toBeNull();
  });

  it("returns null for a show that has already happened", () => {
    expect(decideByDeadline({ ...base, date: "2026-10-01", saleStartsAt: new Date("2026-10-20T00:00:00Z") }, now)).toBeNull();
  });
});
