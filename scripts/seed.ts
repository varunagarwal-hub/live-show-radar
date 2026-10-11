/**
 * Sample data so the dashboard isn't empty on first run.
 *   pnpm seed          add sample artists, shows, decisions and health rows (dates relative to today)
 *   pnpm seed --clear  remove exactly what the seed added
 * Seeded rows are recorded in kv("seed") so clearing never touches real data.
 */
import "./load-env";
import { inArray } from "drizzle-orm";
import { requireEnv, watchedAccounts as accountSeeds } from "@radar/config";
import { addDays, computeUrgency, fingerprint, istDate, istInstant } from "@radar/core";
import { connectNeon } from "@radar/core/db";
import { artists, decisions, events, eventSources, jobRuns, sourceHealth, watchedAccounts, type TierJson } from "@radar/core/db/schema";
import { kvGet, kvSet } from "@radar/core/db/queries";

const { DATABASE_URL } = requireEnv(["DATABASE_URL"]);
const h = await connectNeon(DATABASE_URL);
const { db } = h;
const now = new Date();
const today = istDate(now);
const hoursFromNow = (n: number) => new Date(now.getTime() + n * 3_600_000);

type Seeded = { artistIds: number[]; eventIds: number[]; sources: string[] };
const prev = await kvGet<Seeded>(h, "seed");

if (process.argv.includes("--clear")) {
  if (!prev) {
    console.log("Nothing seeded.");
  } else {
    if (prev.eventIds.length) await db.delete(events).where(inArray(events.id, prev.eventIds));
    if (prev.artistIds.length) await db.delete(artists).where(inArray(artists.id, prev.artistIds));
    if (prev.sources.length) await db.delete(sourceHealth).where(inArray(sourceHealth.source, prev.sources));
    await kvSet(h, "seed", { artistIds: [], eventIds: [], sources: [] });
    console.log(`Removed ${prev.eventIds.length} sample shows and ${prev.artistIds.length} sample artists.`);
  }
  process.exit(0);
}
if (prev?.eventIds.length) {
  console.log("Sample data is already there. Run `pnpm seed --clear` first to re-seed.");
  process.exit(0);
}

const ARTISTS = [
  { name: "Prateek Kuhad", tier: "A", handle: "prateekkuhad", status: "confirmed" },
  { name: "Hanumankind", tier: "A", handle: "hanumankind", status: "confirmed" },
  { name: "Lifafa", tier: "B", handle: "lifafa", status: "unconfirmed" },
  { name: "Parvaaz", tier: "B", handle: "parvaazband", status: "unconfirmed" },
  { name: "When Chai Met Toast", tier: "B", handle: "whenchaimettoast", status: "confirmed" },
  { name: "Seedhe Maut", tier: "B", handle: "seedhemaut", status: "confirmed" },
  { name: "The Local Train", tier: "C", handle: "thelocaltrain", status: "confirmed" },
  { name: "Sid Sriram", tier: "C", handle: null, status: "none" },
  { name: "Peter Cat Recording Co.", tier: "C", handle: null, status: "none" },
  { name: "Kayan", tier: "C", handle: null, status: "none" },
] as const;

// Adopt artists that already exist (e.g. from a Spotify sync) instead of duplicating them.
const existing = await db.select().from(artists);
const artistIds: number[] = [];
const idOf = new Map<string, number>();
for (const a of ARTISTS) {
  const found = existing.find((e) => e.name.toLowerCase() === a.name.toLowerCase());
  if (found) {
    idOf.set(a.name, found.id);
    continue;
  }
  const [row] = await db
    .insert(artists)
    .values({ name: a.name, priorityTier: a.tier, instagramHandle: a.handle, handleStatus: a.status, followed: true })
    .returning({ id: artists.id });
  idOf.set(a.name, row!.id);
  artistIds.push(row!.id);
}

const T = (name: string, price: number | null, status: TierJson["status"]): TierJson => ({ name, price_inr: price, status });
const SHOWS: {
  artist: string;
  city: string;
  venue: string;
  days: number;
  endDays?: number;
  type?: "concert" | "festival" | "club";
  tiers: TierJson[];
  eb: "open" | "opening" | "sold_out" | "none" | "unknown";
  ebOpens?: number;
  ebCloses?: number;
  sale?: number;
  decision?: "going" | "maybe" | "pass";
  ageHours: number;
  source: string;
}[] = [
  { artist: "Prateek Kuhad", city: "Bengaluru", venue: "Phoenix Marketcity Arena", days: 62, tiers: [T("Early Bird", 1299, "sold_out"), T("Phase 2", 1999, "open"), T("Gate", 2499, "upcoming")], eb: "sold_out", decision: "going", ageHours: 300, source: "instagram" },
  { artist: "Lifafa", city: "Bengaluru", venue: "Fandom at Gilly's", days: 34, tiers: [T("Early Bird", 799, "open"), T("Phase 2", 1099, "upcoming")], eb: "open", ebCloses: 31, decision: "maybe", ageHours: 20, source: "instagram" },
  { artist: "Parvaaz", city: "Bengaluru", venue: "Windmills, Whitefield", days: 21, tiers: [T("Early Bird", 699, "open"), T("Regular", 999, "upcoming")], eb: "open", ebCloses: 58, decision: "maybe", ageHours: 40, source: "district" },
  { artist: "When Chai Met Toast", city: "Mumbai", venue: "NSCI Dome", days: 97, tiers: [T("Silver", 1499, "upcoming"), T("Gold", 2499, "upcoming")], eb: "unknown", sale: 50, decision: "maybe", ageHours: 70, source: "news" },
  { artist: "Hanumankind", city: "Bengaluru", venue: "Bhartiya Mall of Bengaluru", days: 40, tiers: [T("Early Bird", 999, "upcoming")], eb: "opening", ebOpens: 20, ageHours: 2, source: "instagram" },
  { artist: "The Local Train", city: "Pune", venue: "Hard Rock Cafe, Pune", days: 30, tiers: [T("General", 999, "open")], eb: "none", ageHours: 6, source: "district" },
  { artist: "Seedhe Maut", city: "Delhi NCR", venue: "Kingdom of Dreams, Gurugram", days: 55, tiers: [T("GA", 1499, "open")], eb: "sold_out", decision: "going", ageHours: 500, source: "email" },
  { artist: "Sid Sriram", city: "Chennai", venue: "Jawaharlal Nehru Indoor Stadium", days: 45, tiers: [T("Silver", 1999, "sold_out"), T("Gold", 3499, "sold_out")], eb: "sold_out", ageHours: 100, source: "district" },
  { artist: "Peter Cat Recording Co.", city: "Goa", venue: "Vagator", days: 70, endDays: 72, type: "festival", tiers: [T("Phase 1 pass", 4999, "open")], eb: "sold_out", ageHours: 12, source: "instagram" },
  { artist: "Kayan", city: "Hyderabad", venue: "Hard Rock Cafe, Hyderabad", days: 80, tiers: [T("GA", 799, "open")], eb: "none", decision: "pass", ageHours: 200, source: "news" },
];

const eventIds: number[] = [];
for (const s of SHOWS) {
  const artistId = idOf.get(s.artist)!;
  const date = addDays(today, s.days);
  const tier = ARTISTS.find((a) => a.name === s.artist)!.tier;
  const fields = {
    artistId,
    city: s.city,
    venue: s.venue,
    date,
    endDate: s.endDays ? addDays(today, s.endDays) : null,
    eventType: s.type ?? "concert",
    ticketUrl: s.source === "district" ? "https://www.district.in/events/" : null,
    saleStartsAt: s.sale ? hoursFromNow(s.sale) : null,
    earlyBirdStatus: s.eb,
    earlyBirdOpensAt: s.ebOpens ? hoursFromNow(s.ebOpens) : null,
    earlyBirdClosesAt: s.ebCloses ? istInstant(istDate(hoursFromNow(s.ebCloses)), "23:59") : null,
    tiers: s.tiers,
    confidence: 0.93,
    evidence: "Sample show from the seed script",
    title: "[sample]",
  };
  const urgency = computeUrgency({ priorityTier: tier, ...fields }, now);
  const [row] = await db
    .insert(events)
    .values({ ...fields, fingerprint: fingerprint(artistId, s.city, date), urgency, createdAt: new Date(now.getTime() - s.ageHours * 3_600_000) })
    .onConflictDoNothing()
    .returning({ id: events.id });
  if (!row) continue;
  eventIds.push(row.id);
  await db.insert(eventSources).values({ eventId: row.id, source: s.source, url: s.source === "instagram" ? "https://www.instagram.com/" : null });
  if (s.decision) await db.insert(decisions).values({ eventId: row.id, status: s.decision, via: "dashboard" });
}

for (const a of accountSeeds) {
  await db.insert(watchedAccounts).values(a).onConflictDoNothing();
}

const healthRows = [
  { source: "instagram", lastOkAt: hoursFromNow(-0.4), lastRunAt: hoursFromNow(-0.4), lastItemCount: 14, lastNonzeroAt: hoursFromNow(-0.4), consecutiveFailures: 0, healthy: true, lastError: null },
  { source: "district", lastOkAt: hoursFromNow(-0.9), lastRunAt: hoursFromNow(-0.9), lastItemCount: 96, lastNonzeroAt: hoursFromNow(-0.9), consecutiveFailures: 0, healthy: true, lastError: null },
  { source: "bookmyshow", lastOkAt: null, lastRunAt: hoursFromNow(-0.9), lastItemCount: 0, lastNonzeroAt: null, consecutiveFailures: 9, healthy: false, lastError: "blocked by bot protection: Blocked by bot protection at in.bookmyshow.com" },
  { source: "skillbox", lastOkAt: hoursFromNow(-0.9), lastRunAt: hoursFromNow(-0.9), lastItemCount: 2, lastNonzeroAt: hoursFromNow(-0.9), consecutiveFailures: 0, healthy: true, lastError: null },
  { source: "news", lastOkAt: hoursFromNow(-0.4), lastRunAt: hoursFromNow(-0.4), lastItemCount: 5, lastNonzeroAt: hoursFromNow(-0.4), consecutiveFailures: 0, healthy: true, lastError: null },
];
const sources: string[] = [];
const have = new Set((await db.select({ s: sourceHealth.source }).from(sourceHealth)).map((r) => r.s));
for (const r of healthRows) {
  if (have.has(r.source)) continue;
  await db.insert(sourceHealth).values(r);
  sources.push(r.source);
}
if (!(await db.select({ id: jobRuns.id }).from(jobRuns).limit(1)).length) {
  await db.insert(jobRuns).values(
    ["poll", "tiers", "watchlist", "sunday"].map((job, i) => ({ job, startedAt: hoursFromNow(-1 - i), finishedAt: hoursFromNow(-1 - i), status: "ok", statsJson: { sample: true } })),
  );
}

await kvSet(h, "seed", { artistIds, eventIds, sources } satisfies Seeded);
console.log(`Seeded ${artistIds.length} artists and ${eventIds.length} shows. Clear with: pnpm seed --clear`);
