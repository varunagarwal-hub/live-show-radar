import { and, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { buildCalendar, istDate, addDays } from "@radar/core";
import { artists, decisions, events, eventSources } from "@radar/core/db/schema";
import { getDb } from "@/lib/db";
import { secretMatches } from "@/lib/secrets";

export const dynamic = "force-dynamic";

/**
 * /api/calendar/<CALENDAR_FEED_TOKEN>.ics — subscribe from Google Calendar ("From URL").
 * Going shows as events, Maybe shows as tentative events, decide-by deadlines as short reminders.
 * Stable UIDs mean updates replace entries instead of duplicating them.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!secretMatches(token.replace(/\.ics$/i, ""), process.env.CALENDAR_FEED_TOKEN)) return new Response("not found", { status: 404 });

  const { db } = await getDb();
  const since = addDays(istDate(new Date()), -30);
  const rows = await db
    .select({ e: events, name: artists.name, decision: decisions.status })
    .from(events)
    .innerJoin(artists, eq(events.artistId, artists.id))
    .innerJoin(decisions, eq(decisions.eventId, events.id))
    .where(and(inArray(decisions.status, ["going", "maybe"]), isNotNull(events.date), gte(events.date, since), inArray(events.status, ["announced", "possible"])));
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
