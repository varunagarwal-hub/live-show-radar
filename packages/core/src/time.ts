/** Everything is stored in UTC and shown in IST (Asia/Kolkata, UTC+5:30, no DST). */
export const IST = "Asia/Kolkata";
const IST_OFFSET_MS = 330 * 60_000;

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-IN", { timeZone: IST, ...opts });
const weekdayFmt = fmt({ weekday: "short" });
const timeFmt = fmt({ hour: "numeric", minute: "2-digit", hour12: true });
const dayMonFmt = fmt({ day: "numeric", month: "short" });
const fullFmt = fmt({ weekday: "short", day: "numeric", month: "short", year: "numeric" });

/** "Fri 11:59 PM" */
export function formatShortIST(d: Date): string {
  return `${weekdayFmt.format(d)} ${timeFmt.format(d).toUpperCase().replace(/\s+/g, " ")}`;
}

/** "Fri 11:59 PM" if within 6 days, else "12 Dec, 11:59 PM". */
export function formatWhenIST(d: Date, now = new Date()): string {
  const days = (d.getTime() - now.getTime()) / 86_400_000;
  if (days >= 0 && days < 6) return formatShortIST(d);
  return `${dayMonFmt.format(d)}, ${timeFmt.format(d).toUpperCase()}`;
}

/** "5 Dec" — used in playlist names. */
export function formatDayMon(isoDate: string): string {
  return dayMonFmt.format(dateOnlyToUtcNoonIST(isoDate));
}

/** "Sat, 13 Dec 2026" for an ISO date (YYYY-MM-DD). */
export function formatDateIST(isoDate: string): string {
  const p = Object.fromEntries(fullFmt.formatToParts(dateOnlyToUtcNoonIST(isoDate)).map((x) => [x.type, x.value]));
  return `${p.weekday}, ${p.day} ${p.month} ${p.year}`;
}

/** Midday IST on a calendar date, as a Date: safe for weekday/day maths with no edge drift. */
export function dateOnlyToUtcNoonIST(isoDate: string): Date {
  return new Date(`${isoDate}T12:00:00+05:30`);
}

/** The IST calendar date (YYYY-MM-DD) of an instant. */
export function istDate(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** An instant for a wall-clock time in IST, e.g. istInstant("2026-12-12", "23:59"). */
export function istInstant(isoDate: string, hhmm = "00:00"): Date {
  return new Date(`${isoDate}T${hhmm}:00+05:30`);
}

export function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "31 hrs left", "45 min left", "3 days left", or "passed". */
export function countdown(to: Date, now = new Date()): string {
  const ms = to.getTime() - now.getTime();
  if (ms <= 0) return "passed";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins} min left`;
  const hrs = Math.round(ms / 3_600_000);
  if (hrs < 72) return `${hrs} ${hrs === 1 ? "hr" : "hrs"} left`;
  return `${Math.round(ms / 86_400_000)} days left`;
}

/** Days from today (IST) to an ISO date: 0 = today. */
export function daysUntil(isoDate: string, now = new Date()): number {
  const today = new Date(`${istDate(now)}T00:00:00Z`).getTime();
  return Math.round((new Date(`${isoDate}T00:00:00Z`).getTime() - today) / 86_400_000);
}

/** "weekend" for Fri–Sun shows, else "weekday" (used on Decide-by cards for travel). */
export function weekPart(isoDate: string): "weekend" | "weekday" {
  const dow = dateOnlyToUtcNoonIST(isoDate).getUTCDay();
  return dow === 0 || dow === 5 || dow === 6 ? "weekend" : "weekday";
}

/**
 * Parse an LLM- or page-supplied datetime. Strings without an offset are IST wall-clock times,
 * since every source is Indian; dates without a time are treated as end of day for deadlines.
 */
export function parseIstDateTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return istInstant(v, "23:59");
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(v);
  const d = new Date(hasZone ? v : `${v.replace(" ", "T")}+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
}
