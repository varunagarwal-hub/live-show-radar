import { describe, expect, it } from "vitest";
import { bookingLines, isBookingLikeUrl, ticketSearchUrl } from "../src/telegram";

const base = { artistName: "Anuv Jain", city: "Chennai", date: "2026-10-31" };

describe("booking links", () => {
  it("prefers a direct ticket link", () => {
    expect(bookingLines({ ...base, ticketUrl: "https://in.bookmyshow.com/events/x", bioUrl: "https://linktr.ee/anuvjainshows" })).toEqual([
      '🛒 <a href="https://in.bookmyshow.com/events/x">Open tickets</a>',
    ]);
  });

  it("falls back to the artist's link page plus a search", () => {
    const lines = bookingLines({ ...base, ticketUrl: null, bioUrl: "https://linktr.ee/anuvjainshows" });
    expect(lines[0]).toContain('href="https://linktr.ee/anuvjainshows">Artist&#39;s links</a>'.replace("&#39;", "'"));
    expect(lines[1]).toContain("Find tickets");
  });

  it("only shows bio links that plausibly lead to tickets", () => {
    for (const u of ["https://linktr.ee/anuvjainshows", "http://theweeknd.com/tour", "https://taylor.lnk.to/x", "https://sonunigamlive.com/", "https://in.bookmyshow.com/events/x"]) {
      expect(isBookingLikeUrl(u)).toBe(true);
    }
    for (const u of ["https://www.tatwamasifoundation.com", "http://www.arrahman.com/", "https://youtube.com/javedali", null]) expect(isBookingLikeUrl(u)).toBe(false);
    expect(bookingLines({ ...base, ticketUrl: null, bioUrl: "https://www.tatwamasifoundation.com" })).toHaveLength(1);
  });

  it("searches with artist, city and the full date", () => {
    expect(ticketSearchUrl("Anuv Jain", "Chennai", "2026-10-31")).toBe(
      `https://www.google.com/search?q=${encodeURIComponent("Anuv Jain Chennai 31 October 2026 tickets")}`,
    );
    expect(ticketSearchUrl("Lifafa", "Pune", null)).toBe(`https://www.google.com/search?q=${encodeURIComponent("Lifafa Pune tickets")}`);
  });
});
