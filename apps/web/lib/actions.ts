"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { setDecision } from "@radar/core";
import { artists, watchedAccounts } from "@radar/core/db/schema";
import { requireUser } from "./auth";
import { getDb } from "./db";
import { ensurePlaylistForEvent } from "./playlist";

const DecisionInput = z.object({ eventId: z.coerce.number().int().positive(), status: z.enum(["going", "maybe", "pass", "not_interested"]) });

/** Dashboard decisions write the same `decisions` row Telegram buttons do, so both stay in sync. */
export async function decideAction(eventId: number, status: "going" | "maybe" | "pass" | "not_interested"): Promise<{ ok: boolean }> {
  await requireUser();
  const input = DecisionInput.parse({ eventId, status });
  const h = await getDb();
  const ok = await setDecision(h, input.eventId, input.status, "dashboard");
  if (ok && input.status === "going") after(() => ensurePlaylistForEvent(input.eventId).catch(() => {}));
  // No revalidatePath here: the stub keeps its stamp until Karan navigates (pages are dynamic and
  // refetch then). Revalidating would yank a just-decided stub off the Decide page mid-animation.
  return { ok };
}

const ArtistInput = z.object({
  id: z.coerce.number().int().positive(),
  instagramHandle: z
    .string()
    .trim()
    .transform((s) => s.replace(/^@/, "").toLowerCase())
    .refine((s) => s === "" || /^[a-z0-9._]{1,30}$/.test(s), "Instagram handles use letters, numbers, dots and underscores"),
  aliases: z.string().max(500).transform((s) => [...new Set(s.split(",").map((x) => x.trim()).filter(Boolean))].slice(0, 12)),
  priorityTier: z.enum(["A", "B", "C"]),
});

export async function saveArtistAction(form: FormData): Promise<void> {
  await requireUser();
  const input = ArtistInput.parse(Object.fromEntries(form));
  const { db } = await getDb();
  const [current] = await db.select().from(artists).where(eq(artists.id, input.id));
  if (!current) return;
  // Saving a handle by hand is confirming it.
  const handle = input.instagramHandle || null;
  await db
    .update(artists)
    .set({ instagramHandle: handle, handleStatus: handle ? "confirmed" : "none", aliases: input.aliases, priorityTier: input.priorityTier, updatedAt: new Date() })
    .where(eq(artists.id, input.id));
  revalidatePath("/artists");
}

export async function setMutedAction(id: number, muted: boolean): Promise<void> {
  await requireUser();
  const { db } = await getDb();
  await db.update(artists).set({ muted, updatedAt: new Date() }).where(eq(artists.id, z.number().int().positive().parse(id)));
  revalidatePath("/", "layout");
}

export async function confirmHandleAction(id: number): Promise<void> {
  await requireUser();
  const { db } = await getDb();
  await db.update(artists).set({ handleStatus: "confirmed", updatedAt: new Date() }).where(eq(artists.id, z.number().int().positive().parse(id)));
  revalidatePath("/artists");
}

export async function setAccountActiveAction(id: number, active: boolean): Promise<void> {
  await requireUser();
  const { db } = await getDb();
  await db.update(watchedAccounts).set({ active }).where(eq(watchedAccounts.id, z.number().int().positive().parse(id)));
  revalidatePath("/health");
}
