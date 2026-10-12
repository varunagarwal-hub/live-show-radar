import { describe, expect, it } from "vitest";
import { bookingLines, isBookingLikeUrl, ticketSearchUrl } from "../src/telegram";
import { isEventPageUrl, matchBookingLink, parseLinkPage, plausibleSearchedLink } from "../src/booking";

const base = { artistName: "Anuv Jain", city: "Chennai", date: "2026-10-31" };

describe("booking links", () => {
  it("prefers a direct ticket link, then a looked-up booking page", () => {
    expect(bookingLines({ ...base, ticketUrl: "https://in.bookmyshow.com/events/x", bioUrl: "https://linktr.ee/anuvjainshows" })).toEqual([
      '🛒 <a href="https://in.bookmyshow.com/events/x">Open tickets</a>',
    ]);
    expect(bookingLines({ ...base, ticketUrl: null, bookingUrl: "https://www.district.in/events/y" })).toEqual(['🛒 <a href="https://www.district.in/events/y">Open tickets</a>']);
  });

  it("falls back to the artist's link page plus a plainly labelled search", () => {
    const lines = bookingLines({ ...base, ticketUrl: null, bioUrl: "https://linktr.ee/anuvjainshows" });
    expect(lines[0]).toContain('href="https://linktr.ee/anuvjainshows">Artist\'s links</a>');
    expect(lines[1]).toContain("Search for tickets");
    expect(lines.join("\n")).not.toContain("duckduckgo");
  });

  it("only shows bio links that plausibly lead to Indian tickets", () => {
    for (const u of ["https://linktr.ee/anuvjainshows", "http://theweeknd.com/tour", "https://taylor.lnk.to/x", "https://sonunigamlive.com/", "https://in.bookmyshow.com/events/x"]) {
      expect(isBookingLikeUrl(u)).toBe(true);
    }
    for (const u of ["https://www.tatwamasifoundation.com", "http://www.arrahman.com/", "https://youtube.com/javedali", "https://www.ticketmaster.com/explore/diljit-dosanjh-2026", null]) {
      expect(isBookingLikeUrl(u)).toBe(false);
    }
    expect(bookingLines({ ...base, ticketUrl: null, bioUrl: "https://www.tatwamasifoundation.com" })).toHaveLength(1);
  });

  it("searches by artist, city and date, never the literal TBA", () => {
    expect(decodeURIComponent(ticketSearchUrl("Anuv Jain", "Chennai", "2026-10-31").split("q=")[1]!)).toBe("Anuv Jain Chennai 31 October 2026 tickets");
    expect(decodeURIComponent(ticketSearchUrl("Sonu Nigam", "TBA", null).split("q=")[1]!)).toBe("Sonu Nigam tickets");
  });
});

describe("event pages", () => {
  it("accepts event pages and rejects landing, search and artist pages", () => {
    for (const u of [
      "https://in.bookmyshow.com/events/diljit-dosanjh-rupay-aura-india-tour-delhi/et2t9bn479",
      "https://www.district.in/events/oktoberfest-goa-2026-oct30-2026-buy-tickets",
      "https://thumpn.com/event/WJYNVR/casa-bacardi-on-tour-jaipur",
    ])
      expect(isEventPageUrl(u)).toBe(true);
    for (const u of [
      "https://in.bookmyshow.com/explore/home/mumbai",
      "https://www.district.in/search?q=anuv",
      "https://www.district.in/events/",
      "https://www.district.in/events/anuv-jain/artist",
      "https://cdn.district.in/assets/events/x.jpg",
      "https://www.ticketmaster.com/event/123",
      "https://duckduckgo.com/?q=x",
    ])
      expect(isEventPageUrl(u)).toBe(false);
  });
});

// Shape of Linktree's embedded page data (titles as the artist writes them).
const LINKTREE = [
  ["Casa Bacardí On Tour | Jaipur - 24th October 2026", "https://thumpn.com/event/WJYNVR/casa-bacardi-on-tour-jaipur"],
  ["Route 143 | Chennai - 31st October 2026", "https://in.bookmyshow.com/events/route-143-anuv-jain/ET00513540"],
  ["Oktoberfest | Goa - 1st November 2026", "https://www.district.in/events/oktoberfest-goa-2026-oct30-2026-buy-tickets"],
  ["Casa Bacardí On Tour | Noida - 12th December 2026", "https://thumpn.com/event/6QA2W3/casa-bacardi-on-tour-noida"],
  ["Dastakhat World Tour | Dubai - 20th November 2026", "https://dubai.platinumlist.net/event-tickets/104347/anuv-jain-live"],
  ["Save 10% at Omnilux LED", "https://omniluxled.com"],
]
  .map(([t, u], i) => `{"title":${JSON.stringify(t)},"position":${i},"url":${JSON.stringify(u)}}`)
  .join(",");

describe("link-in-bio pages", () => {
  const links = parseLinkPage(`<script id="__NEXT_DATA__">{"links":[${LINKTREE}]}</script>`);

  it("reads every titled link", () => {
    expect(links).toHaveLength(6);
    expect(links[2]).toEqual({ title: "Oktoberfest | Goa - 1st November 2026", url: "https://www.district.in/events/oktoberfest-goa-2026-oct30-2026-buy-tickets" });
  });

  it("picks the link for the show's city and date", () => {
    expect(matchBookingLink({ artistName: "Anuv Jain", city: "Goa", date: "2026-11-01" }, links)).toBe("https://www.district.in/events/oktoberfest-goa-2026-oct30-2026-buy-tickets");
    expect(matchBookingLink({ artistName: "Anuv Jain", city: "Chennai", date: "2026-10-31" }, links)).toBe("https://in.bookmyshow.com/events/route-143-anuv-jain/ET00513540");
    // Delhi NCR covers Noida.
    expect(matchBookingLink({ artistName: "Anuv Jain", city: "Delhi NCR", date: "2026-12-12" }, links)).toBe("https://thumpn.com/event/6QA2W3/casa-bacardi-on-tour-noida");
  });

  it("gives no link when the date or city doesn't fit", () => {
    expect(matchBookingLink({ artistName: "Anuv Jain", city: "Goa", date: "2026-12-20" }, links)).toBeNull();
    expect(matchBookingLink({ artistName: "Anuv Jain", city: "Pune", date: "2026-11-01" }, links)).toBeNull();
    expect(matchBookingLink({ artistName: "Anuv Jain", city: "TBA", date: null }, links)).toBeNull();
  });
});

describe("searched links", () => {
  const diljit = { artistName: "Diljit Dosanjh", city: "Delhi NCR", date: "2026-11-01" };
  it("needs an event page naming the artist and the city", () => {
    expect(plausibleSearchedLink(diljit, "https://in.bookmyshow.com/events/diljit-dosanjh-rupay-aura-india-tour-delhi/et2t9bn479")).toBe(true);
    expect(plausibleSearchedLink(diljit, "https://in.bookmyshow.com/events/diljit-dosanjh-rupay-aura-india-tour-mumbai/et2t9bn480")).toBe(false);
    expect(plausibleSearchedLink(diljit, "https://in.bookmyshow.com/explore/home/national-capital-region-ncr")).toBe(false);
  });
});
