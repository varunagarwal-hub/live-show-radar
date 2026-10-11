import { describe, expect, it } from "vitest";
import { computeUrgency, salesStarted, type UrgencyInput } from "../src/rules";

const now = new Date("2026-10-11T06:00:00Z");
const base: UrgencyInput = {
  priorityTier: "C",
  city: "Mumbai",
  earlyBirdStatus: "none",
  saleStartsAt: null,
  tiers: [],
  confidence: 0.95,
};

describe("computeUrgency", () => {
  it("tier A is urgent in any Indian city regardless of ticket state", () => {
    expect(computeUrgency({ ...base, priorityTier: "A", city: "Kolkata", earlyBirdStatus: "sold_out" }, now)).toBe("urgent");
    expect(computeUrgency({ ...base, priorityTier: "A", city: "Shillong", earlyBirdStatus: "none", tiers: [{ name: "GA", price_inr: 999, status: "open" }] }, now)).toBe("urgent");
  });

  it("Bengaluru with early-bird open or opening is urgent", () => {
    expect(computeUrgency({ ...base, city: "Bengaluru", earlyBirdStatus: "open" }, now)).toBe("urgent");
    expect(computeUrgency({ ...base, city: "Bangalore", earlyBirdStatus: "opening" }, now)).toBe("urgent");
  });

  it("Bengaluru with unknown early-bird is urgent only while sales haven't started", () => {
    expect(computeUrgency({ ...base, city: "Bengaluru", earlyBirdStatus: "unknown", saleStartsAt: new Date("2026-10-12T06:30:00Z") }, now)).toBe("urgent");
    expect(computeUrgency({ ...base, city: "Bengaluru", earlyBirdStatus: "unknown" }, now)).toBe("urgent");
    expect(computeUrgency({ ...base, city: "Bengaluru", earlyBirdStatus: "unknown", saleStartsAt: new Date("2026-10-10T06:30:00Z") }, now)).toBe("normal");
    expect(computeUrgency({ ...base, city: "Bengaluru", earlyBirdStatus: "unknown", tiers: [{ name: "GA", price_inr: 1500, status: "open" }] }, now)).toBe("normal");
  });

  it("Bengaluru with early-bird sold out or none is normal for B and C artists", () => {
    expect(computeUrgency({ ...base, city: "Bengaluru", earlyBirdStatus: "sold_out", priorityTier: "B" }, now)).toBe("normal");
    expect(computeUrgency({ ...base, city: "Bengaluru", earlyBirdStatus: "none" }, now)).toBe("normal");
  });

  it("other cities with early-bird open are normal for tier B/C", () => {
    expect(computeUrgency({ ...base, city: "Pune", earlyBirdStatus: "open", priorityTier: "B" }, now)).toBe("normal");
    expect(computeUrgency({ ...base, city: "Goa", priorityTier: "C" }, now)).toBe("normal");
  });

  it("low confidence becomes a quiet possible-show message, even for tier A", () => {
    expect(computeUrgency({ ...base, priorityTier: "A", confidence: 0.4 }, now)).toBe("possible");
  });
});

describe("salesStarted", () => {
  it("is true when sale start passed or a tier is on sale or sold out", () => {
    expect(salesStarted({ saleStartsAt: new Date("2026-10-01T00:00:00Z"), tiers: [] }, now)).toBe(true);
    expect(salesStarted({ saleStartsAt: null, tiers: [{ name: "EB", price_inr: 799, status: "sold_out" }] }, now)).toBe(true);
    expect(salesStarted({ saleStartsAt: null, tiers: [{ name: "EB", price_inr: 799, status: "upcoming" }] }, now)).toBe(false);
  });
});
