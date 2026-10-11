import { z } from "zod";
import type { Llm } from "./llm";

export interface ListeningData {
  followed: { id: string; name: string; imageUrl: string | null }[];
  /** null when the endpoint isn't available (degrade gracefully). */
  shortTop: { id: string; name: string; imageUrl: string | null }[] | null;
  mediumTop: { id: string; name: string; imageUrl: string | null }[] | null;
  recent: { id: string; name: string; plays: number }[] | null;
}

export interface TieredArtist {
  spotifyId: string;
  name: string;
  imageUrl: string | null;
  tier: "A" | "B" | "C";
  followed: boolean;
  listenedNotFollowed: boolean;
}

/** "Frequently in recently played": at least this many of the last 50 plays. */
export const FREQUENT_PLAYS = 3;

/**
 * Spec 4.1 priority tiers.
 * A: in short-term (~4 weeks) top artists.
 * B: in medium-term (~6 months) top artists, or frequently in recently played.
 * C: followed but rarely played.
 * Heavy listening without a follow adds the artist as listened_not_followed.
 */
export function assignTiers(d: ListeningData): TieredArtist[] {
  const out = new Map<string, TieredArtist>();
  const followed = new Set(d.followed.map((a) => a.id));
  const short = new Set((d.shortTop ?? []).map((a) => a.id));
  const medium = new Set((d.mediumTop ?? []).map((a) => a.id));
  const frequent = new Set((d.recent ?? []).filter((r) => r.plays >= FREQUENT_PLAYS).map((r) => r.id));
  const tierOf = (id: string): "A" | "B" | "C" => (short.has(id) ? "A" : medium.has(id) || frequent.has(id) ? "B" : "C");

  const add = (a: { id: string; name: string; imageUrl?: string | null }) => {
    const prev = out.get(a.id);
    const isFollowed = followed.has(a.id);
    out.set(a.id, {
      spotifyId: a.id,
      name: a.name,
      imageUrl: prev?.imageUrl ?? a.imageUrl ?? null,
      tier: tierOf(a.id),
      followed: isFollowed,
      listenedNotFollowed: !isFollowed,
    });
  };
  d.followed.forEach(add);
  (d.shortTop ?? []).forEach(add);
  (d.mediumTop ?? []).forEach(add);
  (d.recent ?? []).filter((r) => frequent.has(r.id)).forEach(add);
  return [...out.values()];
}

export const HandleProposalSchema = z.object({
  instagram_handle: z
    .string()
    .transform((s) => s.trim().replace(/^@/, "").toLowerCase())
    .pipe(z.string().regex(/^[a-z0-9._]{1,30}$/))
    .nullable()
    .catch(null),
  aliases: z.array(z.string().max(80)).max(8).catch([]),
  confidence: z.coerce.number().min(0).max(1).catch(0.3),
});
export type HandleProposal = z.infer<typeof HandleProposalSchema>;

/** Spec 4.1 step 4: a proposed Instagram handle and aliases. Always stored as unconfirmed. */
export async function proposeHandle(llm: Llm, artist: { name: string; genres?: string[] }): Promise<HandleProposal> {
  const { data } = await llm.generateJson(
    {
      task: "propose-handle",
      system:
        'You know musicians and their official Instagram accounts. Return JSON {"instagram_handle": string|null, "aliases": string[], "confidence": number}. Only give a handle you are fairly sure is the artist\'s official account; otherwise null. Aliases: other names the artist is billed as (stylisations, transliterations such as Hindi in Latin script, former names). Don\'t include the name itself.',
      user: `Artist: ${artist.name}${artist.genres?.length ? `\nGenres: ${artist.genres.join(", ")}` : ""}`,
      temperature: 0,
    },
    HandleProposalSchema,
  );
  return { ...data, aliases: data.aliases.filter((a) => a.trim() && a.trim().toLowerCase() !== artist.name.toLowerCase()) };
}
