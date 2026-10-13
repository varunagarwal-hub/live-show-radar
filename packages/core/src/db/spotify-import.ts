import { eq, inArray } from "drizzle-orm";
import { refreshSpotifyToken, spotifyClient, SpotifyReauthError, type SpotifyClient } from "../spotify";
import { openSecret, sealSecret } from "../secretbox";
import { assignTiers, type ListeningData } from "../watchlist";
import type { DbHandle } from "./index";
import { claimForOwner, refreshArtistGlobals } from "./people";
import { artists, follows, users } from "./schema";

/** Pulls followed, top and recently played artists from someone's Spotify. */
export async function listeningData(sp: SpotifyClient): Promise<ListeningData> {
  const img = (a: { images?: { url: string }[] }) => a.images?.[0]?.url ?? null;
  const [followed, shortTop, mediumTop, recent] = await Promise.all([sp.followedArtists(), sp.topArtists("short_term"), sp.topArtists("medium_term"), sp.recentlyPlayedArtists()]);
  return {
    followed: followed.map((a) => ({ id: a.id, name: a.name, imageUrl: img(a) })),
    shortTop: shortTop?.map((a) => ({ id: a.id, name: a.name, imageUrl: img(a) })) ?? null,
    mediumTop: mediumTop?.map((a) => ({ id: a.id, name: a.name, imageUrl: img(a) })) ?? null,
    recent,
  };
}

/** Finds the shared artist row for a Spotify artist, creating it if nobody follows them yet. */
export async function upsertSpotifyArtist(h: DbHandle, a: { spotifyId: string; name: string; imageUrl: string | null }): Promise<number> {
  const [existing] = await h.db.select({ id: artists.id, imageUrl: artists.imageUrl }).from(artists).where(eq(artists.spotifyId, a.spotifyId));
  if (existing) {
    if (!existing.imageUrl && a.imageUrl) await h.db.update(artists).set({ imageUrl: a.imageUrl, updatedAt: new Date() }).where(eq(artists.id, existing.id));
    return existing.id;
  }
  const [row] = await h.db
    .insert(artists)
    // Muted (nobody watches it) until the follow that follows this insert: a brand-new artist must
    // not count as an unclaimed artist of the owner's.
    .values({ spotifyId: a.spotifyId, name: a.name, imageUrl: a.imageUrl, priorityTier: "B", muted: true })
    .onConflictDoUpdate({ target: artists.spotifyId, set: { name: a.name } })
    .returning({ id: artists.id });
  return row!.id;
}

/**
 * A member's Spotify listening → their follows, tiered the same way as the owner's (spec 4.1).
 * Their own tier and mute choices are kept on later syncs; new artists are added.
 */
export async function importSpotifyFollows(h: DbHandle, userId: number, data: ListeningData): Promise<{ artists: number; added: number }> {
  const tiered = assignTiers(data);
  const mine = new Set((await h.db.select({ id: follows.artistId }).from(follows).where(eq(follows.userId, userId))).map((r) => r.id));
  const ids: number[] = [];
  let added = 0;
  for (const t of tiered) {
    const id = await upsertSpotifyArtist(h, t);
    ids.push(id);
    if (!mine.has(id)) {
      await claimForOwner(h, id);
      await h.db.insert(follows).values({ userId, artistId: id, tier: t.tier, source: "spotify" }).onConflictDoNothing();
      added++;
    }
  }
  await refreshArtistGlobals(h, ids);
  return { artists: tiered.length, added };
}

/** Opens a member's Spotify with their stored token (rotating it if Spotify sends a new one). */
export async function memberSpotify(h: DbHandle, userId: number, env: { SPOTIFY_CLIENT_ID: string; SPOTIFY_CLIENT_SECRET: string; TOKEN_ENC_KEY: string }): Promise<SpotifyClient | null> {
  const [u] = await h.db.select({ enc: users.spotifyRefreshEnc }).from(users).where(eq(users.id, userId));
  if (!u?.enc) return null;
  try {
    const t = await refreshSpotifyToken(env.SPOTIFY_CLIENT_ID, env.SPOTIFY_CLIENT_SECRET, openSecret(u.enc, env.TOKEN_ENC_KEY));
    if (t.refreshToken) await h.db.update(users).set({ spotifyRefreshEnc: sealSecret(t.refreshToken, env.TOKEN_ENC_KEY) }).where(eq(users.id, userId));
    return spotifyClient(t.accessToken);
  } catch (err) {
    // Revoked or expired (Spotify's 6-month limit): forget it; they can connect again.
    if (err instanceof SpotifyReauthError) await h.db.update(users).set({ spotifyRefreshEnc: null }).where(eq(users.id, userId));
    throw err;
  }
}

/** Syncs every member who connected Spotify (the daily watchlist job). */
export async function syncMemberSpotify(h: DbHandle, env: { SPOTIFY_CLIENT_ID: string; SPOTIFY_CLIENT_SECRET: string; TOKEN_ENC_KEY: string }, log: (m: string) => void = () => {}) {
  const people = await h.db.select({ id: users.id }).from(users).where(inArray(users.role, ["member"]));
  let synced = 0;
  for (const p of people) {
    try {
      const sp = await memberSpotify(h, p.id, env);
      if (!sp) continue;
      await importSpotifyFollows(h, p.id, await listeningData(sp));
      await h.db.update(users).set({ spotifySyncedAt: new Date() }).where(eq(users.id, p.id));
      synced++;
    } catch (err) {
      log(`spotify for user ${p.id}: ${(err as Error).message}`);
    }
  }
  return synced;
}

