import type { FieldChange, TierJson } from "./db/schema";
import { normalizeCity } from "./cities";

/** Event fingerprint: artist_id + city + date. Undated announcements use "tbd" until a date arrives. */
export function fingerprint(artistId: number, city: string | null, date: string | null): string {
  const c = (normalizeCity(city) ?? "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `${artistId}|${c}|${date ?? "tbd"}`;
}

/** The mergeable fields of an event, shared by DB rows and freshly extracted candidates. */
export interface EventFields {
  artistId: number;
  city: string;
  venue: string | null;
  date: string | null;
  endDate: string | null;
  eventType: "concert" | "festival" | "club" | "other";
  ticketUrl: string | null;
  saleStartsAt: Date | null;
  earlyBirdStatus: "open" | "opening" | "sold_out" | "none" | "unknown";
  earlyBirdOpensAt: Date | null;
  earlyBirdClosesAt: Date | null;
  tiers: TierJson[];
  confidence: number;
  title: string | null;
  evidence: string | null;
}

export interface ExistingEvent extends EventFields {
  id: number;
  fingerprint: string;
  fieldHistory: FieldChange[];
}

const RESCHEDULED = /\b(reschedul\w*|postpone\w*|prepone\w*|new date|date (change|shift)\w*|moved to|shifted to|now on)\b/i;
const DAY = 86_400_000;
const daysApart = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / DAY;

/**
 * Finds the event an incoming candidate belongs to, in this order:
 * 1. Same fingerprint (artist, city, date).
 * 2. Dated candidate: an undated event for the same artist and city; or, when the source says the
 *    show was rescheduled, the same artist, city and venue within a week (the date then changes
 *    through mergeEvent and is recorded in field_history).
 * 3. Undated candidate: the undated event for that artist and city, else their soonest dated one
 *    ("Diljit's Delhi concert" news is about the show already known).
 * 4. City not known ("TBA") but dated: that artist's one event on that date.
 */
export function findExisting<E extends ExistingEvent>(incoming: Pick<EventFields, "artistId" | "city" | "date"> & Partial<Pick<EventFields, "venue" | "title" | "evidence">>, existing: E[]): E | undefined {
  const fp = fingerprint(incoming.artistId, incoming.city, incoming.date);
  const exact = existing.find((e) => e.fingerprint === fp);
  if (exact) return exact;
  const artist = existing.filter((e) => e.artistId === incoming.artistId);
  if (incoming.city === "TBA") {
    if (!incoming.date) return undefined;
    const sameDay = artist.filter((e) => e.date === incoming.date);
    return sameDay.length === 1 ? sameDay[0] : undefined;
  }
  const sameCity = artist.filter((e) => normalizeCity(e.city) === normalizeCity(incoming.city));
  if (incoming.date) {
    const undated = sameCity.find((e) => e.date === null);
    if (undated) return undated;
    if (RESCHEDULED.test(`${incoming.title ?? ""} ${incoming.evidence ?? ""}`)) {
      const v = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
      const moved = sameCity.filter((e) => e.date && daysApart(e.date, incoming.date!) <= 7 && (!incoming.venue || !e.venue || v(e.venue) === v(incoming.venue)));
      if (moved.length === 1) return moved[0];
    }
    return undefined;
  }
  const undated = sameCity.find((e) => e.date === null);
  if (undated) return undated;
  return [...sameCity].filter((e) => e.date).sort((a, b) => a.date!.localeCompare(b.date!))[0];
}

const sameValue = (a: unknown, b: unknown) =>
  a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : JSON.stringify(a) === JSON.stringify(b);

const isEmpty = (v: unknown) => v === null || v === undefined || (Array.isArray(v) && v.length === 0) || v === "unknown";

/** Fields that describe the current ticket state: the newest observation wins. */
const LIVE_FIELDS = new Set<keyof EventFields>(["earlyBirdStatus", "tiers"]);
const MERGEABLE: (keyof EventFields)[] = [
  "venue",
  "date",
  "endDate",
  "eventType",
  "ticketUrl",
  "saleStartsAt",
  "earlyBirdStatus",
  "earlyBirdOpensAt",
  "earlyBirdClosesAt",
  "tiers",
  "title",
  "evidence",
];

export interface MergeResult {
  patch: Partial<EventFields> & { fingerprint?: string; fieldHistory?: FieldChange[] };
  changes: FieldChange[];
  changed: boolean;
}

/**
 * Merges a newly found source into an existing event. Nulls are filled freely. A non-null field is
 * only overwritten when it is live ticket state, or the new source is at least as confident; every
 * overwrite is recorded in field_history with the source that caused it.
 */
export function mergeEvent(existing: ExistingEvent, incoming: EventFields, source: string, now = new Date()): MergeResult {
  const patch: MergeResult["patch"] = {};
  const changes: FieldChange[] = [];
  for (const field of MERGEABLE) {
    const cur = existing[field];
    const next = incoming[field];
    if (isEmpty(next) || sameValue(cur, next)) continue;
    if (isEmpty(cur)) {
      (patch as Record<string, unknown>)[field] = next;
      continue;
    }
    if (field === "evidence") continue; // keep the first quote
    const overwrite = LIVE_FIELDS.has(field) || incoming.confidence >= existing.confidence;
    if (overwrite) {
      (patch as Record<string, unknown>)[field] = next;
      changes.push({ field, from: cur, to: next, at: now.toISOString(), source });
    }
  }
  if (incoming.confidence > existing.confidence) patch.confidence = incoming.confidence;
  const date = patch.date ?? existing.date;
  if (date !== existing.date) patch.fingerprint = fingerprint(existing.artistId, existing.city, date);
  if (changes.length) patch.fieldHistory = [...existing.fieldHistory, ...changes];
  return { patch, changes, changed: Object.keys(patch).length > 0 };
}
