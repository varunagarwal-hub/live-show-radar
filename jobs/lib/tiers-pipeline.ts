import { and, desc, eq, isNull } from "drizzle-orm";
import { radarConfig } from "@radar/config";
import {
  diffTierState,
  dueReminders,
  esc,
  eventKeyboard,
  fetchLinkPage,
  isLinkPage,
  matchBookingLink,
  searchBookingUrl,
  type BookingLink,
  type BookingShow,
  formatReminder,
  istDate,
  llmTierState,
  sendOnce,
  snapshotAgeMinutes,
  snapshotAlertKey,
  ticketLines,
  TIER_CHANGE_TEXT,
  tierStateHash,
  type AlertEvent,
  type JobState,
  type Llm,
  type Snapshot,
  type SnapshotEvent,
  type TelegramSink,
  type TierState,
} from "@radar/core";
import type { DbHandle } from "@radar/core/db";
import { events, tierSnapshots, type FieldChange } from "@radar/core/db/schema";
import { loadSnapshot } from "@radar/core/db/queries";
import { BlockedError, parseTierPage, politeFetch, type PageFetcher } from "@radar/sources";

export interface TiersDeps {
  getDb: () => Promise<DbHandle>;
  llm: () => Llm;
  tg: TelegramSink;
  chatId: string;
  dryRun: boolean;
  state: JobState;
  snapshot: Snapshot | null;
  now: Date;
  log: (m: string) => void;
  fetchPage?: PageFetcher;
  maxPages?: number;
  /** Booking lookup (booking.ts): the Groq key enables the web search step. */
  groqKey?: string;
  groqModel?: string;
  linkPage?: (url: string) => Promise<BookingLink[]>;
  searchBooking?: (show: BookingShow) => Promise<string | null>;
}

/** Ticketing sites that block servers: the tier watcher can't read them, so it doesn't try. */
const UNREADABLE_HOSTS = /(^|\.)(district\.in|bookmyshow\.com)$/i;
const readable = (url: string) => {
  try {
    return !UNREADABLE_HOSTS.test(new URL(url).hostname);
  } catch {
    return false;
  }
};

const HOUR = 3_600_000;
/** Bio pages are cheap to re-read; a web search costs ~15k Groq tokens, so it is rationed. */
const BIO_RECHECK_HOURS = 12;
const SEARCH_RECHECK_HOURS = 24;
const LOOKUPS_PER_RUN = 6;
const SEARCHES_PER_RUN = 1;
/** Groq's free tier allows 200k tokens a day, shared with the extraction fallback: ~90k for this. */
const SEARCHES_PER_DAY = 6;

const toDate = (s: string | null) => (s ? new Date(s) : null);

export function snapshotToAlertEvent(e: SnapshotEvent, bioUrl: string | null = null): AlertEvent {
  return {
    bioUrl,
    id: e.id,
    artistName: e.artistName,
    priorityTier: e.priorityTier,
    city: e.city,
    venue: e.venue,
    date: e.date,
    endDate: e.endDate,
    tiers: e.tiers,
    earlyBirdStatus: e.earlyBirdStatus,
    earlyBirdOpensAt: toDate(e.earlyBirdOpensAt),
    earlyBirdClosesAt: toDate(e.earlyBirdClosesAt),
    saleStartsAt: toDate(e.saleStartsAt),
    ticketUrl: e.ticketUrl,
    bookingUrl: e.bookingUrl,
    confidence: e.confidence,
    urgency: e.urgency,
    handleUnconfirmed: e.handleUnconfirmed,
    sources: e.sources,
  };
}

/**
 * Every 15 minutes (spec 4.8 + reminders in 4.7). Re-reads ticket pages of upcoming shows,
 * HTML first and the LLM only when there are no structured offers. Unchanged pages cost no
 * database access at all; changes are snapshotted and alerted once per (change, state).
 */
export async function runTiers(d: TiersDeps) {
  const stats: Record<string, number> = {};
  let h: DbHandle | null = null;
  const db = async () => (h ??= await d.getDb());
  let wrote = false;

  let snapshot = d.snapshot;
  if (!snapshot || snapshotAgeMinutes(snapshot, d.now) > radarConfig.intervals.snapshotMaxAgeMinutes) {
    snapshot = await loadSnapshot(await db(), d.now);
    stats.snapshotRefreshed = 1;
  }
  const sent = new Set(snapshot.sentAlertKeys.filter((k) => k.startsWith("dry:") === d.dryRun).map((k) => k.replace(/^dry:/, "")));
  const today = istDate(d.now);

  // Reminders first: they're time-critical, and late cron runs must still deliver them.
  for (const r of dueReminders(snapshot.upcoming, d.now, sent)) {
    const ev = snapshot.upcoming.find((e) => e.id === r.eventId)!;
    const res = await sendOnce(await db(), d.tg, {
      dedupKey: r.dedupKey,
      kind: r.kind,
      eventId: r.eventId,
      chatId: d.chatId,
      html: formatReminder(r.kind, snapshotToAlertEvent(ev, snapshot.artists.find((a) => a.id === ev.artistId)?.bioUrl ?? null), d.now),
      keyboard: eventKeyboard(r.eventId, { compact: true }),
      dryRun: d.dryRun,
    });
    if (res === "sent") stats.remindersSent = (stats.remindersSent ?? 0) + 1;
    snapshot.sentAlertKeys.push(snapshotAlertKey(r.dedupKey, d.dryRun));
  }

  await lookUpBookingPages(d, snapshot, today, stats, db).then((n) => (wrote ||= n > 0));

  if (radarConfig.features.tierWatcher) {
    const fetchPage = d.fetchPage ?? politeFetch;
    const watch = snapshot.upcoming.filter(
      (e) => e.ticketUrl && readable(e.ticketUrl) && e.urgency !== "possible" && (!e.date || (e.endDate ?? e.date) >= today) && e.decision !== "pass" && e.decision !== "not_interested",
    );
    for (const e of watch.slice(0, d.maxPages ?? 30)) {
      try {
        const page = parseTierPage(await fetchPage(e.ticketUrl!), d.now);
        let next: TierState = page;
        if (!page.parseable) {
          if (page.pageText.length < 200) continue; // JS-only page: nothing to read
          const hashOfText = tierStateHash({ tiers: [{ name: page.pageText.slice(0, 4000), price_inr: null, status: "unknown" }], earlyBirdStatus: "unknown", availability: null });
          if (d.state.tierHashes[`text:${e.id}`] === hashOfText) continue; // same text as last time: skip the LLM
          d.state.tierHashes[`text:${e.id}`] = hashOfText;
          next = await llmTierState(d.llm(), page.pageText);
          stats.llmFallbacks = (stats.llmFallbacks ?? 0) + 1;
        }
        const hash = tierStateHash(next);
        const known = d.state.tierHashes[String(e.id)] ?? e.lastStateHash;
        stats.pagesChecked = (stats.pagesChecked ?? 0) + 1;
        if (known === hash) continue;

        const hh = await db();
        const [last] = await hh.db.select().from(tierSnapshots).where(eq(tierSnapshots.eventId, e.id)).orderBy(desc(tierSnapshots.capturedAt)).limit(1);
        const prev: TierState | null = last
          ? { tiers: last.tiersJson, earlyBirdStatus: last.earlyBirdStatus, availability: (last.availability as TierState["availability"]) ?? null, method: last.method as TierState["method"] }
          : e.tiers.length
            ? { tiers: e.tiers, earlyBirdStatus: e.earlyBirdStatus, availability: null, method: "html" }
            : null;
        const changes = diffTierState(prev, next);
        const history: FieldChange[] =
          prev && prev.earlyBirdStatus !== next.earlyBirdStatus ? [{ field: "earlyBirdStatus", from: prev.earlyBirdStatus, to: next.earlyBirdStatus, at: d.now.toISOString(), source: "tier-watcher" }] : [];
        await hh.batch([
          hh.db.insert(tierSnapshots).values({ eventId: e.id, capturedAt: d.now, tiersJson: next.tiers, earlyBirdStatus: next.earlyBirdStatus, availability: next.availability, stateHash: hash, method: next.method }),
          hh.db
            .update(events)
            .set({
              tiers: next.tiers,
              ...(next.earlyBirdStatus !== "unknown" ? { earlyBirdStatus: next.earlyBirdStatus } : {}),
              ...(history.length ? { fieldHistory: (await hh.db.select({ f: events.fieldHistory }).from(events).where(eq(events.id, e.id)))[0]!.f.concat(history) } : {}),
              updatedAt: d.now,
            })
            .where(eq(events.id, e.id)),
        ]);
        wrote = true;
        d.state.tierHashes[String(e.id)] = hash;
        stats.snapshots = (stats.snapshots ?? 0) + 1;

        const ae = snapshotToAlertEvent({ ...e, tiers: next.tiers, earlyBirdStatus: next.earlyBirdStatus === "unknown" ? e.earlyBirdStatus : next.earlyBirdStatus });
        for (const c of changes) {
          const res = await sendOnce(hh, d.tg, {
            dedupKey: `tier:${e.id}:${c}:${hash}`,
            kind: `tier:${c}`,
            eventId: e.id,
            chatId: d.chatId,
            html: [`🎟 <b>${esc(e.artistName)}, ${esc(e.city)}: ${TIER_CHANGE_TEXT[c]}</b>`, ...ticketLines(ae, d.now), `🛒 <a href="${esc(e.ticketUrl!)}">Open tickets</a>`].join("\n"),
            keyboard: c === "sold_out" ? undefined : eventKeyboard(e.id, { compact: true }),
            silent: c === "sold_out" && e.decision !== "maybe" && e.decision !== "going",
            dryRun: d.dryRun,
          });
          if (res === "sent") stats.tierAlerts = (stats.tierAlerts ?? 0) + 1;
        }
      } catch (err) {
        if (err instanceof BlockedError) stats.blocked = (stats.blocked ?? 0) + 1;
        else d.log(`tier page for event ${e.id}: ${(err as Error).message}`);
        stats.pageErrors = (stats.pageErrors ?? 0) + 1;
      }
    }
  }

  if (wrote) snapshot = await loadSnapshot(await db(), d.now);
  return { stats, snapshot, dbOpened: h !== null };
}

/**
 * Finds booking pages for upcoming shows that have no ticket link: first on the artist's
 * link-in-bio page, then (rationed) by web search. Returns how many rows it updated.
 */
async function lookUpBookingPages(d: TiersDeps, snapshot: Snapshot, today: string, stats: Record<string, number>, db: () => Promise<DbHandle>): Promise<number> {
  const now = d.now.getTime();
  const rank = (e: SnapshotEvent) => (e.decision === "going" ? 0 : e.decision === "maybe" ? 1 : e.urgency === "urgent" ? 2 : 3);
  const due = snapshot.upcoming
    .filter(
      (e) =>
        !e.ticketUrl &&
        !e.bookingUrl &&
        e.city !== "TBA" &&
        e.urgency !== "possible" &&
        e.decision !== "pass" &&
        e.decision !== "not_interested" &&
        (!e.date || e.date >= today) &&
        (!e.bookingCheckedAt || now - Date.parse(e.bookingCheckedAt) >= BIO_RECHECK_HOURS * HOUR),
    )
    .sort((a, b) => rank(a) - rank(b) || (a.date ?? "9999").localeCompare(b.date ?? "9999"))
    .slice(0, LOOKUPS_PER_RUN);
  if (!due.length) return 0;

  const linkPage = d.linkPage ?? ((u: string) => fetchLinkPage(u));
  const search = d.searchBooking ?? (d.groqKey ? (s: BookingShow) => searchBookingUrl(d.groqKey!, s, d.groqModel || undefined) : null);
  const pages = new Map<string, BookingLink[]>();
  let searches = 0;

  for (const e of due) {
    const show = { artistName: e.artistName, city: e.city, date: e.date };
    let url: string | null = null;
    const bio = snapshot.artists.find((a) => a.id === e.artistId)?.bioUrl ?? null;
    if (bio && isLinkPage(bio)) {
      try {
        if (!pages.has(bio)) pages.set(bio, await linkPage(bio));
        url = matchBookingLink(show, pages.get(bio)!);
        if (url) stats.bookingFromBio = (stats.bookingFromBio ?? 0) + 1;
      } catch (err) {
        pages.set(bio, []);
        d.log(`bio page ${bio}: ${(err as Error).message}`);
      }
    }
    const searchKey = `booksearch:${e.id}`;
    const lastSearch = d.state.cursors[searchKey];
    const [day, used] = (d.state.cursors["booksearch:day"] ?? "").split("|");
    const usedToday = day === today ? Number(used) || 0 : 0;
    // Only for shows Karan is going to, might go to, or that are urgent: the rest keep the plain search.
    const worthSearching = e.decision === "going" || e.decision === "maybe" || e.urgency === "urgent";
    if (!url && search && worthSearching && searches < SEARCHES_PER_RUN && usedToday < SEARCHES_PER_DAY && (!lastSearch || now - Date.parse(lastSearch) >= SEARCH_RECHECK_HOURS * HOUR)) {
      searches++;
      d.state.cursors[searchKey] = d.now.toISOString();
      d.state.cursors["booksearch:day"] = `${today}|${usedToday + 1}`;
      try {
        url = await search(show);
        stats.bookingSearches = (stats.bookingSearches ?? 0) + 1;
        if (url) stats.bookingFromSearch = (stats.bookingFromSearch ?? 0) + 1;
      } catch (err) {
        d.log(`booking search for event ${e.id}: ${(err as Error).message.slice(0, 200)}`);
      }
    }
    // Only ever fills an empty link: a cached snapshot can be older than a link stored since.
    await (await db()).db
      .update(events)
      .set(url ? { bookingUrl: url, bookingCheckedAt: d.now } : { bookingCheckedAt: d.now })
      .where(and(eq(events.id, e.id), isNull(events.bookingUrl)));
  }
  // Checked-at changed for every row, so the snapshot must be rebuilt either way.
  return due.length;
}
