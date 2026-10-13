/**
 * Sunday morning (IST): weekly self-check for missed shows (spec 4.10), playlist refresh for
 * this week's Going shows (4.11), and the digest (4.12).
 */
import { and, desc, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { optionalEnv, radarConfig, requireEnv } from "@radar/config";
import {
  addDays,
  artistSetlists,
  classifyPostShow,
  ensurePlaylist,
  findMisses,
  formatDigest,
  istDate,
  looksPostShow,
  mentionsIn,
  normalizeCity,
  sendOnce,
  setlistDate,
  sleep,
  spotifyFromStore,
  type DigestShow,
  type MissContext,
  type PlayedShow,
} from "@radar/core";
import { artists, decisions, events, misses, OWNER_USER_ID, rawItems, sourceHealth, watchedAccounts } from "@radar/core/db/schema";
import { followsArtist } from "@radar/core/db/people";
import { recentJobFailures } from "@radar/core/db/queries";
import { createRuntime, log, runJob } from "./lib/runtime";

const rt = createRuntime("sunday");
process.exitCode = await runJob("sunday", rt, async (rt) => {
  const h = await rt.getDb();
  const now = new Date();
  const today = istDate(now);
  const weekAgo = addDays(today, -7);
  const stats: Record<string, unknown> = {};
  let partial = false;

  const watch = (await h.db.select().from(artists)).filter((a) => !a.muted);
  const byId = new Map(watch.map((a) => [a.id, a]));

  // ---- 1. Self-check ----
  const missIds: number[] = [];
  if (radarConfig.features.selfCheck) {
    const played: PlayedShow[] = [];

    // setlist.fm: India setlists from the past 7 days.
    const key = optionalEnv("SETLISTFM_API_KEY");
    if (key) {
      for (const a of watch.filter((x) => x.musicbrainzId)) {
        try {
          for (const s of await artistSetlists(a.musicbrainzId!, key)) {
            const date = setlistDate(s.eventDate);
            if (s.venue?.city?.country.code !== "IN" || date < weekAgo || date > today) continue;
            played.push({ artistId: a.id, city: s.venue.city.name, date, evidenceUrl: s.url ?? null, via: "setlistfm" });
          }
        } catch (err) {
          log(`setlist.fm ${a.name}: ${(err as Error).message}`);
        }
        await sleep(600); // stay well inside setlist.fm's rate limit
      }
    }

    // Instagram: post-show signals in posts the poll already stored (no extra API calls).
    const handleToArtist = new Map(watch.filter((a) => a.instagramHandle).map((a) => [a.instagramHandle!.toLowerCase(), a]));
    const posts = await h.db
      .select()
      .from(rawItems)
      .where(and(eq(rawItems.source, "instagram"), gte(rawItems.fetchedAt, new Date(now.getTime() - 8 * 86_400_000))));
    let classified = 0;
    for (const p of posts) {
      const handle = String(p.meta.handle ?? "").toLowerCase();
      const artist = handleToArtist.get(handle);
      if (!artist || !looksPostShow(p.text) || classified >= 40) continue;
      classified++;
      try {
        const r = await classifyPostShow(rt.llm(), p.text, p.publishedAt ?? p.fetchedAt);
        if (r.is_post_show && r.city && r.date && r.date >= weekAgo) {
          played.push({ artistId: artist.id, city: r.city, date: r.date, evidenceUrl: p.url, via: "instagram", mentions: mentionsIn(p.text) });
        }
      } catch {
        partial = true;
        break;
      }
    }

    const known = await h.db
      .select({ artistId: events.artistId, city: events.city, date: events.date, status: events.status })
      .from(events)
      .where(and(isNotNull(events.date), gte(events.date, addDays(weekAgo, -2))));
    const health = await h.db.select().from(sourceHealth);
    const unhealthy = health.filter((s) => !s.healthy || (s.lastNonzeroAt && s.lastNonzeroAt.getTime() < now.getTime() - 3 * 86_400_000)).map((s) => s.source);
    const watched = new Set((await h.db.select({ h: watchedAccounts.handle }).from(watchedAccounts).where(eq(watchedAccounts.active, true))).map((r) => r.h));
    const found = findMisses(played, known, (id): MissContext | null => {
      const a = byId.get(id);
      return a ? { artist: { id, instagramHandle: a.instagramHandle, handleStatus: a.handleStatus }, unhealthySources: unhealthy, watchedHandles: watched } : null;
    });
    for (const m of found) {
      const [row] = await h.db
        .insert(misses)
        .values({ artistId: m.artistId, city: normalizeCity(m.city) ?? m.city, date: m.date, evidenceUrl: m.evidenceUrl, likelyCause: m.likelyCause, suggestedHandle: m.suggestedHandle })
        .onConflictDoNothing()
        .returning({ id: misses.id });
      if (row) missIds.push(row.id);
    }
    Object.assign(stats, { setlistsPlayed: played.filter((p) => p.via === "setlistfm").length, postsClassified: classified, misses: missIds.length });
  }

  // ---- 2. Playlist refresh for Going shows in the coming week ----
  if (radarConfig.features.playlists && optionalEnv("SPOTIFY_REFRESH_TOKEN")) {
    const week = await h.db
      .select({ id: events.id })
      .from(events)
      .innerJoin(decisions, and(eq(decisions.eventId, events.id), eq(decisions.userId, OWNER_USER_ID)))
      .where(and(eq(decisions.status, "going"), eq(events.status, "announced"), gte(events.date, today), lte(events.date, addDays(today, 8))));
    if (week.length) {
      try {
        const env = requireEnv(["SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET", "SPOTIFY_REFRESH_TOKEN"]);
        const sp = await spotifyFromStore(h, env);
        let refreshed = 0;
        for (const e of week) if (await ensurePlaylist(h, sp, { ...env, SETLISTFM_API_KEY: optionalEnv("SETLISTFM_API_KEY"), MUSICBRAINZ_CONTACT: optionalEnv("MUSICBRAINZ_CONTACT") }, e.id, { now })) refreshed++;
        stats.playlistsRefreshed = refreshed;
      } catch (err) {
        partial = true;
        stats.playlistError = (err as Error).message;
      }
    }
  }

  // ---- 3. Digest ----
  const rows = await h.db
    .select({ e: events, name: artists.name, decision: decisions.status })
    .from(events)
    .innerJoin(artists, eq(events.artistId, artists.id))
    .leftJoin(decisions, and(eq(decisions.eventId, events.id), eq(decisions.userId, OWNER_USER_ID)))
    // The digest is the owner's: only their artists.
    .where(and(eq(events.status, "announced"), gte(events.date, today), followsArtist(OWNER_USER_ID)))
    .orderBy(events.date);
  const upcoming: DigestShow[] = rows
    .filter((r) => r.e.date! <= addDays(today, 60))
    .map((r) => ({ ...r.e, artistName: r.name, decision: r.decision }));
  const missRows = missIds.length
    ? await h.db.select({ m: misses, name: artists.name }).from(misses).innerJoin(artists, eq(misses.artistId, artists.id)).where(inArray(misses.id, missIds)).orderBy(desc(misses.date))
    : [];
  const digest = formatDigest({
    upcoming,
    misses: missRows.map((r) => ({ id: r.m.id, artistName: r.name, city: r.m.city, date: r.m.date, likelyCause: r.m.likelyCause, suggestedHandle: r.m.suggestedHandle, evidenceUrl: r.m.evidenceUrl })),
    health: await h.db.select().from(sourceHealth),
    failures: await recentJobFailures(h, new Date(now.getTime() - 7 * 86_400_000)),
    now,
  });
  const res = await sendOnce(h, rt.tg, { dedupKey: `digest:${today}`, kind: "digest", eventId: null, chatId: rt.chatId, html: digest.html, keyboard: digest.keyboard.length ? digest.keyboard : undefined, dryRun: rt.dryRun });
  stats.digest = res;
  return { stats, partial };
});
