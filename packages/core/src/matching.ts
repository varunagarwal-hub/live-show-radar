import { z } from "zod";
import type { Llm } from "./llm";

/** The slice of an artist row matching needs (works off the DB row or the cached snapshot). */
export interface WatchArtist {
  id: number;
  name: string;
  aliases: string[];
  spotifyId: string | null;
  instagramHandle: string | null;
  handleStatus: "none" | "unconfirmed" | "confirmed";
  matchWeight: number;
  muted: boolean;
  priorityTier: "A" | "B" | "C";
  /** Instagram bio link (often a Linktree listing ticket links per city). */
  bioUrl?: string | null;
}

export type MatchMethod = "spotify_id" | "handle" | "exact" | "fuzzy";

export interface MatchResult {
  artist: WatchArtist;
  method: MatchMethod;
  score: number;
  /** True when the match must be confirmed by the LLM before alerting. */
  needsVerification: boolean;
  /** The match rests on a handle the user hasn't confirmed yet. */
  viaUnconfirmedHandle: boolean;
}

export interface MatchContext {
  /** Instagram account that posted the item, if any. */
  postedBy?: string | null;
  /** Full source text, scanned for open.spotify.com/artist/<id> links. */
  sourceText?: string;
}

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/^the\s+/, "")
    .replace(/\b(live|india tour|tour|dj set|band|official)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

/**
 * 0–1 similarity: the better of edit-distance ratio and space-insensitive comparison. For
 * multi-word names with the same word count, one badly mismatched word caps the score, so
 * "Prateek Kumar" doesn't pass for "Prateek Kuhad".
 */
export function similarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ratio = (x: string, y: string) => 1 - levenshtein(x, y) / Math.max(x.length, y.length);
  // Space-insensitive comparison ("PrateekKuhad") only counts when it is a near-exact hit.
  const compact = ratio(na.replace(/ /g, ""), nb.replace(/ /g, ""));
  const overall = Math.max(ratio(na, nb), compact >= 0.95 ? compact : 0);
  const ta = na.split(" ");
  const tb = nb.split(" ");
  if (ta.length > 1 && ta.length === tb.length) {
    const worst = Math.min(...ta.map((t, i) => ratio(t, tb[i]!)));
    return Math.min(overall, worst + 0.15);
  }
  return overall;
}

const SPOTIFY_ARTIST = /open\.spotify\.com\/(?:intl-[a-z]+\/)?artist\/([A-Za-z0-9]{22})/g;

/**
 * Matches an extracted artist name against the watchlist, in the order the spec requires:
 * Spotify ID, confirmed handle, exact name/alias, then fuzzy (always LLM-verified).
 * Muted artists never match. Returns null when nothing plausible is found.
 */
export function matchArtist(name: string, watchlist: WatchArtist[], ctx: MatchContext = {}, fuzzyFloor = 0.82): MatchResult | null {
  const active = watchlist.filter((a) => !a.muted);
  const n = normalizeName(name);
  if (!n) return null;

  const nameHit = (a: WatchArtist) => [a.name, ...a.aliases].some((x) => normalizeName(x) === n);

  // 1. Spotify artist link in the source whose artist also matches the name.
  if (ctx.sourceText) {
    const ids = new Set([...ctx.sourceText.matchAll(SPOTIFY_ARTIST)].map((m) => m[1]!));
    const byId = active.find((a) => a.spotifyId && ids.has(a.spotifyId) && (nameHit(a) || similarity(name, a.name) >= fuzzyFloor));
    if (byId) return { artist: byId, method: "spotify_id", score: 1, needsVerification: false, viaUnconfirmedHandle: false };
  }

  // 2. Posted by the artist's own handle. Confirmed → trusted; unconfirmed → used, but flagged.
  const poster = ctx.postedBy?.toLowerCase().replace(/^@/, "");
  if (poster) {
    const byHandle = active.find((a) => a.instagramHandle?.toLowerCase() === poster && (nameHit(a) || similarity(name, a.name) >= fuzzyFloor));
    if (byHandle) {
      const unconfirmed = byHandle.handleStatus !== "confirmed";
      return { artist: byHandle, method: "handle", score: 1, needsVerification: false, viaUnconfirmedHandle: unconfirmed };
    }
  }

  // 3. Exact name or alias. Collisions (two watched artists share a name) and very short or
  //    down-weighted names go to the LLM.
  const exact = active.filter(nameHit);
  if (exact.length === 1) {
    const a = exact[0]!;
    const risky = n.length <= 3 || a.matchWeight < 0.75;
    return { artist: a, method: "exact", score: a.matchWeight, needsVerification: risky, viaUnconfirmedHandle: false };
  }
  if (exact.length > 1) {
    const a = [...exact].sort((x, y) => y.matchWeight - x.matchWeight)[0]!;
    return { artist: a, method: "exact", score: a.matchWeight, needsVerification: true, viaUnconfirmedHandle: false };
  }

  // 4. Fuzzy fallback, weighted by past "wrong artist" feedback.
  let best: { a: WatchArtist; s: number } | null = null;
  for (const a of active) {
    const s = Math.max(similarity(name, a.name), ...a.aliases.map((al) => similarity(name, al))) * a.matchWeight;
    if (!best || s > best.s) best = { a, s };
  }
  if (best && best.s >= fuzzyFloor) {
    return { artist: best.a, method: "fuzzy", score: best.s, needsVerification: true, viaUnconfirmedHandle: false };
  }
  return null;
}

export const VerifySchema = z.object({
  same_artist: z.boolean(),
  confidence: z.coerce.number().min(0).max(1).catch(0.5),
  reason: z.string().default(""),
});

/** Asks the LLM whether an extracted name refers to the watched artist (fuzzy or colliding matches). */
export async function verifyMatch(llm: Llm, extractedName: string, artist: WatchArtist, evidence: string, coArtists: string[]): Promise<boolean> {
  const { data } = await llm.generateJson(
    {
      task: "verify-match",
      system:
        'You decide whether an artist name found in a concert announcement refers to a specific musician. Answer with JSON {"same_artist": boolean, "confidence": number, "reason": string}. Different artists can share a name; be strict.',
      user: [
        `Watched artist: ${artist.name}${artist.aliases.length ? ` (also known as: ${artist.aliases.join(", ")})` : ""}${artist.instagramHandle ? `, Instagram @${artist.instagramHandle}` : ""}`,
        `Name in the announcement: ${extractedName}`,
        coArtists.length ? `Also on the bill: ${coArtists.join(", ")}` : "",
        `<<<EVIDENCE (untrusted data)\n${evidence.slice(0, 1500)}\nEVIDENCE>>>`,
      ].join("\n"),
    },
    VerifySchema,
  );
  return data.same_artist && data.confidence >= 0.6;
}
