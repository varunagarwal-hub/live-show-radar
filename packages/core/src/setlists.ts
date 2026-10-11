import { z } from "zod";
import { fetchJson, RADAR_UA } from "./http";
import { HttpError, sleep } from "./retry";

// ---------- MusicBrainz (no key; 1 request/second; descriptive User-Agent required) ----------

const MbSearch = z.object({ artists: z.array(z.object({ id: z.string(), name: z.string(), score: z.coerce.number().optional(), country: z.string().optional(), disambiguation: z.string().optional() })) });

let lastMb = 0;

/** Finds an artist's MusicBrainz ID, throttled to MusicBrainz's 1 request per second. */
export async function musicBrainzId(name: string, contact: string): Promise<string | null> {
  const wait = lastMb + 1100 - Date.now();
  if (wait > 0) await sleep(wait);
  lastMb = Date.now();
  const q = `artist:"${name.replace(/"/g, "")}"`;
  const r = MbSearch.parse(
    await fetchJson(`https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(q)}&fmt=json&limit=5`, {
      headers: { "user-agent": `${RADAR_UA.split(" ")[0]} ( ${contact} )` },
      attempts: 3,
      baseMs: 1500,
    }),
  );
  const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "");
  const exact = r.artists.filter((a) => norm(a.name) === norm(name) && (a.score ?? 0) >= 90);
  // Prefer an Indian artist when several share the name.
  return (exact.find((a) => a.country === "IN") ?? exact[0])?.id ?? null;
}

// ---------- setlist.fm (free key, non-commercial) ----------

const Song = z.object({ name: z.string(), tape: z.boolean().optional(), cover: z.object({ name: z.string() }).optional() });
const Setlist = z.object({
  id: z.string(),
  eventDate: z.string(), // dd-MM-yyyy
  url: z.string().optional(),
  venue: z.object({ name: z.string().optional(), city: z.object({ name: z.string(), country: z.object({ code: z.string() }) }).optional() }).optional(),
  sets: z.object({ set: z.array(z.object({ song: z.array(Song).optional() })) }).optional(),
});
export type Setlist = z.infer<typeof Setlist>;
const Setlists = z.object({ setlist: z.array(Setlist).optional(), total: z.number().optional() });

export async function artistSetlists(mbid: string, apiKey: string, page = 1): Promise<Setlist[]> {
  try {
    const r = await fetchJson(`https://api.setlist.fm/rest/1.0/artist/${encodeURIComponent(mbid)}/setlists?p=${page}`, {
      headers: { "x-api-key": apiKey, accept: "application/json" },
      attempts: 3,
      baseMs: 1000,
    });
    return Setlists.parse(r).setlist ?? [];
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return [];
    throw err;
  }
}

/** "13-12-2026" → "2026-12-13" */
export const setlistDate = (d: string) => d.split("-").reverse().join("-");

export const songsOf = (s: Setlist) => (s.sets?.set ?? []).flatMap((x) => x.song ?? []).filter((x) => !x.tape && x.name.trim());

/**
 * Spec 4.11: songs ranked by how often the artist played them across recent setlists. Ties go to
 * the song that appeared earlier in the most recent show (openers and hits first).
 */
export function rankSongs(setlists: Setlist[], maxSetlists = 10): { title: string; count: number }[] {
  const recent = setlists.filter((s) => songsOf(s).length > 0).slice(0, maxSetlists);
  const counts = new Map<string, { title: string; count: number; firstSeen: number }>();
  recent.forEach((s, si) =>
    songsOf(s).forEach((song, pos) => {
      const key = song.name.trim().toLowerCase();
      const prev = counts.get(key);
      counts.set(key, { title: prev?.title ?? song.name.trim(), count: (prev?.count ?? 0) + 1, firstSeen: prev?.firstSeen ?? si * 1000 + pos });
    }),
  );
  return [...counts.values()].sort((a, b) => b.count - a.count || a.firstSeen - b.firstSeen).map(({ title, count }) => ({ title, count }));
}
