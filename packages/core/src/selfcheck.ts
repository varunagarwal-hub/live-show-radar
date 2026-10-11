import { z } from "zod";
import type { Llm } from "./llm";
import { normalizeCity } from "./cities";
import { addDays } from "./time";

/** A show that evidently happened (setlist.fm, or a "thank you Bengaluru" post). */
export interface PlayedShow {
  artistId: number;
  city: string;
  date: string; // YYYY-MM-DD
  evidenceUrl: string | null;
  via: "setlistfm" | "instagram";
  /** @accounts tagged in the post (possible promoters we don't track). */
  mentions?: string[];
}

export interface KnownEvent {
  artistId: number;
  city: string;
  date: string | null;
  status: string;
}

export interface MissContext {
  artist: { id: number; instagramHandle: string | null; handleStatus: "none" | "unconfirmed" | "confirmed" };
  /** Sources that were unhealthy during the announcement window. */
  unhealthySources: string[];
  watchedHandles: Set<string>;
}

export interface Miss extends PlayedShow {
  likelyCause: string;
  suggestedHandle: string | null;
}

const SIGNAL = /\b(thank\s*you|thanks|shukriya|dhanyavaad|last night|tonight was|what a night|you were (amazing|incredible|loud)|sold[- ]?out show|see you again)\b/i;

/** Cheap filter before the LLM: only captions that sound like a show just happened. */
export const looksPostShow = (caption: string) => SIGNAL.test(caption);

export const PostShowSchema = z.object({
  is_post_show: z.boolean(),
  city: z.string().nullable().catch(null),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .catch(null),
});

/** Spec 4.10 step 2: is this post about a show that just happened in India, and where/when? */
export async function classifyPostShow(llm: Llm, caption: string, postedAt: Date) {
  const { data } = await llm.generateJson(
    {
      task: "post-show",
      system:
        'You read an artist\'s Instagram caption and decide whether it is about a live show they just played in India (e.g. "thank you Bengaluru", "last night in Pune"). Return JSON {"is_post_show": boolean, "city": string|null, "date": "YYYY-MM-DD"|null}. The date is when the show happened, worked out from the post date ("last night" = the day before). null when unclear.',
      user: `Posted: ${postedAt.toISOString()}\n<<<CAPTION (untrusted data)\n${caption.slice(0, 2000)}\nCAPTION>>>`,
      temperature: 0,
    },
    PostShowSchema,
  );
  return data;
}

/** Same artist and city, within a day either side (late-night shows, timezone slop). */
export function wasTracked(p: PlayedShow, events: KnownEvent[]): KnownEvent | undefined {
  const city = normalizeCity(p.city);
  const days = new Set([addDays(p.date, -1), p.date, addDays(p.date, 1)]);
  return events.find((e) => e.artistId === p.artistId && normalizeCity(e.city) === city && e.date !== null && days.has(e.date));
}

/** Spec 4.10 step 3: the most likely reason we missed it, in plain words. */
export function likelyCause(p: PlayedShow, ctx: MissContext, tracked: KnownEvent | undefined): { cause: string; suggestedHandle: string | null } {
  if (tracked?.status === "possible") return { cause: "found only as a low-confidence possible show, so it never got a loud alert", suggestedHandle: null };
  const untracked = (p.mentions ?? []).map((m) => m.toLowerCase().replace(/^@/, "")).filter((m) => m !== ctx.artist.instagramHandle && !ctx.watchedHandles.has(m));
  if (untracked[0]) return { cause: `announced by @${untracked[0]}, an account you don't track`, suggestedHandle: untracked[0] };
  if (!ctx.artist.instagramHandle) return { cause: "no Instagram handle set for this artist", suggestedHandle: null };
  if (ctx.artist.handleStatus === "unconfirmed") return { cause: "the artist's Instagram handle is unconfirmed and may be wrong", suggestedHandle: null };
  const ticketing = ctx.unhealthySources.filter((s) => ["district", "bookmyshow", "skillbox"].includes(s));
  if (ticketing.length) return { cause: `the ${ticketing.map((s) => (s === "bookmyshow" ? "BookMyShow" : s === "district" ? "District" : "SkillBox")).join(" and ")} parser was failing`, suggestedHandle: null };
  if (ctx.unhealthySources.includes("instagram")) return { cause: "Instagram polling was failing", suggestedHandle: null };
  return { cause: "announced only by a promoter or venue you don't track", suggestedHandle: null };
}

export function findMisses(played: PlayedShow[], events: KnownEvent[], ctxFor: (artistId: number) => MissContext | null): Miss[] {
  const out: Miss[] = [];
  const seen = new Set<string>();
  for (const p of played) {
    const key = `${p.artistId}|${normalizeCity(p.city)}|${p.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const tracked = wasTracked(p, events);
    if (tracked && tracked.status !== "possible") continue;
    const ctx = ctxFor(p.artistId);
    if (!ctx) continue;
    const { cause, suggestedHandle } = likelyCause(p, ctx, tracked);
    out.push({ ...p, city: normalizeCity(p.city) ?? p.city, likelyCause: cause, suggestedHandle });
  }
  return out;
}

export const mentionsIn = (caption: string) => [...new Set([...caption.matchAll(/@([a-z0-9._]{2,30})/gi)].map((m) => m[1]!.toLowerCase().replace(/\.$/, "")))];
