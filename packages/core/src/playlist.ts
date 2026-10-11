import { eq } from "drizzle-orm";
import type { DbHandle } from "./db/index";
import { artists, events, playlists } from "./db/schema";
import { kvGet, kvSet } from "./db/queries";
import { artistSetlists, musicBrainzId, rankSongs } from "./setlists";
import { refreshSpotifyToken, spotifyClient, type SpotifyClient } from "./spotify";
import { formatDayMon } from "./time";
import { sha256 } from "./hash";

/** `<Artist> — <City>, <D Mon>` (spec 4.11). */
export function playlistName(artist: string, city: string, date: string | null): string {
  return `${artist} — ${city}${date ? `, ${formatDayMon(date)}` : ""}`;
}

export interface PlaylistEnv {
  SPOTIFY_CLIENT_ID: string;
  SPOTIFY_CLIENT_SECRET: string;
  SPOTIFY_REFRESH_TOKEN: string;
  SETLISTFM_API_KEY?: string;
  MUSICBRAINZ_CONTACT?: string;
}

/** A Spotify client using the newest refresh token (rotated tokens are kept in kv). */
export async function spotifyFromStore(h: DbHandle, env: PlaylistEnv): Promise<SpotifyClient> {
  const stored = await kvGet<{ token: string; envFp: string }>(h, "spotify_refresh_token");
  const envFp = sha256(env.SPOTIFY_REFRESH_TOKEN).slice(0, 16);
  const refresh = stored && stored.envFp === envFp ? stored.token : env.SPOTIFY_REFRESH_TOKEN;
  const t = await refreshSpotifyToken(env.SPOTIFY_CLIENT_ID, env.SPOTIFY_CLIENT_SECRET, refresh);
  if (t.refreshToken && t.refreshToken !== refresh) await kvSet(h, "spotify_refresh_token", { token: t.refreshToken, envFp });
  return spotifyClient(t.accessToken);
}

export interface PlaylistResult {
  url: string;
  basis: "setlists" | "releases";
  trackCount: number;
  created: boolean;
}

/**
 * Creates (or refreshes) the private pre-show playlist for an event: setlist.fm songs ranked by
 * how often they're played, matched to Spotify tracks; recent releases when there are no
 * setlists. Idempotent: one playlist per event, refreshed in place.
 */
export async function ensurePlaylist(h: DbHandle, sp: SpotifyClient, env: PlaylistEnv, eventId: number, opts: { now?: Date; maxTracks?: number } = {}): Promise<PlaylistResult | null> {
  const now = opts.now ?? new Date();
  const max = opts.maxTracks ?? 25;
  const [row] = await h.db.select({ e: events, a: artists }).from(events).innerJoin(artists, eq(events.artistId, artists.id)).where(eq(events.id, eventId));
  if (!row) return null;
  const { e, a } = row;

  let mbid = a.musicbrainzId;
  if (!mbid && env.MUSICBRAINZ_CONTACT) {
    mbid = await musicBrainzId(a.name, env.MUSICBRAINZ_CONTACT).catch(() => null);
    if (mbid) await h.db.update(artists).set({ musicbrainzId: mbid }).where(eq(artists.id, a.id));
  }

  const uris: string[] = [];
  let basis: PlaylistResult["basis"] = "releases";
  if (mbid && env.SETLISTFM_API_KEY) {
    const ranked = rankSongs(await artistSetlists(mbid, env.SETLISTFM_API_KEY).catch(() => []));
    for (const song of ranked.slice(0, max + 10)) {
      const t = await sp.findTrack(a.name, song.title, a.spotifyId).catch(() => null);
      if (t && !uris.includes(t.uri)) uris.push(t.uri);
      if (uris.length >= max) break;
    }
    if (uris.length >= 5) basis = "setlists";
  }
  if (basis === "releases") {
    uris.length = 0;
    if (a.spotifyId) for (const t of await sp.recentTracks(a.spotifyId, max)) uris.push(t.uri);
  }
  if (!uris.length) return null;

  const [existing] = await h.db.select().from(playlists).where(eq(playlists.eventId, e.id));
  let id = existing?.spotifyPlaylistId;
  let url = existing?.url;
  const created = !existing;
  if (!id || !url) {
    const p = await sp.createPlaylist(
      playlistName(a.name, e.city, e.date),
      basis === "setlists" ? `What ${a.name} has been playing live lately, most-played first. Made by Live Show Radar.` : `${a.name}'s latest releases. Made by Live Show Radar.`,
    );
    id = p.id;
    url = p.url;
  }
  await sp.replacePlaylistItems(id, uris);
  await h.db
    .insert(playlists)
    .values({ eventId: e.id, spotifyPlaylistId: id, url, basis, trackCount: uris.length, refreshedAt: now })
    .onConflictDoUpdate({ target: playlists.eventId, set: { basis, trackCount: uris.length, refreshedAt: now } });
  return { url, basis, trackCount: uris.length, created };
}
