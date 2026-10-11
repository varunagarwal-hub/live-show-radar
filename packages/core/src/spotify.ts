import { z } from "zod";
import { fetchJson } from "./http";
import { HttpError } from "./retry";

/** The refresh token stopped working (revoked, or older than Spotify's 6-month limit). */
export class SpotifyReauthError extends Error {}

const Token = z.object({ access_token: z.string(), refresh_token: z.string().optional(), expires_in: z.number() });

/**
 * Authorization Code flow with a stored refresh token. Spotify may return a new refresh token;
 * callers persist it. Since 2026 refresh tokens expire 6 months after authorization regardless
 * of use, so invalid_grant means "run `pnpm spotify:auth` again", not "retry".
 */
export async function refreshSpotifyToken(clientId: string, clientSecret: string, refreshToken: string): Promise<{ accessToken: string; refreshToken: string | null }> {
  try {
    const raw = await fetchJson("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}` },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }).toString(),
      attempts: 2,
    });
    const t = Token.parse(raw);
    return { accessToken: t.access_token, refreshToken: t.refresh_token ?? null };
  } catch (err) {
    if (err instanceof HttpError && err.status === 400 && /invalid_grant/.test(err.body)) throw new SpotifyReauthError("Spotify refresh token expired or revoked");
    throw err;
  }
}

const Image = z.object({ url: z.string(), width: z.number().nullable().optional(), height: z.number().nullable().optional() });
const SimpleArtist = z.object({ id: z.string(), name: z.string() });
const FullArtist = SimpleArtist.extend({ images: z.array(Image).optional(), genres: z.array(z.string()).optional() });
export type SpotifyArtist = z.infer<typeof FullArtist>;
const Track = z.object({ id: z.string(), uri: z.string(), name: z.string(), artists: z.array(SimpleArtist) });
export type SpotifyTrack = z.infer<typeof Track>;
const Album = z.object({ id: z.string(), name: z.string(), release_date: z.string(), album_type: z.string().optional() });

const Followed = z.object({ artists: z.object({ items: z.array(FullArtist), cursors: z.object({ after: z.string().nullable().optional() }).optional(), next: z.string().nullable() }) });
const Paged = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item), next: z.string().nullable().optional() });
const Recent = Paged(z.object({ track: z.object({ artists: z.array(SimpleArtist) }), played_at: z.string() }));
const Search = z.object({ tracks: z.object({ items: z.array(Track) }) });
const Playlist = z.object({ id: z.string(), external_urls: z.object({ spotify: z.string() }) });

export interface SpotifyClient {
  followedArtists(): Promise<SpotifyArtist[]>;
  /** Null when the endpoint isn't available to this app (degrade gracefully). */
  topArtists(range: "short_term" | "medium_term"): Promise<SpotifyArtist[] | null>;
  recentlyPlayedArtists(): Promise<{ id: string; name: string; plays: number }[] | null>;
  artist(id: string): Promise<SpotifyArtist | null>;
  recentTracks(artistId: string, max: number): Promise<SpotifyTrack[]>;
  findTrack(artistName: string, title: string, artistId: string | null): Promise<SpotifyTrack | null>;
  createPlaylist(name: string, description: string): Promise<{ id: string; url: string }>;
  replacePlaylistItems(playlistId: string, uris: string[]): Promise<void>;
}

const API = "https://api.spotify.com/v1";

export function spotifyClient(accessToken: string): SpotifyClient {
  const call = <T extends z.ZodType>(schema: T, path: string, init: { method?: string; body?: unknown } = {}): Promise<z.infer<T>> =>
    fetchJson(path.startsWith("http") ? path : `${API}${path}`, {
      method: init.method,
      headers: { authorization: `Bearer ${accessToken}`, ...(init.body ? { "content-type": "application/json" } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      attempts: 3,
    }).then((r) => schema.parse(r));

  const optional = async <T>(fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (err) {
      // 403/404: the endpoint isn't available in Development Mode for this app. Degrade.
      if (err instanceof HttpError && (err.status === 403 || err.status === 404)) return null;
      throw err;
    }
  };

  return {
    async followedArtists() {
      const out: SpotifyArtist[] = [];
      let url: string | null = `${API}/me/following?type=artist&limit=50`;
      while (url) {
        const page: z.infer<typeof Followed> = await call(Followed, url);
        out.push(...page.artists.items);
        url = page.artists.next;
      }
      return out;
    },
    topArtists(range) {
      return optional(async () => (await call(Paged(FullArtist), `/me/top/artists?time_range=${range}&limit=50`)).items);
    },
    recentlyPlayedArtists() {
      return optional(async () => {
        const r = await call(Recent, "/me/player/recently-played?limit=50");
        const counts = new Map<string, { id: string; name: string; plays: number }>();
        for (const it of r.items) for (const a of it.track.artists) counts.set(a.id, { ...a, plays: (counts.get(a.id)?.plays ?? 0) + 1 });
        return [...counts.values()].sort((a, b) => b.plays - a.plays);
      });
    },
    artist(id) {
      return optional(() => call(FullArtist, `/artists/${encodeURIComponent(id)}`));
    },
    // NOTE: GET /artists/{id}/top-tracks was removed for Development Mode apps in Feb 2026.
    // The fallback is the artist's most recent releases: newest albums/singles, then their tracks.
    async recentTracks(artistId, max) {
      const albums = (await call(Paged(Album), `/artists/${encodeURIComponent(artistId)}/albums?include_groups=album,single&limit=10`)).items.sort((a, b) =>
        b.release_date.localeCompare(a.release_date),
      );
      const out: SpotifyTrack[] = [];
      for (const al of albums.slice(0, 5)) {
        const tracks = await call(Paged(Track), `/albums/${al.id}/tracks?limit=50`);
        for (const t of tracks.items) if (t.artists.some((a) => a.id === artistId) && !out.some((o) => o.name.toLowerCase() === t.name.toLowerCase())) out.push(t);
        if (out.length >= max) break;
      }
      return out.slice(0, max);
    },
    async findTrack(artistName, title, artistId) {
      // Search limit is capped at 10 since Feb 2026.
      const q = `track:"${title.replace(/"/g, "")}" artist:"${artistName.replace(/"/g, "")}"`;
      const r = await call(Search, `/search?type=track&limit=5&q=${encodeURIComponent(q)}`);
      const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)|\[.*?\]| - .*$/g, "").replace(/[^a-z0-9]+/g, " ").trim();
      const byArtist = r.tracks.items.filter((t) => (artistId ? t.artists.some((a) => a.id === artistId) : t.artists.some((a) => norm(a.name) === norm(artistName))));
      return byArtist.find((t) => norm(t.name) === norm(title)) ?? byArtist[0] ?? null;
    },
    async createPlaylist(name, description) {
      // POST /users/{id}/playlists was removed; POST /me/playlists replaces it.
      const p = await call(Playlist, "/me/playlists", { method: "POST", body: { name, description, public: false } });
      return { id: p.id, url: p.external_urls.spotify };
    },
    async replacePlaylistItems(playlistId, uris) {
      // /playlists/{id}/tracks became /playlists/{id}/items in Feb 2026.
      await fetchJson(`${API}/playlists/${encodeURIComponent(playlistId)}/items`, {
        method: "PUT",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ uris: uris.slice(0, 100) }),
        attempts: 3,
      });
    },
  };
}

/** Exchange an authorization code (one-time setup script). */
export async function exchangeSpotifyCode(clientId: string, clientSecret: string, code: string, redirectUri: string) {
  const raw = await fetchJson("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}` },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }).toString(),
    attempts: 1,
  });
  return Token.parse(raw);
}

export const SPOTIFY_SCOPES = ["user-follow-read", "user-top-read", "user-read-recently-played", "playlist-modify-private"];
