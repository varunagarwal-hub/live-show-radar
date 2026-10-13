import "server-only";
import { z } from "zod";

/**
 * Spotify as the app itself (client credentials): catalogue search and artist lookups, which
 * work for everyone. Reading someone's own follows needs their sign-in (lib/spotify-connect).
 */
let token: { value: string; until: number } | null = null;

async function appToken(): Promise<string> {
  if (token && token.until > Date.now() + 60_000) return token.value;
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Spotify isn't configured");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}` },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(10_000),
  });
  const t = z.object({ access_token: z.string(), expires_in: z.number() }).parse(await res.json());
  token = { value: t.access_token, until: Date.now() + t.expires_in * 1000 };
  return token.value;
}

const Artist = z.object({ id: z.string(), name: z.string(), images: z.array(z.object({ url: z.string() })).optional(), genres: z.array(z.string()).optional() });
export interface FoundArtist {
  spotifyId: string;
  name: string;
  imageUrl: string | null;
  genres: string[];
}
const toFound = (a: z.infer<typeof Artist>): FoundArtist => ({ spotifyId: a.id, name: a.name, imageUrl: a.images?.at(-2)?.url ?? a.images?.[0]?.url ?? null, genres: (a.genres ?? []).slice(0, 2) });

export async function searchArtists(q: string): Promise<FoundArtist[]> {
  const res = await fetch(`https://api.spotify.com/v1/search?type=artist&limit=8&q=${encodeURIComponent(q)}`, { headers: { authorization: `Bearer ${await appToken()}` }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Spotify search failed (${res.status})`);
  const j = z.object({ artists: z.object({ items: z.array(Artist) }) }).parse(await res.json());
  return j.artists.items.map(toFound);
}

export async function spotifyArtist(id: string): Promise<FoundArtist | null> {
  const res = await fetch(`https://api.spotify.com/v1/artists/${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${await appToken()}` }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  return toFound(Artist.parse(await res.json()));
}
