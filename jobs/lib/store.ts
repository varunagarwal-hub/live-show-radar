import { eq, inArray } from "drizzle-orm";
import { radarConfig } from "@radar/config";
import {
  computeUrgency,
  eventKeyboard,
  findExisting,
  fingerprint,
  formatAlert,
  matchArtist,
  mergeEvent,
  normalizeCity,
  parseIstDateTime,
  sendOnce,
  verifyMatch,
  type AlertEvent,
  type EventFields,
  type ExistingEvent,
  type Llm,
  type ShowCandidate,
  type TelegramSink,
  type WatchArtist,
} from "@radar/core";
import type { DbHandle } from "@radar/core/db";
import { artists, events, eventSources, type EventRow } from "@radar/core/db/schema";
import { eventsForArtists } from "@radar/core/db/queries";

export interface StoreContext {
  h: DbHandle;
  llm: Llm;
  tg: TelegramSink;
  chatId: string;
  dryRun: boolean;
  now: Date;
  watchlist: WatchArtist[];
  log: (m: string) => void;
  stats: Record<string, number>;
}

export interface CandidateSource {
  source: string;
  rawItemId: number | null;
  url: string | null;
  postedBy: string | null;
  text: string;
}

const bump = (s: Record<string, number>, k: string, n = 1) => (s[k] = (s[k] ?? 0) + n);

function toFields(c: ShowCandidate, artistId: number): EventFields {
  return {
    artistId,
    city: normalizeCity(c.city) ?? "TBA",
    venue: c.venue,
    date: c.date,
    endDate: c.endDate,
    eventType: c.eventType,
    ticketUrl: c.ticketUrl,
    saleStartsAt: parseIstDateTime(c.saleStartsAt),
    earlyBirdStatus: c.earlyBird.status,
    earlyBirdOpensAt: parseIstDateTime(c.earlyBird.opens_at),
    earlyBirdClosesAt: parseIstDateTime(c.earlyBird.closes_at),
    tiers: c.tiers,
    confidence: c.confidence,
    title: null,
    evidence: c.evidence || null,
  };
}

const asExisting = (e: EventRow): ExistingEvent => ({ ...e, date: e.date, endDate: e.endDate });

/** Per-run cache of candidate events by artist, so several items about one show merge in memory. */
export class EventCache {
  private byArtist = new Map<number, EventRow[]>();
  constructor(private readonly h: DbHandle) {}

  async forArtist(artistId: number, now: Date): Promise<EventRow[]> {
    if (!this.byArtist.has(artistId)) this.byArtist.set(artistId, await eventsForArtists(this.h, [artistId], now));
    return this.byArtist.get(artistId)!;
  }

  put(row: EventRow): void {
    const list = this.byArtist.get(row.artistId) ?? [];
    const i = list.findIndex((r) => r.id === row.id);
    if (i >= 0) list[i] = row;
    else list.push(row);
    this.byArtist.set(row.artistId, list);
  }
}

export type StoreOutcome = "created" | "merged" | "unchanged" | "unmatched" | "rejected";

/**
 * Spec 4.5–4.7 for one candidate: match → fingerprint → create or merge → alert once.
 * Low-confidence shows are stored as "possible" and get a quiet please-check message; if a later
 * source confirms them, they're upgraded and the real alert goes out (still only once).
 */
export async function storeCandidate(sc: StoreContext, cache: EventCache, c: ShowCandidate, src: CandidateSource): Promise<StoreOutcome> {
  const match = matchArtist(c.artistName, sc.watchlist, { postedBy: src.postedBy, sourceText: src.text }, radarConfig.fuzzyMatchFloor);
  if (!match) {
    bump(sc.stats, "unmatched");
    return "unmatched";
  }
  if (match.needsVerification) {
    bump(sc.stats, "llmVerify");
    const ok = await verifyMatch(sc.llm, c.artistName, match.artist, `${c.evidence}\n${src.text.slice(0, 1200)}`, c.coArtists);
    if (!ok) {
      sc.log(`match rejected: "${c.artistName}" ≠ ${match.artist.name}`);
      bump(sc.stats, "matchRejected");
      return "rejected";
    }
  }
  const artist = match.artist;
  const fields = toFields(c, artist.id);
  const existingRows = await cache.forArtist(artist.id, sc.now);
  const existing = findExisting(fields, existingRows.map(asExisting));
  let row: EventRow;
  let outcome: StoreOutcome;

  if (!existing) {
    const urgency = computeUrgency({ priorityTier: artist.priorityTier, ...fields }, sc.now);
    const [inserted] = await sc.h.db
      .insert(events)
      .values({
        ...fields,
        fingerprint: fingerprint(artist.id, fields.city, fields.date),
        urgency,
        status: urgency === "possible" ? "possible" : "announced",
        handleUnconfirmed: match.viaUnconfirmedHandle,
      })
      .onConflictDoNothing({ target: events.fingerprint })
      .returning();
    if (!inserted) {
      // Another run created it a moment ago; fall back to a merge on the next item.
      bump(sc.stats, "raceSkipped");
      return "unchanged";
    }
    row = inserted;
    outcome = "created";
    bump(sc.stats, "eventsCreated");
  } else {
    const { patch, changed } = mergeEvent(existing, fields, src.source, sc.now);
    const prev = existingRows.find((r) => r.id === existing.id)!;
    const merged = { ...prev, ...patch } as EventRow;
    const urgency = computeUrgency({ priorityTier: artist.priorityTier, ...merged, confidence: Math.max(merged.confidence, fields.confidence) }, sc.now);
    const status = prev.status === "possible" && urgency !== "possible" ? "announced" : prev.status;
    if (changed || urgency !== prev.urgency || status !== prev.status) {
      const [updated] = await sc.h.db
        .update(events)
        .set({ ...patch, urgency, status, handleUnconfirmed: prev.handleUnconfirmed && match.viaUnconfirmedHandle, updatedAt: sc.now })
        .where(eq(events.id, prev.id))
        .returning();
      row = updated!;
      outcome = "merged";
      bump(sc.stats, "eventsMerged");
    } else {
      row = prev;
      outcome = "unchanged";
    }
  }
  cache.put(row);

  await sc.h.db
    .insert(eventSources)
    .values({ eventId: row.id, rawItemId: src.rawItemId, source: src.source, url: src.url })
    .onConflictDoNothing();

  await alertForEvent(sc, row, artist);
  return outcome;
}

/** Sends the one new-show alert (or the quiet possible-show note) for an event, if not sent yet. */
export async function alertForEvent(sc: StoreContext, row: EventRow, artist: Pick<WatchArtist, "name" | "priorityTier" | "bioUrl">): Promise<void> {
  const sources = await sc.h.db.select({ source: eventSources.source, url: eventSources.url }).from(eventSources).where(eq(eventSources.eventId, row.id));
  const ae = toAlertEvent(row, artist, sources);
  const possible = row.status === "possible";
  const res = await sendOnce(sc.h, sc.tg, {
    dedupKey: possible ? `possible:${row.id}` : `new:${row.id}`,
    kind: possible ? "possible_show" : "new_event",
    eventId: row.id,
    chatId: sc.chatId,
    html: formatAlert(ae, sc.now),
    keyboard: eventKeyboard(row.id, { compact: possible }),
    silent: possible,
    dryRun: sc.dryRun,
  });
  if (res === "sent") bump(sc.stats, possible ? "possibleSent" : "alertsSent");
}

export function toAlertEvent(row: EventRow, artist: Pick<WatchArtist, "name" | "priorityTier" | "bioUrl">, sources: { source: string; url: string | null }[]): AlertEvent {
  return {
    bioUrl: artist.bioUrl ?? null,
    id: row.id,
    artistName: artist.name,
    priorityTier: artist.priorityTier,
    city: row.city,
    venue: row.venue,
    date: row.date,
    endDate: row.endDate,
    tiers: row.tiers,
    earlyBirdStatus: row.earlyBirdStatus,
    earlyBirdOpensAt: row.earlyBirdOpensAt,
    earlyBirdClosesAt: row.earlyBirdClosesAt,
    saleStartsAt: row.saleStartsAt,
    ticketUrl: row.ticketUrl,
    confidence: row.confidence,
    urgency: row.urgency,
    handleUnconfirmed: row.handleUnconfirmed,
    sources,
  };
}

/** Loads the artist rows referenced by a set of events (for alert formatting outside the poll). */
export async function artistsById(h: DbHandle, ids: number[]) {
  if (!ids.length) return new Map<number, typeof artists.$inferSelect>();
  const rows = await h.db.select().from(artists).where(inArray(artists.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}
