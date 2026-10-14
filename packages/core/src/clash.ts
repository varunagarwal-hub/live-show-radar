import ical, { type VEvent } from "node-ical";
import { radarConfig } from "@radar/config";
import { fetchText } from "./http";
import { addDays, dateOnlyToUtcNoonIST, istInstant } from "./time";
import { airportFor, cityConfig } from "./cities";

export interface Busy {
  start: Date;
  end: Date;
  summary: string;
}

/**
 * Busy times from Karan's Google Calendar "secret address in iCal format" (read-only .ics URL;
 * no OAuth, so nothing expires). Recurring events are expanded within the window; events marked
 * free (TRANSP:TRANSPARENT) are ignored. Event titles stay server-side and are only shown to him.
 */
export function busyFromIcs(text: string, from: Date, to: Date): Busy[] {
  const data = ical.sync.parseICS(text);
  const out: Busy[] = [];
  for (const v of Object.values(data)) {
    if (!v || v.type !== "VEVENT") continue;
    const ev = v as VEvent;
    if (String(ev.transparency ?? "").toUpperCase() === "TRANSPARENT") continue;
    if (String(ev.status ?? "").toUpperCase() === "CANCELLED") continue;
    const start = new Date(ev.start);
    const end = ev.end ? new Date(ev.end) : new Date(start.getTime() + 3_600_000);
    const dur = end.getTime() - start.getTime();
    const summary = typeof ev.summary === "string" ? ev.summary : "Busy";
    if (ev.rrule) {
      const exdates = new Set(Object.values(ev.exdate ?? {}).map((d) => new Date(d as Date).toISOString().slice(0, 10)));
      for (const occ of ev.rrule.between(new Date(from.getTime() - dur), to, true)) {
        if (exdates.has(occ.toISOString().slice(0, 10))) continue;
        out.push({ start: occ, end: new Date(occ.getTime() + dur), summary });
      }
    } else if (end > from && start < to) {
      out.push({ start, end, summary });
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

export async function fetchBusy(icsUrl: string, from: Date, to: Date): Promise<Busy[]> {
  return busyFromIcs(await fetchText(icsUrl, { attempts: 2, timeoutMs: 15_000 }), from, to);
}

export interface ClashShow {
  id: number;
  artistName: string;
  city: string;
  date: string | null;
  endDate: string | null;
  decision: string | null;
}

export interface Clash {
  kind: "calendar" | "same_weekend";
  detail: string;
}

/** When a show occupies Karan's time: the evening (17:00–23:59 IST) of each show day; whole days if travelling. */
function showWindow(s: ClashShow): { start: Date; end: Date } | null {
  if (!s.date) return null;
  const last = s.endDate ?? s.date;
  const away = s.city !== radarConfig.homeCity;
  return {
    start: away ? istInstant(s.date, "00:00") : istInstant(s.date, "17:00"),
    end: istInstant(last, "23:59"),
  };
}

/** The Friday–Sunday weekend a date belongs to, or null on Mon–Thu. */
function weekendKey(isoDate: string): string | null {
  const dow = dateOnlyToUtcNoonIST(isoDate).getUTCDay();
  if (dow === 5) return isoDate;
  if (dow === 6) return addDays(isoDate, -1);
  if (dow === 0) return addDays(isoDate, -2);
  return null;
}

/** Spec 4.13 clash detection: Google Calendar busy times, or another Going show the same weekend. */
export function findClashes(shows: ClashShow[], busy: Busy[]): Map<number, Clash[]> {
  const out = new Map<number, Clash[]>();
  const add = (id: number, c: Clash) => out.set(id, [...(out.get(id) ?? []), c]);
  for (const s of shows) {
    const w = showWindow(s);
    if (!w) continue;
    for (const b of busy) {
      if (b.start < w.end && b.end > w.start) add(s.id, { kind: "calendar", detail: b.summary });
    }
    const wk = s.date ? weekendKey(s.date) : null;
    if (!wk) continue;
    for (const o of shows) {
      if (o.id === s.id || o.decision !== "going" || !o.date) continue;
      if (weekendKey(o.date) === wk) add(s.id, { kind: "same_weekend", detail: `${o.artistName} (${o.city})` });
    }
  }
  return out;
}

// NOTE: Google Flights has no documented deep-link API. The `?q=` natural-language search URL
// is the closest working option; it opens a prefilled search the user can adjust.
export function flightsSearchUrl(city: string, date: string, endDate?: string | null, home: string = radarConfig.homeCity): string | null {
  const to = airportFor(city);
  const from = airportFor(home);
  if (!to || !from || to === from) return null;
  const out = addDays(date, 0);
  const back = addDays(endDate ?? date, 1);
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights from ${from} to ${to} on ${out} returning ${back}`)}&hl=en-IN&curr=INR`;
}
