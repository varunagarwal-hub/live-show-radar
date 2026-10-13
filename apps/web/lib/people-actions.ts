"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { radarConfig } from "@radar/config";
import { followArtist } from "@radar/core/db/people";
import { kvSet } from "@radar/core/db/queries";
import { upsertSpotifyArtist } from "@radar/core/db/spotify-import";
import { invites, users } from "@radar/core/db/schema";
import { createUser, getViewer, newSecret, requireOwner, requireUser, sessionIdentity } from "./auth";
import { getDb } from "./db";
import { searchArtists, spotifyArtist, type FoundArtist } from "./spotify-app";

// ---------- artists ----------

export async function searchArtistsAction(q: string): Promise<{ results: FoundArtist[]; error?: string }> {
  await requireUser();
  const query = z.string().trim().min(2).max(80).safeParse(q);
  if (!query.success) return { results: [] };
  try {
    return { results: await searchArtists(query.data) };
  } catch {
    return { results: [], error: "Search isn't working right now. Try again in a minute." };
  }
}

/** Follows an artist found by search. The id is re-checked with Spotify, never trusted as sent. */
export async function followSpotifyArtistAction(spotifyId: string): Promise<{ ok: boolean; name?: string }> {
  const v = await requireUser();
  const sid = z.string().regex(/^[A-Za-z0-9]{10,40}$/).parse(spotifyId);
  const a = await spotifyArtist(sid);
  if (!a) return { ok: false };
  const h = await getDb();
  const artistId = await upsertSpotifyArtist(h, a);
  await followArtist(h, v.id, artistId, { tier: "B", source: "search" });
  revalidatePath("/artists");
  return { ok: true, name: a.name };
}

// ---------- your settings ----------

export async function setHomeCityAction(form: FormData): Promise<void> {
  const v = await requireUser();
  const city = z.enum(radarConfig.cities.map((c) => c.name) as [string, ...string[]]).parse(form.get("city"));
  const { db } = await getDb();
  await db.update(users).set({ homeCity: city }).where(eq(users.id, v.id));
  revalidatePath("/", "layout");
}

/** A fresh one-time Telegram link (the old one stops working). */
export async function newTelegramLinkAction(): Promise<void> {
  const v = await requireUser();
  const { db } = await getDb();
  await db.update(users).set({ telegramLinkToken: newSecret(12) }).where(eq(users.id, v.id));
  revalidatePath("/you");
}

export async function disconnectTelegramAction(): Promise<void> {
  const v = await requireUser();
  if (v.isOwner) return; // the owner's chat is configured in TELEGRAM_ALERT_CHAT_ID
  const { db } = await getDb();
  await db.update(users).set({ telegramChatId: null, telegramLinkToken: newSecret(12) }).where(eq(users.id, v.id));
  revalidatePath("/you");
}

/** A new secret calendar address; the old one stops working (use if it was shared by mistake). */
export async function newCalendarLinkAction(): Promise<void> {
  const v = await requireUser();
  const { db } = await getDb();
  await db.update(users).set({ calendarToken: newSecret() }).where(eq(users.id, v.id));
  revalidatePath("/you");
}

export async function disconnectSpotifyAction(): Promise<void> {
  const v = await requireUser();
  const { db } = await getDb();
  await db.update(users).set({ spotifyRefreshEnc: null, spotifyUserId: null }).where(eq(users.id, v.id));
  revalidatePath("/you");
}

// ---------- invites ----------

const CODE = /^[A-Z0-9-]{4,32}$/;
const normCode = (s: unknown) => String(s ?? "").trim().toUpperCase();

/** Redeems an invite for the signed-in Google account and creates their account. */
export async function redeemInviteAction(form: FormData): Promise<void> {
  const who = await sessionIdentity();
  if (!who) redirect("/signin");
  if (await getViewer()) redirect("/");
  const code = normCode(form.get("code"));
  const back = (err: string) => redirect(`/join?error=${err}${code ? `&code=${encodeURIComponent(code)}` : ""}`);
  if (!CODE.test(code)) back("invalid");
  const { db } = await getDb();
  // Claim one use atomically: only while unrevoked, unexpired and under its limit.
  const [claimed] = await db
    .update(invites)
    .set({ uses: sql`${invites.uses} + 1` })
    .where(and(eq(invites.code, code), isNull(invites.revokedAt), sql`${invites.uses} < ${invites.maxUses}`, sql`(${invites.expiresAt} is null or ${invites.expiresAt} > now())`))
    .returning({ code: invites.code });
  if (!claimed) back("invalid");
  await createUser(who!.email, who!.name, code);
  redirect("/you?welcome=1");
}

const InviteInput = z.object({
  note: z.string().trim().max(80).optional().default(""),
  maxUses: z.coerce.number().int().min(1).max(100).default(1),
  days: z.coerce.number().int().min(0).max(365).default(0),
  code: z.string().trim().optional().default(""),
});

const randomCode = () => {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => abc[Math.floor(Math.random() * abc.length)]).join("");
};

export async function createInviteAction(form: FormData): Promise<void> {
  await requireOwner();
  const input = InviteInput.parse(Object.fromEntries(form));
  const wanted = normCode(input.code).replace(/[^A-Z0-9-]/g, "");
  const code = CODE.test(wanted) ? wanted : randomCode();
  const { db } = await getDb();
  await db
    .insert(invites)
    .values({ code, note: input.note || null, maxUses: input.maxUses, expiresAt: input.days ? new Date(Date.now() + input.days * 86_400_000) : null })
    .onConflictDoNothing();
  revalidatePath("/admin");
}

export async function revokeInviteAction(code: string): Promise<void> {
  await requireOwner();
  const { db } = await getDb();
  await db.update(invites).set({ revokedAt: new Date() }).where(eq(invites.code, normCode(code)));
  revalidatePath("/admin");
}

export async function setSignupsOpenAction(open: boolean): Promise<void> {
  await requireOwner();
  await kvSet(await getDb(), "signup_open", open);
  revalidatePath("/admin");
}
