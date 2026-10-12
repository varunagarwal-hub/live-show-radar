import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/**
 * Small JSON files persisted between GitHub Actions runs with actions/cache. They exist only to
 * avoid waking Neon: everything in them can be rebuilt from the database, so a cache miss just
 * costs one extra database round trip. Never put secrets here.
 */
export function stateDir(): string {
  const dir = process.env.RADAR_STATE_DIR || ".radar-state";
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function loadState<S extends z.ZodType>(name: string, schema: S, fallback: z.infer<S>): z.infer<S> {
  const file = join(stateDir(), `${name}.json`);
  if (!existsSync(file)) return fallback;
  try {
    const parsed = schema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

export function saveState(name: string, value: unknown): void {
  writeFileSync(join(stateDir(), `${name}.json`), JSON.stringify(value));
}

const Tier = z.object({ name: z.string(), price_inr: z.number().nullable(), status: z.enum(["open", "upcoming", "sold_out", "unknown"]) });
const DateStr = z.string().nullable();

export const SnapshotArtist = z.object({
  id: z.number(),
  name: z.string(),
  aliases: z.array(z.string()),
  spotifyId: z.string().nullable(),
  instagramHandle: z.string().nullable(),
  handleStatus: z.enum(["none", "unconfirmed", "confirmed"]),
  matchWeight: z.number(),
  muted: z.boolean(),
  priorityTier: z.enum(["A", "B", "C"]),
  bioUrl: z.string().nullable().default(null),
});

export const SnapshotEvent = z.object({
  id: z.number(),
  artistId: z.number(),
  artistName: z.string(),
  priorityTier: z.enum(["A", "B", "C"]),
  city: z.string(),
  venue: z.string().nullable(),
  date: DateStr,
  endDate: DateStr,
  ticketUrl: z.string().nullable(),
  bookingUrl: z.string().nullable().default(null),
  bookingCheckedAt: DateStr.default(null),
  saleStartsAt: DateStr,
  earlyBirdStatus: z.enum(["open", "opening", "sold_out", "none", "unknown"]),
  earlyBirdOpensAt: DateStr,
  earlyBirdClosesAt: DateStr,
  tiers: z.array(Tier),
  confidence: z.number(),
  urgency: z.enum(["urgent", "normal", "possible"]),
  handleUnconfirmed: z.boolean(),
  decision: z.enum(["going", "maybe", "pass", "not_interested"]).nullable(),
  lastStateHash: z.string().nullable(),
  sources: z.array(z.object({ source: z.string(), url: z.string().nullable() })),
});
export type SnapshotEvent = z.infer<typeof SnapshotEvent>;

export const Snapshot = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  artists: z.array(SnapshotArtist),
  watchedAccounts: z.array(z.object({ handle: z.string(), kind: z.enum(["promoter", "venue"]), city: z.string().nullable() })),
  upcoming: z.array(SnapshotEvent),
  /** Alert dedup keys already sent for upcoming events (real and dry-run kept apart). */
  sentAlertKeys: z.array(z.string()),
});
export type Snapshot = z.infer<typeof Snapshot>;

export function snapshotAgeMinutes(s: Snapshot | null, now = new Date()): number {
  if (!s) return Infinity;
  return (now.getTime() - new Date(s.generatedAt).getTime()) / 60_000;
}

export const PendingRun = z.object({
  job: z.string(),
  startedAt: z.string(),
  finishedAt: z.string(),
  status: z.enum(["ok", "partial", "error"]),
  stats: z.record(z.string(), z.unknown()),
  error: z.string().nullable(),
});
export type PendingRun = z.infer<typeof PendingRun>;

export const PendingHealth = z.object({
  source: z.string(),
  at: z.string(),
  ok: z.boolean(),
  itemCount: z.number(),
  error: z.string().nullable(),
});
export type PendingHealth = z.infer<typeof PendingHealth>;

/** Per-job state: seen keys, polling cursors, and job_runs/health rows waiting for the next DB flush. */
export const JobState = z.object({
  seen: z.array(z.string()).default([]),
  cursors: z.record(z.string(), z.string()).default({}),
  pendingRuns: z.array(PendingRun).default([]),
  pendingHealth: z.array(PendingHealth).default([]),
  lastFlushAt: z.string().nullable().default(null),
  /** Last observed tier-state hash per event, so unchanged pages need no database write. */
  tierHashes: z.record(z.string(), z.string()).default({}),
});
export type JobState = z.infer<typeof JobState>;

export const emptyJobState = (): JobState => ({ seen: [], cursors: {}, pendingRuns: [], pendingHealth: [], lastFlushAt: null, tierHashes: {} });

/** Keep the seen list bounded; the DB check catches anything that falls off the end. */
export function rememberSeen(state: JobState, keys: string[], max = 15_000): void {
  const set = new Set(state.seen);
  for (const k of keys) set.add(k);
  state.seen = [...set].slice(-max);
}
