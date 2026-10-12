import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { DbHandle } from "./index";
import {
  alerts,
  artists,
  decisions,
  events,
  eventSources,
  jobRuns,
  kv,
  rawItems,
  sourceHealth,
  tierSnapshots,
  watchedAccounts,
  type EventRow,
} from "./schema";
import type { Snapshot, SnapshotEvent, PendingRun, PendingHealth } from "../state";
import { addDays, istDate } from "../time";
import { radarConfig } from "@radar/config";

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Builds the cached snapshot jobs use to skip the database on quiet runs. */
export async function loadSnapshot(h: DbHandle, now = new Date()): Promise<Snapshot> {
  const { db } = h;
  const since = addDays(istDate(now), -1);
  const [artistRows, accountRows, eventRows] = await Promise.all([
    db.select().from(artists),
    db.select().from(watchedAccounts).where(eq(watchedAccounts.active, true)),
    db
      .select({ e: events, artistName: artists.name, tier: artists.priorityTier, decision: decisions.status })
      .from(events)
      .innerJoin(artists, eq(events.artistId, artists.id))
      .leftJoin(decisions, eq(decisions.eventId, events.id))
      .where(and(or(gte(events.date, since), isNull(events.date)), inArray(events.status, ["announced", "possible"]))),
  ]);
  const ids = eventRows.map((r) => r.e.id);
  const [srcRows, alertRows, hashRows] = ids.length
    ? await Promise.all([
        db.select().from(eventSources).where(inArray(eventSources.eventId, ids)),
        db.select({ key: alerts.dedupKey, dryRun: alerts.dryRun }).from(alerts).where(inArray(alerts.eventId, ids)),
        db
          .selectDistinctOn([tierSnapshots.eventId], { eventId: tierSnapshots.eventId, stateHash: tierSnapshots.stateHash })
          .from(tierSnapshots)
          .where(inArray(tierSnapshots.eventId, ids))
          .orderBy(tierSnapshots.eventId, desc(tierSnapshots.capturedAt)),
      ])
    : [[], [], []];
  const hashes = new Map(hashRows.map((r) => [r.eventId, r.stateHash]));
  const upcoming: SnapshotEvent[] = eventRows.map(({ e, artistName, tier, decision }) => ({
    ...eventToSnapshotFields(e),
    artistName,
    priorityTier: tier,
    decision: decision ?? null,
    lastStateHash: hashes.get(e.id) ?? null,
    sources: srcRows.filter((s) => s.eventId === e.id).map((s) => ({ source: s.source, url: s.url })),
  }));
  return {
    version: 1,
    generatedAt: now.toISOString(),
    artists: artistRows.map((a) => ({
      id: a.id,
      name: a.name,
      aliases: a.aliases,
      spotifyId: a.spotifyId,
      instagramHandle: a.instagramHandle,
      handleStatus: a.handleStatus,
      matchWeight: a.matchWeight,
      muted: a.muted,
      priorityTier: a.priorityTier,
      bioUrl: a.bioUrl,
    })),
    watchedAccounts: accountRows.map((a) => ({ handle: a.handle, kind: a.kind, city: a.city })),
    upcoming,
    sentAlertKeys: alertRows.map((a) => `${a.dryRun ? "dry:" : ""}${a.key}`),
  };
}

export function eventToSnapshotFields(e: EventRow) {
  return {
    id: e.id,
    artistId: e.artistId,
    city: e.city,
    venue: e.venue,
    date: e.date,
    endDate: e.endDate,
    ticketUrl: e.ticketUrl,
    bookingUrl: e.bookingUrl,
    bookingCheckedAt: iso(e.bookingCheckedAt),
    saleStartsAt: iso(e.saleStartsAt),
    earlyBirdStatus: e.earlyBirdStatus,
    earlyBirdOpensAt: iso(e.earlyBirdOpensAt),
    earlyBirdClosesAt: iso(e.earlyBirdClosesAt),
    tiers: e.tiers,
    confidence: e.confidence,
    urgency: e.urgency,
    handleUnconfirmed: e.handleUnconfirmed,
  };
}

/** Which of these dedup keys are already stored (one query, used on cache misses). */
export async function knownDedupKeys(h: DbHandle, keys: string[]): Promise<Set<string>> {
  if (!keys.length) return new Set();
  const out = new Set<string>();
  for (let i = 0; i < keys.length; i += 500) {
    const rows = await h.db.select({ k: rawItems.dedupKey }).from(rawItems).where(inArray(rawItems.dedupKey, keys.slice(i, i + 500)));
    for (const r of rows) out.add(r.k);
  }
  return out;
}

/** Upcoming or undated events for these artists: the candidates a new source may merge into. */
export async function eventsForArtists(h: DbHandle, artistIds: number[], now = new Date()) {
  if (!artistIds.length) return [];
  const since = addDays(istDate(now), -1);
  return h.db
    .select()
    .from(events)
    .where(and(inArray(events.artistId, artistIds), or(gte(events.date, since), isNull(events.date))));
}

export async function kvGet<T>(h: DbHandle, key: string): Promise<T | null> {
  const [row] = await h.db.select().from(kv).where(eq(kv.key, key));
  return (row?.value as T) ?? null;
}

export async function kvSet(h: DbHandle, key: string, value: unknown): Promise<void> {
  await h.db
    .insert(kv)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: kv.key, set: { value, updatedAt: new Date() } });
}

/** Writes buffered job_runs and source-health observations in one batch. */
export async function flushPending(h: DbHandle, runs: PendingRun[], health: PendingHealth[]): Promise<void> {
  const queries: PromiseLike<unknown>[] = [];
  if (runs.length) {
    queries.push(
      h.db.insert(jobRuns).values(
        runs.map((r) => ({
          job: r.job,
          startedAt: new Date(r.startedAt),
          finishedAt: new Date(r.finishedAt),
          status: r.status,
          statsJson: r.stats,
          error: r.error,
        })),
      ),
    );
  }
  // Fold health observations per source in time order.
  const bySource = new Map<string, PendingHealth[]>();
  for (const o of [...health].sort((a, b) => a.at.localeCompare(b.at))) bySource.set(o.source, [...(bySource.get(o.source) ?? []), o]);
  if (bySource.size) {
    const existing = await h.db.select().from(sourceHealth).where(inArray(sourceHealth.source, [...bySource.keys()]));
    for (const [source, obs] of bySource) {
      const prev = existing.find((e) => e.source === source);
      let failures = prev?.consecutiveFailures ?? 0;
      let lastOkAt = prev?.lastOkAt ?? null;
      let lastNonzeroAt = prev?.lastNonzeroAt ?? null;
      let lastError = prev?.lastError ?? null;
      let lastCount = prev?.lastItemCount ?? 0;
      let lastRunAt = prev?.lastRunAt ?? null;
      for (const o of obs) {
        const at = new Date(o.at);
        lastRunAt = at;
        if (o.ok) {
          failures = 0;
          lastOkAt = at;
          lastCount = o.itemCount;
          if (o.itemCount > 0) lastNonzeroAt = at;
        } else {
          failures += 1;
          lastError = o.error;
        }
      }
      const zeroForTooLong =
        lastOkAt !== null && (lastNonzeroAt === null || lastOkAt.getTime() - lastNonzeroAt.getTime() > radarConfig.health.zeroItemsHours * 3_600_000);
      const healthy = failures < radarConfig.health.failureRunsBeforeUnhealthy && !zeroForTooLong;
      const row = { source, lastOkAt, lastRunAt, lastItemCount: lastCount, lastNonzeroAt: lastNonzeroAt ?? (prev ? null : lastOkAt), consecutiveFailures: failures, lastError, healthy };
      queries.push(h.db.insert(sourceHealth).values(row).onConflictDoUpdate({ target: sourceHealth.source, set: row }));
    }
  }
  await h.batch(queries);
}

/** Jobs that haven't had a successful run within `hours` (spec 9: warn once per incident). */
export async function staleJobs(h: DbHandle, jobs: string[], hours: number, now = new Date()): Promise<{ job: string; lastOkAt: Date | null }[]> {
  const rows = await h.db
    .select({ job: jobRuns.job, lastOk: sql<string | null>`max(${jobRuns.finishedAt}) filter (where ${jobRuns.status} <> 'error')` })
    .from(jobRuns)
    .where(inArray(jobRuns.job, jobs))
    .groupBy(jobRuns.job);
  const cutoff = now.getTime() - hours * 3_600_000;
  return jobs
    .map((job) => {
      const r = rows.find((x) => x.job === job);
      const lastOkAt = r?.lastOk ? new Date(r.lastOk) : null;
      return { job, lastOkAt };
    })
    .filter((j) => j.lastOkAt === null || j.lastOkAt.getTime() < cutoff);
}

export async function recentJobFailures(h: DbHandle, since: Date) {
  return h.db
    .select()
    .from(jobRuns)
    .where(and(gte(jobRuns.startedAt, since), eq(jobRuns.status, "error")))
    .orderBy(desc(jobRuns.startedAt))
    .limit(30);
}

export async function oldJobRunsCleanup(h: DbHandle, before: Date): Promise<void> {
  await h.db.delete(jobRuns).where(lt(jobRuns.startedAt, before));
}
