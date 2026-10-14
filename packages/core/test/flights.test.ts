import { describe, expect, it } from "vitest";
import { airportFor, flightsSearchUrl } from "../src";

const q = (url: string | null) => (url ? decodeURIComponent(new URL(url).searchParams.get("q")!) : null);

describe("flight searches follow the person's home city", () => {
  it("searches from the home city to the show's city", () => {
    expect(q(flightsSearchUrl("Goa", "2026-11-01", null, "Bengaluru"))).toBe("Flights from BLR to GOI on 2026-11-01 returning 2026-11-02");
    expect(q(flightsSearchUrl("Goa", "2026-11-01", null, "Mumbai"))).toBe("Flights from BOM to GOI on 2026-11-01 returning 2026-11-02");
  });
  it("no flight to a show in your own city", () => {
    expect(flightsSearchUrl("Mumbai", "2026-11-01", null, "Mumbai")).toBeNull();
  });
  it("covers tour stops beyond the configured cities", () => {
    expect(airportFor("Ahmedabad")).toBe("AMD");
    expect(airportFor("Guwahati")).toBe("GAU");
    expect(q(flightsSearchUrl("Ahmedabad", "2027-01-09", null, "Delhi NCR"))).toBe("Flights from DEL to AMD on 2027-01-09 returning 2027-01-10");
    expect(airportFor("Nowhere-ville")).toBeUndefined();
  });
  it("returns after the last day of a multi-day show", () => {
    expect(q(flightsSearchUrl("Bengaluru", "2026-11-28", "2026-11-29", "Mumbai"))).toBe("Flights from BOM to BLR on 2026-11-28 returning 2026-11-30");
  });
});
