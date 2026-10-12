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
    expect(lines[1]).toContain("Tickets (best match)");
  });

  it("only shows bio links that plausibly lead to tickets", () => {
    for (const u of ["https://linktr.ee/anuvjainshows", "http://theweeknd.com/tour", "https://taylor.lnk.to/x", "https://sonunigamlive.com/", "https://in.bookmyshow.com/events/x"]) {
      expect(isBookingLikeUrl(u)).toBe(true);
    }
    for (const u of ["https://www.tatwamasifoundation.com", "http://www.arrahman.com/", "https://youtube.com/javedali", null]) expect(isBookingLikeUrl(u)).toBe(false);
    expect(bookingLines({ ...base, ticketUrl: null, bioUrl: "https://www.tatwamasifoundation.com" })).toHaveLength(1);
  });

  it("jumps to the best ticketing-site match for artist, city and date", () => {
    const url = ticketSearchUrl("Anuv Jain", "Chennai", "2026-10-31");
    expect(url.startsWith("https://duckduckgo.com/?q=")).toBe(true);
    const q = decodeURIComponent(url.split("q=")[1]!);
    expect(q).toBe(
      '!ducky "Anuv Jain" Chennai 31 October tickets site:in.bookmyshow.com/events OR site:district.in/events OR site:skillboxes.com/events OR site:insider.in OR site:thumpn.com/event',
    );
    expect(decodeURIComponent(ticketSearchUrl("Lifafa", "Pune", null).split("q=")[1]!)).toMatch(/^!ducky "Lifafa" Pune tickets site:/);
    // Unknown city: search by artist only, never the literal "TBA".
    expect(decodeURIComponent(ticketSearchUrl("Sonu Nigam", "TBA", null).split("q=")[1]!)).toMatch(/^!ducky "Sonu Nigam" tickets site:/);
  });
});
