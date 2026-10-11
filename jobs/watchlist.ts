/**
 * Daily: Spotify sync → priority tiers → MusicBrainz IDs → Instagram handle proposals,
 * watched-account seeds, and Instagram token upkeep. Spec 4.1.
 */
import { and, eq, isNull } from "drizzle-orm";
import { optionalEnv, radarConfig, requireEnv, watchedAccounts as accountSeeds } from "@radar/config";
import { assignTiers, encodeCallback, esc, musicBrainzId, proposeHandle, sendOnce, spotifyFromStore, SpotifyReauthError, type ListeningData } from "@radar/core";
import { artists, watchedAccounts } from "@radar/core/db/schema";
import { loadSnapshot } from "@radar/core/db/queries";
import { maintainInstagramToken } from "./lib/instagram-auth";
import { createRuntime, log, runJob } from "./lib/runtime";

const rt = createRuntime("watchlist");
process.exitCode = await runJob("watchlist", rt, async (rt) => {
  const stats: Record<string, unknown> = {};
  const h = await rt.getDb();
  const now = new Date();
  let partial = false;

  // Promoter and venue accounts from config/watched-accounts.ts (database-only additions are kept).
  for (const a of accountSeeds) await h.db.insert(watchedAccounts).values(a).onConflictDoNothing();

  // 1–3. Spotify listening → tiers.
  try {
    const env = requireEnv(["SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET", "SPOTIFY_REFRESH_TOKEN"]);
    const sp = await spotifyFromStore(h, env);
    const img = (a: { images?: { url: string }[] }) => a.images?.[0]?.url ?? null;
    const [followed, shortTop, mediumTop, recent] = await Promise.all([sp.followedArtists(), sp.topArtists("short_term"), sp.topArtists("medium_term"), sp.recentlyPlayedArtists()]);
    const data: ListeningData = {
      followed: followed.map((a) => ({ id: a.id, name: a.name, imageUrl: img(a) })),
      shortTop: shortTop?.map((a) => ({ id: a.id, name: a.name, imageUrl: img(a) })) ?? null,
      mediumTop: mediumTop?.map((a) => ({ id: a.id, name: a.name, imageUrl: img(a) })) ?? null,
      recent,
    };
    if (!shortTop || !mediumTop) stats.topArtistsUnavailable = true;
    if (!recent) stats.recentlyPlayedUnavailable = true;
    const tiered = assignTiers(data);
    const existing = await h.db.select().from(artists);
    let added = 0;
    for (const t of tiered) {
      const row = existing.find((e) => e.spotifyId === t.spotifyId) ?? existing.find((e) => !e.spotifyId && e.name.toLowerCase() === t.name.toLowerCase());
      if (row) {
        await h.db
          .update(artists)
          .set({
            spotifyId: t.spotifyId,
            name: t.name,
            imageUrl: t.imageUrl ?? row.imageUrl,
            priorityTier: row.tierOverride ?? t.tier,
            followed: t.followed,
            listenedNotFollowed: t.listenedNotFollowed,
            updatedAt: now,
          })
          .where(eq(artists.id, row.id));
      } else {
        await h.db.insert(artists).values({ spotifyId: t.spotifyId, name: t.name, imageUrl: t.imageUrl, priorityTier: t.tier, followed: t.followed, listenedNotFollowed: t.listenedNotFollowed });
        added++;
      }
    }
    // Unfollowed and no longer listened to: drop to tier C (kept, so past events stay intact).
    const current = new Set(tiered.map((t) => t.spotifyId));
    for (const e of existing) {
      if (e.spotifyId && !current.has(e.spotifyId) && (e.followed || e.priorityTier !== "C")) {
        await h.db.update(artists).set({ followed: false, priorityTier: e.tierOverride ?? "C", updatedAt: now }).where(eq(artists.id, e.id));
      }
    }
    Object.assign(stats, { artists: tiered.length, added, tierA: tiered.filter((t) => t.tier === "A").length });
  } catch (err) {
    partial = true;
    stats.spotifyError = (err as Error).message;
    if (err instanceof SpotifyReauthError) {
      await sendOnce(h, rt.tg, {
        dedupKey: `spotify-reauth:${now.toISOString().slice(0, 7)}-${Math.floor(now.getUTCDate() / 7)}`,
        kind: "token_warning",
        eventId: null,
        chatId: rt.chatId,
        html: "⚠️ <b>Spotify needs signing in again.</b> Refresh tokens now expire six months after you authorise. Run <code>pnpm spotify:auth</code> on your computer and update SPOTIFY_REFRESH_TOKEN (README → Spotify). Until then the watchlist won't pick up new artists.",
        dryRun: rt.dryRun,
      });
    } else log(`spotify: ${(err as Error).message}`);
  }

  // 4. MusicBrainz IDs (for setlist.fm), at most 25 per day at 1 request/second.
  const contact = optionalEnv("MUSICBRAINZ_CONTACT");
  if (contact) {
    const missing = await h.db.select().from(artists).where(and(isNull(artists.musicbrainzId), eq(artists.muted, false))).limit(25);
    let found = 0;
    for (const a of missing) {
      const id = await musicBrainzId(a.name, contact).catch(() => null);
      if (id) {
        await h.db.update(artists).set({ musicbrainzId: id }).where(eq(artists.id, a.id));
        found++;
      }
    }
    stats.musicbrainz = `${found}/${missing.length}`;
  }

  // 5. Instagram handle proposals for new artists: unconfirmed until Karan confirms.
  const needHandles = await h.db.select().from(artists).where(and(isNull(artists.handleProposedAt), isNull(artists.instagramHandle), eq(artists.muted, false))).limit(15);
  const proposed: { id: number; name: string; handle: string }[] = [];
  for (const a of needHandles) {
    try {
      const p = await proposeHandle(rt.llm(), { name: a.name });
      await h.db
        .update(artists)
        .set({
          handleProposedAt: now,
          ...(p.instagram_handle && p.confidence >= 0.5 ? { instagramHandle: p.instagram_handle, handleStatus: "unconfirmed" as const } : {}),
          aliases: [...new Set([...a.aliases, ...p.aliases])].slice(0, 12),
          updatedAt: now,
        })
        .where(eq(artists.id, a.id));
      if (p.instagram_handle && p.confidence >= 0.5) proposed.push({ id: a.id, name: a.name, handle: p.instagram_handle });
    } catch (err) {
      log(`handle proposal for ${a.name}: ${(err as Error).message}`);
      break; // LLM down: try again tomorrow
    }
  }
  for (const p of proposed.slice(0, 8)) {
    await sendOnce(h, rt.tg, {
      dedupKey: `handle:${p.id}:${p.handle}`,
      kind: "handle_proposal",
      eventId: null,
      chatId: rt.chatId,
      html: `🔎 New on your watchlist: <b>${esc(p.name)}</b>. Is <a href="https://www.instagram.com/${esc(p.handle)}/">@${esc(p.handle)}</a> their official Instagram?`,
      keyboard: [
        [
          { text: "Yes, that's them", callback_data: encodeCallback({ kind: "handle", action: "ok", artistId: p.id }) },
          { text: "No", callback_data: encodeCallback({ kind: "handle", action: "no", artistId: p.id }) },
        ],
      ],
      silent: true,
      dryRun: rt.dryRun,
    });
  }
  stats.handlesProposed = proposed.length;

  // 6. Instagram long-lived token: refresh before expiry; warn on Telegram if that fails.
  if (radarConfig.features.instagram && optionalEnv("FACEBOOK_APP_ID") && optionalEnv("FACEBOOK_APP_SECRET")) {
    const t = await maintainInstagramToken(h, rt.state, rt.tg, rt.chatId, rt.dryRun, now);
    stats.instagramToken = t.status;
    if (t.status !== "ok") partial = true;
  }

  return { stats, snapshot: await loadSnapshot(h, now), partial };
});
