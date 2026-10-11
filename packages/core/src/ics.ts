import { addDays } from "./time";
import { decideByDeadline, DEADLINE_LABEL, type DeadlineInput } from "./deadline";

export interface IcsShow extends DeadlineInput {
  id: number;
  artistName: string;
  city: string;
  venue: string | null;
  endDate: string | null;
  ticketUrl: string | null;
  sourceUrls: string[];
  decision: "going" | "maybe";
  updatedAt: Date;
}

const DOMAIN = "liveshowradar";

/** RFC 5545 text escaping. */
export function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Fold lines longer than 75 octets (RFC 5545 §3.1), never splitting a UTF-8 sequence. */
export function foldLine(line: string): string {
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    const limit = out.length === 0 ? 75 : 74; // continuation lines start with a space
    if (bytes + b > limit) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const dateValue = (iso: string) => iso.replace(/-/g, "");

/** Stable UIDs: re-subscribing or refreshing updates entries instead of duplicating them. */
export const showUid = (id: number) => `show-${id}@${DOMAIN}`;
export const deadlineUid = (id: number) => `decide-${id}@${DOMAIN}`;

function vevent(fields: [string, string][]): string[] {
  return ["BEGIN:VEVENT", ...fields.map(([k, v]) => foldLine(`${k}:${v}`)), "END:VEVENT"];
}

function showEvent(s: IcsShow, now: Date): string[] {
  const where = [s.venue, s.city].filter(Boolean).join(", ");
  const desc = [
    s.decision === "maybe" ? "You marked this Maybe." : "You're going.",
    s.ticketUrl ? `Tickets: ${s.ticketUrl}` : null,
    ...s.sourceUrls.slice(0, 3).map((u) => `Source: ${u}`),
  ]
    .filter(Boolean)
    .join("\n");
  const start = s.date!;
  const endExclusive = addDays(s.endDate && s.endDate > start ? s.endDate : start, 1);
  const fields: [string, string][] = [
    ["UID", showUid(s.id)],
    ["DTSTAMP", stamp(now)],
    ["LAST-MODIFIED", stamp(s.updatedAt)],
    ["SEQUENCE", String(Math.floor(s.updatedAt.getTime() / 1000) % 2_000_000_000)],
    ["DTSTART;VALUE=DATE", dateValue(start)],
    ["DTEND;VALUE=DATE", dateValue(endExclusive)],
    ["SUMMARY", icsEscape(`${s.decision === "maybe" ? "Maybe: " : ""}${s.artistName}${s.city ? ` (${s.city})` : ""}`)],
    ["LOCATION", icsEscape(where)],
    ["DESCRIPTION", icsEscape(desc)],
    ["STATUS", s.decision === "going" ? "CONFIRMED" : "TENTATIVE"],
    ["TRANSP", s.decision === "going" ? "OPAQUE" : "TRANSPARENT"],
  ];
  if (s.ticketUrl) fields.push(["URL", s.ticketUrl]);
  return vevent(fields);
}

function deadlineEvent(s: IcsShow, now: Date): string[] {
  const d = decideByDeadline(s, now);
  if (!d) return [];
  const start = new Date(d.at.getTime() - 15 * 60_000);
  return [
    ...vevent([
      ["UID", deadlineUid(s.id)],
      ["DTSTAMP", stamp(now)],
      ["LAST-MODIFIED", stamp(s.updatedAt)],
      ["DTSTART", stamp(start)],
      ["DTEND", stamp(d.at)],
      ["SUMMARY", icsEscape(`Decide: ${s.artistName} (${DEADLINE_LABEL[d.kind].toLowerCase()})`)],
      ["DESCRIPTION", icsEscape([`${DEADLINE_LABEL[d.kind]} at this time.`, s.ticketUrl ? `Tickets: ${s.ticketUrl}` : ""].filter(Boolean).join("\n"))],
      ["TRANSP", "TRANSPARENT"],
    ]).slice(0, -1),
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "TRIGGER:-PT0M",
    foldLine(`DESCRIPTION:${icsEscape(`Decide on ${s.artistName}`)}`),
    "END:VALARM",
    "END:VEVENT",
  ];
}

export function buildCalendar(shows: IcsShow[], opts: { name?: string; now?: Date } = {}): string {
  const now = opts.now ?? new Date();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Live Show Radar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    foldLine(`X-WR-CALNAME:${icsEscape(opts.name ?? "Live Show Radar")}`),
    "X-WR-TIMEZONE:Asia/Kolkata",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const s of shows) {
    if (s.date) lines.push(...showEvent(s, now));
    if (s.decision === "maybe") lines.push(...deadlineEvent(s, now));
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
