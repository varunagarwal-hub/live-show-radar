"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { setDecision } from "@radar/core";
import { followArtist, refreshArtistGlobals } from "@radar/core/db/people";
import { artists, decisions, follows, watchedAccounts } from "@radar/core/db/schema";
import { requireOwner, requireUser } from "./auth";
import { getDb } from "./db";
import { findBookingPageNow } from "./booking-lookup";
import { ensurePlaylistForEvent } from "./playlist";

const DecisionInput = z.object({ eventId: z.coerce.number().int().positive(), status: z.enum(["going", "maybe", "pass", "not_interested"]) });

/** Dashboard decisions write the same row Telegram buttons do (per person), so both stay in sync. */
export async function decideAction(eventId: number, status: "going" | "maybe" | "pass" | "not_interested"): Promise<{ ok: boolean }> {
  const v = await requireUser();
  const input = DecisionInput.parse({ eventId, status });
  const h = await getDb();
  const ok = await setDecision(h, input.eventId, input.status, "dashboard", new Date(), v.id);
  if (ok && input.status === "going") {
    // Every Going show gets its booking page looked up straight away.
    after(() => findBookingPageNow(input.eventId).catch(() => {}));
    // Pre-show playlists are made in the owner's Spotify, so only for the owner.
    if (v.isOwner) after(() => ensurePlaylistForEvent(input.eventId).catch(() => {}));
  }
  // No revalidatePath here: the stub keeps its stamp until you navigate (pages are dynamic and
  // refetch then). Revalidating would yank a just-decided stub off the Decide page mid-animation.
  return { ok };
}

const id = z.coerce.number().int().positive();

/** "Got tickets ✓" on a Going show (or undo), for the signed-in person. */
export async function setTicketsBookedAction(eventId: number, booked: boolean): Promise<{ ok: boolean }> {
  const v = await requireUser();
  const { db } = await getDb();
  const rows = await db
    .update(decisions)
    .set({ ticketsBookedAt: booked ? new Date() : null })
    .where(and(eq(decisions.userId, v.id), eq(decisions.eventId, id.parse(eventId)), eq(decisions.status, "going")))
    .returning({ e: decisions.eventId });
  return { ok: rows.length > 0 };
}

const ArtistInput = z.object({
  id,
  instagramHandle: z
    .string()
    .trim()
    .transform((s) => s.replace(/^@/, "").toLowerCase())
    .refine((s) => s === "" || /^[a-z0-9._]{1,30}$/.test(s), "Instagram handles use letters, numbers, dots and underscores"),
  aliases: z.string().max(500).transform((s) => [...new Set(s.split(",").map((x) => x.trim()).filter(Boolean))].slice(0, 12)),
  priorityTier: z.enum(["A", "B", "C"]),
});

/**
 * The owner edits the shared artist (handle, aliases) and their own tier; everyone else only sets
 * their own tier (handles and aliases affect matching for everyone, so the owner curates them).
 */
export async function saveArtistAction(form: FormData): Promise<void> {
  const v = await requireUser();
  const h = await getDb();
  if (!v.isOwner) {
    const input = z.object({ id, priorityTier: z.enum(["A", "B", "C"]) }).parse(Object.fromEntries(form));
    await h.db.update(follows).set({ tier: input.priorityTier }).where(and(eq(follows.userId, v.id), eq(follows.artistId, input.id)));
    await refreshArtistGlobals(h, [input.id]);
    revalidatePath("/artists");
    return;
  }
  const input = ArtistInput.parse(Object.fromEntries(form));
  const [current] = await h.db.select().from(artists).where(eq(artists.id, input.id));
  if (!current) return;
  const [mine] = await h.db.select().from(follows).where(and(eq(follows.userId, v.id), eq(follows.artistId, input.id)));
  // Saving a handle by hand is confirming it.
  const handle = input.instagramHandle || null;
  await h.db
    .update(artists)
    .set({
      instagramHandle: handle,
      handleStatus: handle ? "confirmed" : "none",
      aliases: input.aliases,
      // Only a changed tier counts as an override; saving a handle shouldn't freeze the tier.
      tierOverride: input.priorityTier !== (mine?.tier ?? current.priorityTier) ? input.priorityTier : current.tierOverride,
      updatedAt: new Date(),
    })
    .where(eq(artists.id, input.id));
  await followArtist(h, v.id, input.id, { tier: input.priorityTier, source: mine?.source ?? "owner", muted: mine?.muted ?? false });
  revalidatePath("/artists");
}

/** Mutes or unmutes an artist for the signed-in person only. */
export async function setMutedAction(artistId: number, muted: boolean): Promise<void> {
  const v = await requireUser();
  const h = await getDb();
  const [mine] = await h.db.select().from(follows).where(and(eq(follows.userId, v.id), eq(follows.artistId, id.parse(artistId))));
  await followArtist(h, v.id, artistId, { muted, tier: mine?.tier, source: mine?.source ?? (v.isOwner ? "owner" : "search") });
  revalidatePath("/", "layout");
}

export async function confirmHandleAction(artistId: number): Promise<void> {
  await requireOwner();
  const { db } = await getDb();
  await db.update(artists).set({ handleStatus: "confirmed", updatedAt: new Date() }).where(eq(artists.id, id.parse(artistId)));
  revalidatePath("/artists");
}

export async function setAccountActiveAction(accountId: number, active: boolean): Promise<void> {
  await requireOwner();
  const { db } = await getDb();
  await db.update(watchedAccounts).set({ active }).where(eq(watchedAccounts.id, id.parse(accountId)));
  revalidatePath("/health");
}
