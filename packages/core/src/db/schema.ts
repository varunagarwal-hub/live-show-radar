import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,

  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** All timestamps are timestamptz stored in UTC; the UI and Telegram render them in IST. */
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const priorityTier = pgEnum("priority_tier", ["A", "B", "C"]);
export const handleStatus = pgEnum("handle_status", ["none", "unconfirmed", "confirmed"]);
export const accountKind = pgEnum("account_kind", ["promoter", "venue"]);
export const eventType = pgEnum("event_type", ["concert", "festival", "club", "other"]);
export const earlyBirdStatus = pgEnum("early_bird_status", ["open", "opening", "sold_out", "none", "unknown"]);
export const urgency = pgEnum("urgency", ["urgent", "normal", "possible"]);
export const eventStatus = pgEnum("event_status", ["announced", "possible", "cancelled", "past"]);
export const decisionStatus = pgEnum("decision_status", ["going", "maybe", "pass", "not_interested"]);

export const artists = pgTable(
  "artists",
  {
    id: serial().primaryKey(),
    spotifyId: text().unique(),
    name: text().notNull(),
    aliases: text().array().notNull().default(sql`'{}'::text[]`),
    instagramHandle: text(),
    handleStatus: handleStatus().notNull().default("none"),
    musicbrainzId: text(),
    priorityTier: priorityTier().notNull().default("C"),
    listenedNotFollowed: boolean().notNull().default(false),
    followed: boolean().notNull().default(false),
    muted: boolean().notNull().default(false),
    imageUrl: text(),
    /** Lowered by "Wrong artist" feedback; fuzzy matches must clear fuzzyMatchFloor / weight. */
    matchWeight: real().notNull().default(1),
    /** Handle proposal has been requested from the LLM (so we ask only once). */
    handleProposedAt: ts("handle_proposed_at"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("artists_name_idx").on(sql`lower(${t.name})`), index("artists_handle_idx").on(t.instagramHandle)],
);

export const watchedAccounts = pgTable("watched_accounts", {
  id: serial().primaryKey(),
  handle: text().notNull().unique(),
  kind: accountKind().notNull(),
  city: text(),
  active: boolean().notNull().default(true),
  createdAt: createdAt(),
});

export const rawItems = pgTable(
  "raw_items",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    source: text().notNull(),
    externalId: text().notNull(),
    contentHash: text().notNull(),
    /** sha256(source + external_id + content_hash): the dedup key checked before any LLM call. */
    dedupKey: text().notNull().unique(),
    url: text(),
    text: text().notNull(),
    imageUrl: text(),
    /** Poster bytes kept only while the item is unprocessed (Instagram CDN URLs expire). */
    imageData: bytea(),
    imageMime: text(),
    /** Source-specific extras: account handle, listing city, email sender, etc. */
    meta: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    publishedAt: ts("published_at"),
    fetchedAt: ts("fetched_at").notNull().defaultNow(),
    processed: boolean().notNull().default(false),
    processedAt: ts("processed_at"),
    processAttempts: integer().notNull().default(0),
    lastError: text(),
  },
  (t) => [index("raw_items_unprocessed_idx").on(t.processed, t.fetchedAt)],
);

export type TierJson = { name: string; price_inr: number | null; status: "open" | "upcoming" | "sold_out" | "unknown" };
export type FieldChange = { field: string; from: unknown; to: unknown; at: string; source: string };

export const events = pgTable(
  "events",
  {
    id: serial().primaryKey(),
    /** artist_id + city + date (see core/events/fingerprint.ts). */
    fingerprint: text().notNull().unique(),
    artistId: integer()
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    title: text(),
    city: text().notNull(),
    venue: text(),
    date: date({ mode: "string" }),
    endDate: date({ mode: "string" }),
    eventType: eventType().notNull().default("concert"),
    ticketUrl: text(),
    saleStartsAt: ts("sale_starts_at"),
    earlyBirdStatus: earlyBirdStatus().notNull().default("unknown"),
    earlyBirdOpensAt: ts("early_bird_opens_at"),
    earlyBirdClosesAt: ts("early_bird_closes_at"),
    tiers: jsonb().$type<TierJson[]>().notNull().default([]),
    urgency: urgency().notNull().default("normal"),
    confidence: real().notNull(),
    status: eventStatus().notNull().default("announced"),
    evidence: text(),
    /** True when the match relied on an unconfirmed Instagram handle. */
    handleUnconfirmed: boolean().notNull().default(false),
    /** Every overwrite of a non-null field, with the source that caused it. */
    fieldHistory: jsonb().$type<FieldChange[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("events_date_idx").on(t.date), index("events_artist_idx").on(t.artistId)],
);

export const eventSources = pgTable(
  "event_sources",
  {
    id: serial().primaryKey(),
    eventId: integer()
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    rawItemId: bigint({ mode: "number" }).references(() => rawItems.id, { onDelete: "set null" }),
    source: text().notNull(),
    url: text(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("event_sources_event_url_idx").on(t.eventId, t.source, t.url)],
);

export const tierSnapshots = pgTable(
  "tier_snapshots",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    eventId: integer()
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    capturedAt: ts("captured_at").notNull().defaultNow(),
    tiersJson: jsonb().$type<TierJson[]>().notNull(),
    earlyBirdStatus: earlyBirdStatus().notNull(),
    /** "fast_filling" | "few_left" | null */
    availability: text(),
    stateHash: text().notNull(),
    method: text().notNull(),
  },
  (t) => [index("tier_snapshots_event_idx").on(t.eventId, t.capturedAt)],
);

export const decisions = pgTable("decisions", {
  eventId: integer()
    .primaryKey()
    .references(() => events.id, { onDelete: "cascade" }),
  status: decisionStatus().notNull(),
  decidedAt: ts("decided_at").notNull().defaultNow(),
  /** "telegram" | "dashboard" */
  via: text().notNull(),
});

export const alerts = pgTable(
  "alerts",
  {
    id: serial().primaryKey(),
    eventId: integer().references(() => events.id, { onDelete: "cascade" }),
    /** new_event | possible_show | sale_reminder | early_bird_reminder | decide_reminder | tier:<change> | stale_job:<job> | digest | token_warning ... */
    kind: text().notNull(),
    /** Identifies one logical alert so it is never sent twice. */
    dedupKey: text().notNull(),
    sentAt: ts("sent_at").notNull().defaultNow(),
    telegramMessageId: integer(),
    dryRun: boolean().notNull().default(false),
  },
  (t) => [uniqueIndex("alerts_dedup_idx").on(t.dedupKey, t.dryRun)],
);

export const feedback = pgTable("feedback", {
  id: serial().primaryKey(),
  eventId: integer().references(() => events.id, { onDelete: "set null" }),
  artistId: integer().references(() => artists.id, { onDelete: "cascade" }),
  kind: text().notNull(),
  note: text(),
  createdAt: createdAt(),
});

export const playlists = pgTable("playlists", {
  eventId: integer()
    .primaryKey()
    .references(() => events.id, { onDelete: "cascade" }),
  spotifyPlaylistId: text().notNull(),
  url: text().notNull(),
  /** "setlists" | "releases" */
  basis: text().notNull(),
  trackCount: integer().notNull().default(0),
  refreshedAt: ts("refreshed_at").notNull().defaultNow(),
});

export const misses = pgTable(
  "misses",
  {
    id: serial().primaryKey(),
    artistId: integer()
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    city: text().notNull(),
    date: date({ mode: "string" }).notNull(),
    evidenceUrl: text(),
    likelyCause: text().notNull(),
    /** An Instagram account that announced the show and that we don't track. */
    suggestedHandle: text(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("misses_unique_idx").on(t.artistId, t.city, t.date)],
);

export const jobRuns = pgTable(
  "job_runs",
  {
    id: serial().primaryKey(),
    job: text().notNull(),
    startedAt: ts("started_at").notNull(),
    finishedAt: ts("finished_at"),
    /** ok | partial | error */
    status: text().notNull(),
    statsJson: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    error: text(),
  },
  (t) => [index("job_runs_job_idx").on(t.job, t.startedAt)],
);

export const sourceHealth = pgTable("source_health", {
  source: text().primaryKey(),
  lastOkAt: ts("last_ok_at"),
  lastRunAt: ts("last_run_at"),
  lastItemCount: integer().notNull().default(0),
  lastNonzeroAt: ts("last_nonzero_at"),
  consecutiveFailures: integer().notNull().default(0),
  lastError: text(),
  healthy: boolean().notNull().default(true),
});

/** Small mutable state: refreshed Instagram token and expiry, rotated Spotify refresh token. */
export const kv = pgTable("kv", {
  key: text().primaryKey(),
  value: jsonb().$type<unknown>().notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export type Artist = typeof artists.$inferSelect;
export type NewArtist = typeof artists.$inferInsert;
export type WatchedAccount = typeof watchedAccounts.$inferSelect;
export type RawItemRow = typeof rawItems.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type Decision = typeof decisions.$inferSelect;
export type AlertRow = typeof alerts.$inferSelect;
export type JobRun = typeof jobRuns.$inferSelect;
export type SourceHealthRow = typeof sourceHealth.$inferSelect;
export type PlaylistRow = typeof playlists.$inferSelect;
export type MissRow = typeof misses.$inferSelect;

