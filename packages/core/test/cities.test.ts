import { describe, expect, it } from "vitest";
import { cityFromAddress, cityInText, normalizeCity } from "../src/cities";

describe("cities", () => {
  it("maps aliases to configured names and keeps other Indian cities", () => {
    expect(normalizeCity("Bangalore")).toBe("Bengaluru");
    expect(normalizeCity("gurugram")).toBe("Delhi NCR");
    expect(normalizeCity("shillong")).toBe("Shillong");
  });

  it("finds a city named in a title", () => {
    expect(cityInText("The Philosophy of Resonance | Satinder Sartaaj Live in Bengaluru")).toBe("Bengaluru");
    expect(cityInText("BENNY DAYAL Live in BANGALORE")).toBe("Bengaluru");
    expect(cityInText("Echoes of Earth | 2026")).toBeNull();
  });

  it("reads the city from Indian postal addresses (real District formats)", () => {
    expect(cityFromAddress("Indira Priya Darshini Stadium, Jagadamba Junction, Visakhapatnam, Andhra Pradesh 530001, India")).toBe("Visakhapatnam");
    // A road named after Delhi must not make a Punjab venue a Delhi show.
    expect(cityFromAddress("Jalandhar - Delhi, Grand Trunk Rd, Phagwara, Punjab 144001, India")).toBe("Phagwara");
    expect(cityFromAddress("12th Main Rd, Indiranagar, Bengaluru, Karnataka 560038, India")).toBe("Bengaluru");
    expect(cityFromAddress("Mumbai")).toBe("Mumbai");
  });
});
