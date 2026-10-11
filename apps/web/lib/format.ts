/** Browser-safe display helpers (no server or config imports). */

const CODES: Record<string, string> = {
  Bengaluru: "BLR",
  Mumbai: "MUM",
  "Delhi NCR": "DEL",
  Pune: "PUNE",
  Chennai: "CHN",
  Hyderabad: "HYD",
  Kolkata: "KOL",
  Goa: "GOA",
};

export function cityCode(city: string): string {
  return CODES[city] ?? city.replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase();
}

const tz = "Asia/Kolkata";
const dayFmt = new Intl.DateTimeFormat("en-IN", { timeZone: tz, weekday: "short", day: "numeric", month: "short" });

/** "SAT 13 DEC" style parts for a YYYY-MM-DD date. */
export function stubDate(date: string | null, endDate?: string | null): string {
  if (!date) return "Date TBA";
  const p = Object.fromEntries(dayFmt.formatToParts(new Date(`${date}T12:00:00+05:30`)).map((x) => [x.type, x.value]));
  const one = `${p.weekday} ${p.day} ${p.month}`;
  if (endDate && endDate !== date) {
    const q = Object.fromEntries(dayFmt.formatToParts(new Date(`${endDate}T12:00:00+05:30`)).map((x) => [x.type, x.value]));
    return `${p.day}${p.month === q.month ? "" : ` ${p.month}`}–${q.day} ${q.month}`;
  }
  return one;
}

export function formatPrice(n: number | null): string {
  if (n === null) return "price TBA";
  if (n === 0) return "free";
  return `₹${n.toLocaleString("en-IN")}`;
}

export const DEADLINE_LABEL = {
  early_bird_closes: "Early-bird closes",
  early_bird_opens: "Early-bird opens",
  sale_starts: "On sale",
} as const;

/** "31 hrs", "45 min", "3 days" (no "left": the label says what it's counting to). */
export function shortCountdown(toIso: string, now = Date.now()): string {
  const ms = Date.parse(toIso) - now;
  if (ms <= 0) return "now";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.round(ms / 3_600_000);
  if (hrs < 72) return `${hrs} hrs`;
  return `${Math.round(ms / 86_400_000)} days`;
}

const whenFmt = new Intl.DateTimeFormat("en-IN", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit", hour12: true });
/** "Mon 10:05 AM" */
export function shortWhen(iso: string): string {
  const p = Object.fromEntries(whenFmt.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.hour}:${p.minute} ${String(p.dayPeriod ?? "").toUpperCase()}`.trim();
}

const mastheadFmt = new Intl.DateTimeFormat("en-IN", { timeZone: tz, weekday: "short", day: "numeric", month: "short" });
/** "Sun 11 Oct" */
export function mastheadDate(d = new Date()): string {
  const p = Object.fromEntries(mastheadFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.day} ${p.month}`;
}

export function daysToGo(date: string, now = new Date()): number {
  const today = new Date(new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10) + "T00:00:00Z").getTime();
  return Math.round((new Date(`${date}T00:00:00Z`).getTime() - today) / 86_400_000);
}
