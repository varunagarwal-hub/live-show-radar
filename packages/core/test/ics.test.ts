import { describe, expect, it } from "vitest";
import { buildCalendar, foldLine, icsEscape, type IcsShow } from "../src/ics";

const now = new Date("2026-10-11T06:00:00Z");
const show = (over: Partial<IcsShow> = {}): IcsShow => ({
  id: 42,
  artistName: "Prateek Kuhad",
  city: "Bengaluru",
  venue: "Phoenix Marketcity, Whitefield",
  date: "2026-12-12",
  endDate: null,
  ticketUrl: "https://www.district.in/events/prateek-kuhad-bengaluru",
  sourceUrls: ["https://www.instagram.com/p/abc/"],
  decision: "going",
  updatedAt: new Date("2026-10-10T10:00:00Z"),
  earlyBirdStatus: "open",
  earlyBirdOpensAt: null,
  earlyBirdClosesAt: new Date("2026-10-16T18:29:00Z"),
  saleStartsAt: null,
  tiers: [],
  ...over,
});

describe("ics", () => {
  it("escapes text and folds long lines at 75 octets", () => {
    expect(icsEscape("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
    const folded = foldLine(`DESCRIPTION:${"x".repeat(200)}`);
    for (const l of folded.split("\r\n")) expect(Buffer.byteLength(l)).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe(`DESCRIPTION:${"x".repeat(200)}`);
  });

  it("does not split multi-byte characters when folding", () => {
    const folded = foldLine(`SUMMARY:${"₹".repeat(60)}`);
    expect(folded.replace(/\r\n /g, "")).toBe(`SUMMARY:${"₹".repeat(60)}`);
  });

  it("renders Going shows as confirmed all-day events with stable UIDs", () => {
    const cal = buildCalendar([show()], { now });
    expect(cal).toContain("BEGIN:VCALENDAR\r\n");
    expect(cal).toContain("UID:show-42@liveshowradar");
    expect(cal).toContain("DTSTART;VALUE=DATE:20261212");
    expect(cal).toContain("DTEND;VALUE=DATE:20261213");
    expect(cal).toContain("STATUS:CONFIRMED");
    expect(cal).toContain("LOCATION:Phoenix Marketcity\\, Whitefield\\, Bengaluru");
    expect(cal).not.toContain("decide-42");
    expect(cal.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("renders Maybe shows as tentative plus a decide-by reminder event", () => {
    const cal = buildCalendar([show({ decision: "maybe" })], { now });
    expect(cal).toContain("STATUS:TENTATIVE");
    expect(cal).toContain("UID:decide-42@liveshowradar");
    expect(cal).toContain("DTEND:20261016T182900Z");
    expect(cal).toContain("BEGIN:VALARM");
  });

  it("keeps UIDs identical across rebuilds so calendars update in place", () => {
    const a = buildCalendar([show()], { now }).match(/UID:.*/g);
    const b = buildCalendar([show({ venue: "New venue", updatedAt: new Date() })], { now }).match(/UID:.*/g);
    expect(a).toEqual(b);
  });

  it("spans multi-day festivals", () => {
    expect(buildCalendar([show({ endDate: "2026-12-14" })], { now })).toContain("DTEND;VALUE=DATE:20261215");
  });
});
