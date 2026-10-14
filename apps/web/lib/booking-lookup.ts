import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { searchBookingUrl } from "@radar/core";
import { artists, events } from "@radar/core/db/schema";
import { getDb } from "./db";

/**
 * Runs the booking-page search the moment someone marks a show Going (after the response is
 * sent), so a Going show doesn't wait for the 15-minute job. The tiers job keeps retrying Going
 * shows that still have no link. Only ever fills an empty link.
 */
export async function findBookingPageNow(eventId: number): Promise<void> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return;
  const h = await getDb();
  const [r] = await h.db.select({ e: events, name: artists.name }).from(events).innerJoin(artists, eq(artists.id, events.artistId)).where(eq(events.id, eventId));
  if (!r || r.e.ticketUrl || r.e.bookingUrl || r.e.city === "TBA") return;
  const url = await searchBookingUrl(key, { artistName: r.name, city: r.e.city, date: r.e.date }, process.env.GROQ_MODEL || undefined).catch(() => null);
  await h.db
    .update(events)
    .set(url ? { bookingUrl: url, bookingCheckedAt: new Date() } : { bookingCheckedAt: new Date() })
    .where(and(eq(events.id, eventId), isNull(events.bookingUrl)));
}
