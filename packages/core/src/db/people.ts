import { and, eq, inArray, isNotNull, ne, sql, type SQL } from "drizzle-orm";
import type { DbHandle } from "./index";
import { artists, decisions, follows, OWNER_USER_ID, users } from "./schema";

/**
 * Multi-user helpers. The owner (user 1) is the original single user: their decisions, alerts and
 * artist rows predate everyone else and keep working unchanged. Everyone else follows artists
 * through `follows`, and every per-person read goes through these conditions.
 *
 * Rule: an artist with no follow rows at all belongs to the owner (pre-multi-user data, seeds,
 * tests). As soon as anyone follows it, the follow rows decide.
 */

export const isOwner = (userId: number) => userId === OWNER_USER_ID;

/** "This person watches this artist" (unmuted), as a condition on the artists table. */
export function followsArtist(userId: number): SQL {
  const own = sql`exists (select 1 from ${follows} f where f.artist_id = ${artists.id} and f.user_id = ${userId} and not f.muted)`;
  if (!isOwner(userId)) return own;
  return sql`(${own} or (not exists (select 1 from ${follows} f where f.artist_id = ${artists.id}) and not ${artists.muted}))`;
}

/** This person's tier for an artist (their follow row), falling back to the shared tier. */
export function tierFor(userId: number): SQL<"A" | "B" | "C"> {
  return sql<"A" | "B" | "C">`coalesce((select f.tier from ${follows} f where f.artist_id = ${artists.id} and f.user_id = ${userId}), ${artists.priorityTier})`;
}

/** This person's mute for an artist (true when they follow it muted). */
export function mutedFor(userId: number): SQL<boolean> {
  return sql<boolean>`coalesce((select f.muted from ${follows} f where f.artist_id = ${artists.id} and f.user_id = ${userId}), ${artists.muted})`;
}

/**
 * Recomputes the shared view of artists from follows: an artist is muted only when nobody follows
 * it unmuted, and its shared tier (used for urgency) is the best tier among its followers.
 * Artists without follow rows are left alone.
 */
export async function refreshArtistGlobals(h: DbHandle, artistIds?: number[]): Promise<void> {
  if (artistIds && !artistIds.length) return;
  const scope = artistIds ? sql`and a.id in (${sql.join(artistIds.map((id) => sql`${id}`), sql`, `)})` : sql``;
  await h.db.execute(sql`
    update ${artists} a set
      muted = not exists (select 1 from ${follows} f where f.artist_id = a.id and not f.muted),
      priority_tier = coalesce((select min(f.tier) from ${follows} f where f.artist_id = a.id and not f.muted), a.priority_tier),
      updated_at = now()
    where exists (select 1 from ${follows} f where f.artist_id = a.id) ${scope}`);
}

/**
 * An unclaimed, watched artist is the owner's (see the rule above). Claims it for them before
 * anyone else's follow makes the follow rows decide and would quietly drop it from their list.
 */
export async function claimForOwner(h: DbHandle, artistId: number): Promise<void> {
  await h.db.execute(sql`
    insert into ${follows} (user_id, artist_id, tier, muted, source)
    select ${OWNER_USER_ID}, a.id, a.priority_tier, false, 'owner' from ${artists} a
    where a.id = ${artistId} and not a.muted and not exists (select 1 from ${follows} f where f.artist_id = a.id)
    on conflict do nothing`);
}

/** Follows (or re-follows) an artist for one person, then refreshes the shared view. */
export async function followArtist(h: DbHandle, userId: number, artistId: number, opts: { tier?: "A" | "B" | "C"; source?: string; muted?: boolean } = {}): Promise<void> {
  if (!isOwner(userId)) await claimForOwner(h, artistId);
  await h.db
    .insert(follows)
    .values({ userId, artistId, tier: opts.tier ?? "B", source: opts.source ?? "search", muted: opts.muted ?? false })
    .onConflictDoUpdate({ target: [follows.userId, follows.artistId], set: { muted: opts.muted ?? false, ...(opts.tier ? { tier: opts.tier } : {}) } });
  await refreshArtistGlobals(h, [artistId]);
}

export interface Recipient {
  userId: number;
  /** Null for the owner: their chat comes from TELEGRAM_ALERT_CHAT_ID as before. */
  chatId: string | null;
}

/** Everyone who should hear about a show by this artist: unmuted followers with Telegram. */
export async function recipientsFor(h: DbHandle, artistId: number): Promise<Recipient[]> {
  const out: Recipient[] = [];
  const [ownerWatches] = await h.db.select({ ok: sql<boolean>`${followsArtist(OWNER_USER_ID)}` }).from(artists).where(eq(artists.id, artistId));
  if (ownerWatches?.ok) out.push({ userId: OWNER_USER_ID, chatId: null });
  const others = await h.db
    .select({ userId: users.id, chatId: users.telegramChatId })
    .from(follows)
    .innerJoin(users, eq(users.id, follows.userId))
    .where(and(eq(follows.artistId, artistId), eq(follows.muted, false), ne(users.id, OWNER_USER_ID), isNotNull(users.telegramChatId)));
  for (const o of others) out.push({ userId: o.userId, chatId: o.chatId });
  return out;
}

/** "u7:" for member 7, "" for the owner: keeps every member's alert dedup keys apart. */
export const keyPrefix = (userId: number) => (isOwner(userId) ? "" : `u${userId}:`);

/** Makes sure user 1 carries the owner's real email (the migration created it as a placeholder). */
export async function ensureOwner(h: DbHandle, email: string): Promise<void> {
  const e = email.trim().toLowerCase();
  if (!e) return;
  await h.db.update(users).set({ email: e }).where(and(eq(users.id, OWNER_USER_ID), ne(users.email, e)));
}

/** Members (not the owner) who follow any of these artists, with chat ids and decisions, for the job snapshot. */
export async function loadMembers(h: DbHandle, eventIds: number[]) {
  const people = await h.db.select({ id: users.id, chatId: users.telegramChatId }).from(users).where(and(ne(users.id, OWNER_USER_ID), isNotNull(users.telegramChatId)));
  if (!people.length) return [];
  const ids = people.map((p) => p.id);
  const [fol, dec] = await Promise.all([
    h.db.select({ userId: follows.userId, artistId: follows.artistId }).from(follows).where(and(inArray(follows.userId, ids), eq(follows.muted, false))),
    eventIds.length ? h.db.select({ userId: decisions.userId, eventId: decisions.eventId, status: decisions.status }).from(decisions).where(and(inArray(decisions.userId, ids), inArray(decisions.eventId, eventIds))) : Promise.resolve([]),
  ]);
  return people.map((p) => ({
    id: p.id,
    chatId: p.chatId!,
    artistIds: fol.filter((f) => f.userId === p.id).map((f) => f.artistId),
    decisions: Object.fromEntries(dec.filter((d) => d.userId === p.id).map((d) => [String(d.eventId), d.status])) as Record<string, "going" | "maybe" | "pass" | "not_interested">,
  }));
}

/** Artist ids the owner watches (for owner-only job paths like reminders and the digest). */
export async function ownerArtistIds(h: DbHandle): Promise<Set<number>> {
  const rows = await h.db.select({ id: artists.id }).from(artists).where(followsArtist(OWNER_USER_ID));
  return new Set(rows.map((r) => r.id));
}
