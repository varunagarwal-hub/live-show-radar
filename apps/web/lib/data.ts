import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { radarConfig } from "@radar/config";
import { isBookingLikeUrl, ticketSearchUrl, decideByDeadline, fetchBusy, findClashes, flightsSearchUrl, isHomeCity, istDate, addDays, weekPart, type Busy, type Clash } from "@radar/core";
import { artists, decisions, events, eventSources, jobRuns, playlists, sourceHealth, watchedAccounts } from "@radar/core/db/schema";
import type { TierJson } from "@radar/core/db/schema";
import { getDb } from "./db";

/** Everything a stub needs, serialisable for client components (dates as ISO strings). */
export interface ShowCard {
  id: number;
  artistId: number;
  artistName: string;
  priorityTier: "A" | "B" | "C";
  imageUrl: string | null;
  city: string;
  isHome: boolean;
  venue: string | null;
  date: string | null;
  endDate: string | null;
  eventType: string;
  ticketUrl: string | null;
  /** Artist's Instagram bio link, and a ticket search, for shows without a direct link. */
  bioUrl: string | null;
  searchUrl: string;
  tiers: TierJson[];
  earlyBirdStatus: "open" | "opening" | "sold_out" | "none" | "unknown";
  earlyBirdClosesAt: string | null;
  saleStartsAt: string | null;
  urgency: "urgent" | "normal" | "possible";
  decision: "going" | "maybe" | "pass" | "not_interested" | null;
  deadline: { at: string; kind: "early_bird_closes" | "early_bird_opens" | "sale_starts" } | null;
  soldOut: boolean;
  playlistUrl: string | null;
  sources: { source: string; url: string | null }[];
  createdAt: string;
  clashes: Clash[];
  flightsUrl: string | null;
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

/** Google Calendar busy times, cached for 10 minutes per server instance. */
async function busyTimes(now: Date): Promise<Busy[]> {
  const url = process.env.GOOGLE_CALENDAR_ICS_URL;
  if (!url || !radarConfig.features.clashDetection) return [];
  if (busyCache && now.getTime() - busyCache.at < 10 * 60_000) return busyCache.busy;
  try {
    const busy = await fetchBusy(url, now, new Date(now.getTime() + 400 * 86_400_000));
    busyCache = { at: now.getTime(), busy };
    return busy;
  } catch {
    return busyCache?.busy ?? [];
  }
}

export async function loadShows(q: ShowQuery = {}, now = new Date()): Promise<ShowCard[]> {
  const { db } = await getDb();
  const today = istDate(now);
  const conds = [
    eq(events.status, "announced"),
    eq(artists.muted, false),
    q.includeUndated === false ? gte(events.date, q.from ?? today) : or(gte(events.date, q.from ?? today), isNull(events.date)),
  ];
  if (q.to) conds.push(lte(events.date, q.to));
  if (q.cities?.length) conds.push(inArray(events.city, q.cities));
  if (q.tiers?.length) conds.push(inArray(artists.priorityTier, q.tiers));
  if (q.decisions?.length) {
    const st = q.decisions.filter((d) => d !== "undecided") as ("going" | "maybe" | "pass" | "not_interested")[];
    conds.push(or(st.length ? inArray(decisions.status, st) : undefined, q.decisions.includes("undecided") ? isNull(decisions.status) : undefined)!);
  }
  const rows = await db
    .select({ e: events, a: artists, decision: decisions.status, playlist: playlists.url })
    .from(events)
    .innerJoin(artists, eq(events.artistId, artists.id))
    .leftJoin(decisions, eq(decisions.eventId, events.id))
    .leftJoin(playlists, eq(playlists.eventId, events.id))
    .where(and(...conds))
    .orderBy(asc(events.date))
    .limit(300);
  const ids = rows.map((r) => r.e.id);
  const srcs = ids.length ? await db.select().from(eventSources).where(inArray(eventSources.eventId, ids)) : [];
  const busy = await busyTimes(now);
  const clashes = findClashes(
    rows.map((r) => ({ id: r.e.id, artistName: r.a.name, city: r.e.city, date: r.e.date, endDate: r.e.endDate, decision: r.decision })),
    busy,
  );
  return rows.map(({ e, a, decision, playlist }) => {
    const d = decideByDeadline(e, now);
    return {
      id: e.id,
      artistId: a.id,
      artistName: a.name,
      priorityTier: a.priorityTier,
      imageUrl: a.imageUrl,
      city: e.city,
      isHome: isHomeCity(e.city),
      venue: e.venue,
      date: e.date,
      endDate: e.endDate,
      eventType: e.eventType,
      ticketUrl: e.ticketUrl,
      bioUrl: isBookingLikeUrl(a.bioUrl) ? a.bioUrl : null,
      searchUrl: ticketSearchUrl(a.name, e.city, e.date),
      tiers: e.tiers,
      earlyBirdStatus: e.earlyBirdStatus,
      earlyBirdClosesAt: iso(e.earlyBirdClosesAt),
      saleStartsAt: iso(e.saleStartsAt),
      urgency: e.urgency,
      decision: decision ?? null,
      deadline: d ? { at: d.at.toISOString(), kind: d.kind } : null,
      soldOut: e.tiers.length > 0 && e.tiers.every((t) => t.status === "sold_out"),
      playlistUrl: playlist ?? null,
      sources: srcs.filter((s) => s.eventId === e.id).map((s) => ({ source: s.source, url: s.url })),
      createdAt: e.createdAt.toISOString(),
      clashes: clashes.get(e.id) ?? [],
      flightsUrl: e.date && !isHomeCity(e.city) ? flightsSearchUrl(e.city, e.date, e.endDate) : null,
      weekPart: e.date ? weekPart(e.date) : null,
      handleUnconfirmed: e.handleUnconfirmed,
    };
  });
}

export async function loadHome(now = new Date()) {
  const shows = await loadShows({}, now);
  const visible = shows.filter((s) => s.decision !== "pass" && s.decision !== "not_interested");
  const in72h = now.getTime() + 72 * 3_600_000;
  const nextUp = shows.find((s) => s.decision === "going" && s.date) ?? null;
  const closingSoon = visible
    .filter((s) => s.deadline && Date.parse(s.deadline.at) <= in72h)
    .sort((a, b) => Date.parse(a.deadline!.at) - Date.parse(b.deadline!.at));
  const decide = sortByDeadline(visible.filter((s) => s.decision === "maybe"));
  const recent = [...visible].filter((s) => s.decision === null).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8);
  return { nextUp, closingSoon, decide, recent, total: shows.length };
}

export function sortByDeadline(list: ShowCard[]): ShowCard[] {
  return [...list].sort((a, b) => (a.deadline ? Date.parse(a.deadline.at) : Infinity) - (b.deadline ? Date.parse(b.deadline.at) : Infinity) || (a.date ?? "9").localeCompare(b.date ?? "9"));
}

export async function loadMonth(month: string, now = new Date()) {
  const from = `${month}-01`;
  const to = addDays(addDays(from, 32).slice(0, 8) + "01", -1);
  const shows = await loadShows({ from, to, includeUndated: false }, now);
  return shows.filter((s) => s.decision !== "not_interested");
}

export async function loadArtists() {
  const { db } = await getDb();
  return db.select().from(artists).orderBy(asc(artists.priorityTier), asc(artists.name));
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
