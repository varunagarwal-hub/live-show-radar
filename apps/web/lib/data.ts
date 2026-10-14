import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { radarConfig } from "@radar/config";
import { airportFor, isBookingLikeUrl, ticketSearchUrl, decideByDeadline, fetchBusy, findClashes, flightsSearchUrl, istDate, addDays, normalizeCity, weekPart, type Busy, type Clash } from "@radar/core";
import { followsArtist, mutedFor, tierFor } from "@radar/core/db/people";
import { artists, decisions, events, eventSources, follows, jobRuns, playlists, sourceHealth, watchedAccounts } from "@radar/core/db/schema";
import type { TierJson } from "@radar/core/db/schema";
import type { Viewer } from "./auth";
import { getDb } from "./db";
import { after } from "next/server";
import { kvGet, kvSet } from "@radar/core/db/queries";

/** Everything a stub needs, serialisable for client components (dates as ISO strings). */
export interface ShowCard {
  id: number;
  artistId: number;
  artistName: string;
  priorityTier: "A" | "B" | "C";
  imageUrl: string | null;
  /** The artist's Instagram page, only for handles Karan confirmed. */
  instagramUrl: string | null;
  instagramHandle: string | null;
  city: string;
  isHome: boolean;
  venue: string | null;
  date: string | null;
  endDate: string | null;
  eventType: string;
  /** Source ticket link, else the booking page found by the lookup (booking.ts). */
  ticketUrl: string | null;
  /** Artist's Instagram bio link, and a plain ticket search, for shows without a booking page. */
  bioUrl: string | null;
  searchUrl: string;
  tiers: TierJson[];
  earlyBirdStatus: "open" | "opening" | "sold_out" | "none" | "unknown";
  earlyBirdClosesAt: string | null;
  saleStartsAt: string | null;
  urgency: "urgent" | "normal" | "possible";
  /** Found only by a low-confidence source; worth checking before buying. */
  unconfirmed: boolean;
  decision: "going" | "maybe" | "pass" | "not_interested" | null;
  /** They said they have tickets (Decide → Book your tickets). */
  ticketsBooked: boolean;
  deadline: { at: string; kind: "early_bird_closes" | "early_bird_opens" | "sale_starts" } | null;
  soldOut: boolean;
  playlistUrl: string | null;
  sources: { source: string; url: string | null }[];
  createdAt: string;
  clashes: Clash[];
  flightsUrl: string | null;
  /** Airport codes for the boarding-pass button, e.g. { from: "BLR", to: "GOI" }. */
  flightRoute: { from: string; to: string } | null;
  weekPart: "weekend" | "weekday" | null;
  handleUnconfirmed: boolean;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export interface ShowQuery {
  from?: string;
  to?: string;
  cities?: string[];
  tiers?: ("A" | "B" | "C")[];
  decisions?: ("going" | "maybe" | "pass" | "not_interested" | "undecided")[];
  includeUndated?: boolean;
}

let busyCache: { at: number; busy: Busy[] } | null = null;
let refreshing = false;
const BUSY_FRESH_MS = 10 * 60_000;
type StoredBusy = { at: number; busy: { start: string; end: string; summary: string }[] };

/** Fetches the owner's calendar and keeps it in memory and in the database for other instances. */
async function refreshBusy(url: string, now: Date, timeoutMs: number): Promise<Busy[]> {
  const busy = await Promise.race([
    fetchBusy(url, now, new Date(now.getTime() + 400 * 86_400_000)),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("calendar timeout")), timeoutMs)),
  ]);
  busyCache = { at: Date.now(), busy };
  const stored: StoredBusy = { at: busyCache.at, busy: busy.map((b) => ({ start: b.start.toISOString(), end: b.end.toISOString(), summary: b.summary })) };
  await kvSet(await getDb(), "busy_cache", stored);
  return busy;
}

/**
 * Google Calendar busy times for clash warnings, served stale-while-revalidate: pages use the last
 * copy (memory, else the database) at once and refresh it in the background after the response.
 * Fetching Google's calendar takes ~0.7 s, so it must never hold up a page. Only when no copy
 * exists anywhere does a page wait, and then for at most 1.5 s.
 */
async function busyTimes(now: Date): Promise<Busy[]> {
  const url = process.env.GOOGLE_CALENDAR_ICS_URL;
  if (!url || !radarConfig.features.clashDetection) return [];
  if (!busyCache) {
    const stored = await kvGet<StoredBusy>(await getDb(), "busy_cache").catch(() => null);
    if (stored) busyCache = { at: stored.at, busy: stored.busy.map((b) => ({ start: new Date(b.start), end: new Date(b.end), summary: b.summary })) };
  }
  if (busyCache) {
    if (now.getTime() - busyCache.at >= BUSY_FRESH_MS && !refreshing) {
      refreshing = true;
      after(() => refreshBusy(url, new Date(), 15_000).catch(() => {}).finally(() => (refreshing = false)));
    }
    return busyCache.busy;
  }
  return refreshBusy(url, now, 1500).catch(() => []);
}

/** The flight route from this person's home city, when the show is somewhere else. */
function routeTo(home: string, city: string): { from: string; to: string } | null {
  const from = airportFor(home);
  const to = airportFor(city);
  return from && to && to !== from ? { from, to } : null;
}

const sameCity = (a: string, b: string) => normalizeCity(a) === normalizeCity(b);

/** One person's shows: their artists, their tiers and decisions, their home city. */
export async function loadShows(v: Viewer, q: ShowQuery = {}, now = new Date()): Promise<ShowCard[]> {
  const { db } = await getDb();
  const today = istDate(now);
  const tier = tierFor(v.id);
  const conds = [
    // Possible (low-confidence) shows are listed too, marked Unconfirmed: you may have decided on them.
    inArray(events.status, ["announced", "possible"]),
    followsArtist(v.id),
    q.includeUndated === false ? gte(events.date, q.from ?? today) : or(gte(events.date, q.from ?? today), isNull(events.date)),
  ];
  if (q.to) conds.push(lte(events.date, q.to));
  if (q.cities?.length) conds.push(inArray(events.city, q.cities));
  if (q.tiers?.length) conds.push(inArray(tier, q.tiers));
  if (q.decisions?.length) {
    const st = q.decisions.filter((d) => d !== "undecided") as ("going" | "maybe" | "pass" | "not_interested")[];
    conds.push(or(st.length ? inArray(decisions.status, st) : undefined, q.decisions.includes("undecided") ? isNull(decisions.status) : undefined)!);
  }
  const rows = await db
    .select({ e: events, a: artists, tier, decision: decisions.status, booked: decisions.ticketsBookedAt, playlist: playlists.url })
    .from(events)
    .innerJoin(artists, eq(events.artistId, artists.id))
    .leftJoin(decisions, and(eq(decisions.eventId, events.id), eq(decisions.userId, v.id)))
    .leftJoin(playlists, eq(playlists.eventId, events.id))
    .where(and(...conds))
    .orderBy(asc(events.date))
    .limit(300);
  const ids = rows.map((r) => r.e.id);
  const srcs = ids.length ? await db.select().from(eventSources).where(inArray(eventSources.eventId, ids)) : [];
  // Busy times come from the owner's own calendar; nobody else has connected one.
  const busy = v.isOwner ? await busyTimes(now) : [];
  const clashes = findClashes(
    rows.map((r) => ({ id: r.e.id, artistName: r.a.name, city: r.e.city, date: r.e.date, endDate: r.e.endDate, decision: r.decision })),
    busy,
  );
  return rows.map(({ e, a, tier: myTier, decision, booked, playlist }) => {
    const d = decideByDeadline(e, now);
    const home = sameCity(e.city, v.homeCity);
    return {
      id: e.id,
      artistId: a.id,
      artistName: a.name,
      priorityTier: myTier,
      imageUrl: a.imageUrl,
      instagramHandle: a.handleStatus === "confirmed" ? a.instagramHandle : null,
      instagramUrl: a.handleStatus === "confirmed" && a.instagramHandle ? `https://www.instagram.com/${a.instagramHandle}/` : null,
      city: e.city,
      isHome: home,
      venue: e.venue,
      date: e.date,
      endDate: e.endDate,
      eventType: e.eventType,
      ticketUrl: e.ticketUrl ?? e.bookingUrl,
      bioUrl: isBookingLikeUrl(a.bioUrl) ? a.bioUrl : null,
      searchUrl: ticketSearchUrl(a.name, e.city, e.date),
      tiers: e.tiers,
      earlyBirdStatus: e.earlyBirdStatus,
      earlyBirdClosesAt: iso(e.earlyBirdClosesAt),
      saleStartsAt: iso(e.saleStartsAt),
      urgency: e.urgency,
      unconfirmed: e.status === "possible",
      decision: decision ?? null,
      ticketsBooked: decision === "going" && booked !== null,
      deadline: d ? { at: d.at.toISOString(), kind: d.kind } : null,
      soldOut: e.tiers.length > 0 && e.tiers.every((t) => t.status === "sold_out"),
      // Pre-show playlists are private ones in the owner's Spotify: only the owner can open them.
      playlistUrl: v.isOwner ? (playlist ?? null) : null,
      sources: srcs.filter((s) => s.eventId === e.id).map((s) => ({ source: s.source, url: s.url })),
      createdAt: e.createdAt.toISOString(),
      clashes: clashes.get(e.id) ?? [],
      flightsUrl: e.date && !home ? flightsSearchUrl(e.city, e.date, e.endDate, v.homeCity) : null,
      flightRoute: routeTo(v.homeCity, e.city),
      weekPart: e.date ? weekPart(e.date) : null,
      handleUnconfirmed: e.handleUnconfirmed,
    };
  });
}

export async function loadHome(v: Viewer, now = new Date()) {
  const shows = await loadShows(v, {}, now);
  const visible = shows.filter((s) => s.decision !== "pass" && s.decision !== "not_interested");
  const in72h = now.getTime() + 72 * 3_600_000;
  // Every upcoming show you are going to, soonest first: the stage rotates through them.
  const goingNext = shows.filter((s) => s.decision === "going" && s.date).slice(0, 10);
  const nextUp = goingNext[0] ?? null;
  const closingSoon = visible
    .filter((s) => s.deadline && Date.parse(s.deadline.at) <= in72h)
    .sort((a, b) => Date.parse(a.deadline!.at) - Date.parse(b.deadline!.at));
  const decide = sortByDeadline(visible.filter((s) => s.decision === "maybe"));
  const recent = [...visible].filter((s) => s.decision === null).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8);
  return { nextUp, goingNext, closingSoon, decide, recent, total: shows.length };
}

export function sortByDeadline(list: ShowCard[]): ShowCard[] {
  return [...list].sort((a, b) => (a.deadline ? Date.parse(a.deadline.at) : Infinity) - (b.deadline ? Date.parse(b.deadline.at) : Infinity) || (a.date ?? "9").localeCompare(b.date ?? "9"));
}

export async function loadMonth(v: Viewer, month: string, now = new Date()) {
  const from = `${month}-01`;
  const to = addDays(addDays(from, 32).slice(0, 8) + "01", -1);
  const shows = await loadShows(v, { from, to, includeUndated: false }, now);
  return shows.filter((s) => s.decision !== "not_interested");
}

/** This person's artists with their own tier and mute (muted ones included, to unmute). */
export async function loadArtists(v: Viewer) {
  const { db } = await getDb();
  const tier = tierFor(v.id);
  const muted = mutedFor(v.id);
  const rows = await db
    .select({ a: artists, tier, muted })
    .from(artists)
    .where(or(followsArtist(v.id), sql`exists (select 1 from ${follows} f where f.artist_id = ${artists.id} and f.user_id = ${v.id})`))
    .orderBy(asc(tier), asc(artists.name));
  return rows.map((r) => ({ ...r.a, priorityTier: r.tier, muted: r.muted }));
}

export async function loadHealth() {
  const { db } = await getDb();
  const [health, runs, accounts] = await Promise.all([
    db.select().from(sourceHealth).orderBy(asc(sourceHealth.source)),
    db.select().from(jobRuns).orderBy(desc(jobRuns.startedAt)).limit(60),
    db.select().from(watchedAccounts).orderBy(asc(watchedAccounts.handle)),
  ]);
  const lastOk = new Map<string, Date>();
  for (const r of runs) if (r.status !== "error" && r.finishedAt && !lastOk.has(r.job)) lastOk.set(r.job, r.finishedAt);
  return { health, runs, accounts, lastOk };
}
