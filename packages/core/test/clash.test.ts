import { describe, expect, it } from "vitest";
import { busyFromIcs, findClashes, flightsSearchUrl, type ClashShow } from "../src/clash";

const ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Google Inc//Google Calendar 70.9054//EN",
  "BEGIN:VEVENT",
  "UID:wedding@google.com",
  "DTSTART:20261212T083000Z",
  "DTEND:20261212T173000Z",
  "SUMMARY:Cousin's wedding",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:standup@google.com",
  "DTSTART;TZID=Asia/Kolkata:20261005T190000",
  "DTEND;TZID=Asia/Kolkata:20261005T200000",
  "RRULE:FREQ=WEEKLY;BYDAY=MO",
  "SUMMARY:Band practice",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:free@google.com",
  "DTSTART;VALUE=DATE:20261205",
  "DTEND;VALUE=DATE:20261206",
  "TRANSP:TRANSPARENT",
  "SUMMARY:Reminder only",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const from = new Date("2026-11-01T00:00:00Z");
const to = new Date("2027-01-31T00:00:00Z");

describe("clash detection", () => {
  it("reads busy times, expands recurrences and ignores free events", () => {
    const busy = busyFromIcs(ICS, from, to);
    expect(busy.some((b) => b.summary === "Cousin's wedding")).toBe(true);
    expect(busy.filter((b) => b.summary === "Band practice").length).toBeGreaterThanOrEqual(12);
    expect(busy.some((b) => b.summary === "Reminder only")).toBe(false);
  });

  it("flags calendar overlaps and a second Going show the same weekend", () => {
    const shows: ClashShow[] = [
      { id: 1, artistName: "Prateek Kuhad", city: "Bengaluru", date: "2026-12-12", endDate: null, decision: "maybe" }, // Sat, wedding until 23:00 IST
      { id: 2, artistName: "Lifafa", city: "Bengaluru", date: "2026-12-13", endDate: null, decision: "going" }, // Sun, same weekend
      { id: 3, artistName: "Sid Sriram", city: "Bengaluru", date: "2026-12-07", endDate: null, decision: null }, // Mon 19:00 practice
      { id: 4, artistName: "Kayan", city: "Bengaluru", date: "2026-12-16", endDate: null, decision: null }, // Wed, free
    ];
    const c = findClashes(shows, busyFromIcs(ICS, from, to));
    expect(c.get(1)).toEqual([
      { kind: "calendar", detail: "Cousin's wedding" },
      { kind: "same_weekend", detail: "Lifafa (Bengaluru)" },
    ]);
    expect(c.get(3)?.[0]).toEqual({ kind: "calendar", detail: "Band practice" });
    expect(c.get(4)).toBeUndefined();
  });

  it("prefills a Google Flights search for out-of-city shows only", () => {
    expect(flightsSearchUrl("Mumbai", "2026-12-14")).toContain(encodeURIComponent("Flights from BLR to BOM on 2026-12-14 returning 2026-12-15"));
    expect(flightsSearchUrl("Bengaluru", "2026-12-14")).toBeNull();
  });
});
