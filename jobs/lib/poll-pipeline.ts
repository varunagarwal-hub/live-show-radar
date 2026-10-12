import { and, asc, eq, lt } from "drizzle-orm";
import { radarConfig } from "@radar/config";
import {
  dedupKey,
  contentHash,
  extractShow,
  ExtractionSchema,
  LlmUnavailableError,
  normalizeName,
  rememberSeen,
  snapshotAgeMinutes,
  toCandidates,
  type Extraction,
  type JobState,
  type Llm,
  type Snapshot,
  type TelegramSink,
} from "@radar/core";
import type { DbHandle } from "@radar/core/db";
import { artists, rawItems } from "@radar/core/db/schema";
import { knownDedupKeys, loadSnapshot } from "@radar/core/db/queries";
import type { InstagramSource, RawItem, Source, SourceHealth } from "@radar/sources";
import { EventCache, storeCandidate, type StoreContext } from "./store";

export interface PollDeps {
  getDb: () => Promise<DbHandle>;
  llm: Llm;
  tg: TelegramSink;
  chatId: string;
  dryRun: boolean;
  sources: Source[];
  instagram?: InstagramSource | null;
  state: JobState;
  snapshot: Snapshot | null;
  now: Date;
  log: (m: string) => void;
  /** Max raw items sent to the LLM per run (free-tier budget). */
  maxExtractions?: number;
}

export interface PollResult {
  stats: Record<string, number>;
  health: { source: string; health: SourceHealth }[];
  snapshot: Snapshot | null;
  /** Something was written; the snapshot was refreshed. */
  wroteDb: boolean;
  dbOpened: boolean;
}

const MAX_ATTEMPTS = 5;

/** Items worth extracting: Instagram and email always; listings/news only if they name a watched artist. */
export function prefilter(items: RawItem[], snapshot: Snapshot): RawItem[] {
  const names = snapshot.artists.filter((a) => !a.muted).flatMap((a) => [a.name, ...a.aliases]).map(normalizeName).filter((n) => n.length >= 3);
  return items.filter((it) => {
    if (it.source === "instagram" || it.source === "email") return true;
    if (it.meta.artistId || it.meta.structured) return true;
    const hay = ` ${normalizeName(it.text)} `;
    return names.some((n) => hay.includes(` ${n} `));
  });
}

export async function runPoll(d: PollDeps): Promise<PollResult> {
  const stats: Record<string, number> = {};
  const health: PollResult["health"] = [];
  let h: DbHandle | null = null;
  let wroteDb = false;
  const db = async () => (h ??= await d.getDb());

  // 1. Watchlist snapshot: from cache when fresh, else from the database.
  let snapshot = d.snapshot;
  if (!snapshot || snapshotAgeMinutes(snapshot, d.now) > radarConfig.intervals.snapshotMaxAgeMinutes) {
    snapshot = await loadSnapshot(await db(), d.now);
    stats.snapshotRefreshed = 1;
  }
  const watchlist = snapshot.artists;
  const seen = new Set(d.state.seen);

  // 2. Every source in isolation: one failure never stops the others.
  const fetched: RawItem[] = [];
  for (const src of d.sources) {
    try {
      const items = await src.fetchNewItems({ now: d.now, watchlist, accounts: snapshot.watchedAccounts, cursors: d.state.cursors, seen, log: d.log });
      fetched.push(...items);
      stats[`fetched_${src.name}`] = items.length;
    } catch (err) {
      d.log(`source ${src.name} failed: ${(err as Error).message}`);
      stats[`failed_${src.name}`] = 1;
    }
    const h0 = src.health() as SourceHealth & { skipped?: boolean };
    if (!h0.skipped) health.push({ source: src.name, health: h0 });
  }

  // Artists' Instagram bio links (shown when a show has no direct ticket link). Written only when
  // new or changed, which is rare, so this almost never wakes the database on its own.
  const bioUpdates = d.instagram
    ? [...d.instagram.websites].flatMap(([handle, url]) =>
        snapshot!.artists.filter((a) => a.instagramHandle?.toLowerCase() === handle && a.bioUrl !== url).map((a) => ({ id: a.id, url })),
      )
    : [];
  if (bioUpdates.length) {
    const hh = await db();
    await hh.batch(bioUpdates.map((u) => hh.db.update(artists).set({ bioUrl: u.url }).where(eq(artists.id, u.id))));
    stats.bioLinks = bioUpdates.length;
    wroteDb = true;
  }

  // 3. Cheap filters before any LLM call or database wake-up.
  const relevant = prefilter(fetched, snapshot);
  const keyed = relevant.map((it) => ({ it, key: dedupKey(it.source, it.externalId, it.text) }));
  const unseen = keyed.filter((k) => !seen.has(k.key));
  stats.relevant = relevant.length;
  stats.unseenLocal = unseen.length;
  // Remember sitemap detail pages we've opened, so they aren't refetched every run.
  rememberSeen(d.state, relevant.map((it) => it.meta.seenKey).filter((k): k is string => typeof k === "string"));
  rememberSeen(d.state, relevant.filter((it) => it.source === "instagram").map((it) => `igmedia:${it.externalId}`));

  // 4. Cache misses are checked against the database, then new items are stored as raw_items so a
  //    failed LLM call leaves them queued for the next run.
  let fresh = unseen;
  if (unseen.length) {
    const known = await knownDedupKeys(await db(), unseen.map((u) => u.key));
    fresh = unseen.filter((u) => !known.has(u.key));
    rememberSeen(d.state, unseen.map((u) => u.key));
  }
  stats.new = fresh.length;
  if (fresh.length) {
    if (d.instagram) await d.instagram.attachImages(fresh.map((f) => f.it));
    const rows = fresh.map(({ it, key }) => ({
      source: it.source,
      externalId: it.externalId,
      contentHash: contentHash(it.text),
      dedupKey: key,
      url: it.url,
      text: it.text,
      imageUrl: it.imageUrl ?? null,
      imageData: it.image?.data ?? null,
      imageMime: it.image?.mime ?? null,
      meta: it.meta,
      publishedAt: it.publishedAt ?? null,
    }));
    for (let i = 0; i < rows.length; i += 50) await (await db()).db.insert(rawItems).values(rows.slice(i, i + 50)).onConflictDoNothing();
    wroteDb = true;
  }

  // 5. Extract everything still unprocessed (this run's items, emails pushed by the Apps Script,
  //    and anything queued after an LLM outage). Only when the database is already awake, or once
  //    an hour via the heartbeat flush, so quiet runs stay database-free.
  if (h || d.state.lastFlushAt === null || d.now.getTime() - Date.parse(d.state.lastFlushAt) > 55 * 60_000) {
    const hh = await db();
    const pending = await hh.db
      .select()
      .from(rawItems)
      .where(and(eq(rawItems.processed, false), lt(rawItems.processAttempts, MAX_ATTEMPTS)))
      .orderBy(asc(rawItems.fetchedAt))
      .limit(d.maxExtractions ?? 40);
    stats.pending = pending.length;
    if (pending.length) {
      const sc: StoreContext = { h: hh, llm: d.llm, tg: d.tg, chatId: d.chatId, dryRun: d.dryRun, now: d.now, watchlist, log: d.log, stats };
      const cache = new EventCache(hh);
      let llmDown = false;
      for (const item of pending) {
        try {
          let ex: Extraction;
          const structured = ExtractionSchema.safeParse(item.meta.structured);
          if (structured.success) {
            ex = structured.data;
            stats.structured = (stats.structured ?? 0) + 1;
          } else {
            if (llmDown) continue;
            const r = await extractShow(
              d.llm,
              {
                source: item.source,
                text: item.text,
                url: item.url,
                postedBy: typeof item.meta.handle === "string" ? item.meta.handle : null,
                publishedAt: item.publishedAt,
                image: item.imageData && item.imageMime ? { mime: item.imageMime, data: Buffer.from(item.imageData) } : null,
              },
              d.now,
            );
            ex = r.data;
            stats.llmExtractions = (stats.llmExtractions ?? 0) + 1;
          }
          for (const c of toCandidates(ex, item.text, d.now)) {
            await storeCandidate(sc, cache, c, {
              source: item.source,
              rawItemId: item.id,
              url: item.url,
              postedBy: typeof item.meta.handle === "string" ? item.meta.handle : null,
              text: item.text,
            });
          }
          await hh.db.update(rawItems).set({ processed: true, processedAt: d.now, imageData: null, lastError: null }).where(eq(rawItems.id, item.id));
        } catch (err) {
          const msg = (err as Error).message.slice(0, 500);
          if (err instanceof LlmUnavailableError) {
            llmDown = true; // quota or outage: keep the queue for the next run
            stats.llmUnavailable = 1;
          }
          d.log(`item ${item.id} (${item.source}) failed: ${msg}`);
          await hh.db
            .update(rawItems)
            .set({ processAttempts: item.processAttempts + (err instanceof LlmUnavailableError ? 0 : 1), lastError: msg })
            .where(eq(rawItems.id, item.id));
          stats.itemErrors = (stats.itemErrors ?? 0) + 1;
        }
      }
      wroteDb = true;
    }
  }

  // 6. Anything written → refresh the snapshot so the tier watcher sees new events.
  if (wroteDb) snapshot = await loadSnapshot(await db(), d.now);
  return { stats, health, snapshot, wroteDb, dbOpened: h !== null };
}
