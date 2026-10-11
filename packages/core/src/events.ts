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

/**
 * Finds the event an incoming candidate belongs to: same fingerprint, or an undated event for the
 * same artist and city when the candidate brings a date (and vice versa).
 */
export function findExisting<E extends ExistingEvent>(incoming: Pick<EventFields, "artistId" | "city" | "date">, existing: E[]): E | undefined {
  const fp = fingerprint(incoming.artistId, incoming.city, incoming.date);
  const exact = existing.find((e) => e.fingerprint === fp);
  if (exact) return exact;
  const sameArtistCity = existing.filter((e) => e.artistId === incoming.artistId && normalizeCity(e.city) === normalizeCity(incoming.city));
  if (incoming.date) return sameArtistCity.find((e) => e.date === null);
  return sameArtistCity.length === 1 ? sameArtistCity[0] : undefined;
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
