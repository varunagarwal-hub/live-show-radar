import { and, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { buildCalendar, istDate, addDays } from "@radar/core";
import { followsArtist } from "@radar/core/db/people";
import { artists, decisions, events, eventSources, OWNER_USER_ID, users } from "@radar/core/db/schema";
import { getDb } from "@/lib/db";
import { secretMatches } from "@/lib/secrets";

export const dynamic = "force-dynamic";

/**
 * /api/calendar/<token>.ics — subscribe from Google, Apple or Outlook calendar ("From URL").
 * Each person has their own secret token (the owner's original CALENDAR_FEED_TOKEN keeps
 * working). Going shows as events, Maybe shows as tentative events, decide-by deadlines as short
 * reminders. Stable UIDs mean updates replace entries instead of duplicating them.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const token = (await ctx.params).token.replace(/\.ics$/i, "");
  const { db } = await getDb();
  let userId: number | null = secretMatches(token, process.env.CALENDAR_FEED_TOKEN) ? OWNER_USER_ID : null;
  if (userId === null && /^[A-Za-z0-9_-]{24,}$/.test(token)) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.calendarToken, token));
    userId = u?.id ?? null;
  }
  if (userId === null) return new Response("not found", { status: 404 });

  const since = addDays(istDate(new Date()), -30);
  const rows = await db
    .select({ e: events, name: artists.name, decision: decisions.status })
    .from(events)
    .innerJoin(artists, eq(events.artistId, artists.id))
    .innerJoin(decisions, and(eq(decisions.eventId, events.id), eq(decisions.userId, userId)))
    .where(
      and(
        inArray(decisions.status, ["going", "maybe"]),
        isNotNull(events.date),
        gte(events.date, since),
        inArray(events.status, ["announced", "possible"]),
        followsArtist(userId),
      ),
    );
  const ids = rows.map((r) => r.e.id);
  const srcs = ids.length ? await db.select().from(eventSources).where(inArray(eventSources.eventId, ids)) : [];
  const ics = buildCalendar(
    rows.map((r) => ({
      ...r.e,
      artistName: r.name,
      decision: r.decision as "going" | "maybe",
      sourceUrls: srcs.filter((s) => s.eventId === r.e.id && s.url).map((s) => s.url!),
    })),
    { name: "Early Access" },
  );
  return new Response(ics, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="early-access.ics"',
      "cache-control": "private, max-age=900",
    },
  });
}
