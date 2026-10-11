import "../../scripts/load-env";
import { radarConfig, optionalEnv } from "@radar/config";
import {
  alertChat,
  emptyJobState,
  esc,
  JobState,
  llmFromEnv,
  loadState,
  saveState,
  sendOnce,
  Snapshot,
  telegramClient,
  type Llm,
  type PendingHealth,
  type TelegramSink,
} from "@radar/core";
import { connectNeon, type DbHandle } from "@radar/core/db";
import { flushPending, staleJobs } from "@radar/core/db/queries";
import type { SourceHealth } from "@radar/sources";

export const JOBS = ["poll", "tiers", "watchlist", "sunday"] as const;
export type JobName = (typeof JOBS)[number];

export const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

/** Prints to the console instead of Telegram (local runs without a bot token). */
export function consoleSink(): TelegramSink & { sent: { chatId: string; html: string }[] } {
  const sent: { chatId: string; html: string }[] = [];
  let id = 0;
  return {
    sent,
    async sendMessage(chatId, html) {
      sent.push({ chatId, html });
      console.log(`--- telegram → ${chatId}\n${html.replace(/<[^>]+>/g, "")}\n---`);
      return { messageId: ++id };
    },
    async sendDocument(chatId, filename) {
      console.log(`--- telegram document → ${chatId}: ${filename}`);
      return { messageId: ++id };
    },
    async answerCallback() {},
    async editKeyboard() {},
  };
}

export interface Runtime {
  getDb: () => Promise<DbHandle>;
  dbOpened: () => boolean;
  llm: () => Llm;
  tg: TelegramSink;
  chatId: string;
  dryRun: boolean;
  state: JobState;
  snapshot: Snapshot | null;
}

export function createRuntime(job: JobName, env: NodeJS.ProcessEnv = process.env): Runtime {
  const dryRun = radarConfig.dryRun;
  const token = optionalEnv("TELEGRAM_BOT_TOKEN", env);
  const tg = token ? telegramClient(token) : consoleSink();
  const chatId = token ? alertChat(env, dryRun) : "console";
  let handle: Promise<DbHandle> | null = null;
  let llm: Llm | null = null;
  return {
    getDb: () => {
      const url = env.DATABASE_URL;
      if (!url) throw new Error("DATABASE_URL is not set");
      return (handle ??= connectNeon(url));
    },
    dbOpened: () => handle !== null,
    llm: () => (llm ??= llmFromEnv(env, log)),
    tg,
    chatId,
    dryRun,
    state: loadState(`job-${job}`, JobState, emptyJobState()),
    snapshot: loadState("snapshot", Snapshot.nullable(), null),
  };
}

export interface JobOutcome {
  stats: Record<string, unknown>;
  health?: { source: string; health: SourceHealth }[];
  snapshot?: Snapshot | null;
  /** "partial" when some sources or items failed but the job did useful work. */
  partial?: boolean;
}

/**
 * Wraps a job: timing, error capture, job_runs + source_health (buffered in the Actions cache
 * and flushed when the DB is awake anyway, or at least hourly), and the cross-job staleness check
 * (spec 9) with a Telegram warning sent once per incident.
 */
export async function runJob(job: JobName, rt: Runtime, body: (rt: Runtime) => Promise<JobOutcome>): Promise<number> {
  const started = new Date();
  let outcome: JobOutcome = { stats: {} };
  let error: string | null = null;
  try {
    outcome = await body(rt);
  } catch (err) {
    error = (err as Error).stack?.split("\n").slice(0, 4).join(" | ") ?? String(err);
    log(`${job} failed: ${error}`);
  }
  const finished = new Date();
  rt.state.pendingRuns.push({
    job,
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    status: error ? "error" : outcome.partial ? "partial" : "ok",
    stats: { ...outcome.stats, durationMs: finished.getTime() - started.getTime() },
    error,
  });
  for (const { source, health } of outcome.health ?? []) {
    const obs: PendingHealth = { source, at: finished.toISOString(), ok: health.ok, itemCount: health.itemCount, error: health.blocked ? `blocked by bot protection${health.error ? `: ${health.error}` : ""}` : health.error };
    rt.state.pendingHealth.push(obs);
    if (health.notes?.length) rt.state.pendingHealth.push({ ...obs, source: `${source}:notes`, ok: true, error: health.notes.join(" · ").slice(0, 500) });
  }

  const heartbeatDue = !rt.state.lastFlushAt || finished.getTime() - Date.parse(rt.state.lastFlushAt) > 60 * 60_000;
  if (rt.dbOpened() || heartbeatDue || error) {
    try {
      const h = await rt.getDb();
      await flushPending(h, rt.state.pendingRuns, rt.state.pendingHealth);
      rt.state.pendingRuns = [];
      rt.state.pendingHealth = [];
      rt.state.lastFlushAt = finished.toISOString();
      await warnStaleJobs(h, rt, job, finished);
    } catch (err) {
      log(`flush failed (kept for next run): ${(err as Error).message}`);
      rt.state.pendingRuns = rt.state.pendingRuns.slice(-200);
      rt.state.pendingHealth = rt.state.pendingHealth.slice(-500);
    }
  }
  saveState(`job-${job}`, rt.state);
  if (outcome.snapshot !== undefined && outcome.snapshot !== null) saveState("snapshot", outcome.snapshot);
  log(`${job} ${error ? "FAILED" : "done"} in ${finished.getTime() - started.getTime()} ms ${JSON.stringify(outcome.stats)}`);
  return error ? 1 : 0;
}

async function warnStaleJobs(h: DbHandle, rt: Runtime, self: JobName, now: Date): Promise<void> {
  const enabled = JOBS.filter((j) => j !== self && (j !== "tiers" || radarConfig.features.tierWatcher));
  // The weekly job is only stale after a week and a bit.
  const daily = enabled.filter((j) => j !== "sunday");
  const stale = [
    ...(await staleJobs(h, daily, radarConfig.health.staleJobHours, now)),
    ...(await staleJobs(h, enabled.filter((j) => j === "sunday"), 8 * 24, now)),
  ];
  for (const s of stale) {
    // Never-run jobs on a fresh install aren't an incident yet.
    if (!s.lastOkAt) continue;
    const since = s.lastOkAt.toISOString();
    await sendOnce(h, rt.tg, {
      dedupKey: `stale:${s.job}:${since}`,
      kind: `stale_job:${s.job}`,
      eventId: null,
      chatId: rt.chatId,
      html: `⚠️ <b>The ${esc(s.job)} job hasn't succeeded since ${esc(since.slice(0, 16).replace("T", " "))} UTC.</b>\nCheck the GitHub Actions run log or the dashboard's Health page.`,
      dryRun: rt.dryRun,
    }).catch((e) => log(`stale warning failed: ${(e as Error).message}`));
  }
}
