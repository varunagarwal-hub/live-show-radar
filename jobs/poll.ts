/**
 * Every 30 minutes: all sources → dedup → extract → match → store → alert.
 * Quiet runs (nothing new) don't touch the database; see ARCHITECTURE.md.
 */
import { runPoll } from "./lib/poll-pipeline";
import { createRuntime, log, runJob } from "./lib/runtime";
import { buildSources } from "./lib/sources";

const rt = createRuntime("poll");
process.exitCode = await runJob("poll", rt, async (rt) => {
  const { sources, instagram } = await buildSources(rt);
  const r = await runPoll({
    getDb: rt.getDb,
    llm: rt.llm(),
    tg: rt.tg,
    chatId: rt.chatId,
    dryRun: rt.dryRun,
    sources,
    instagram,
    state: rt.state,
    snapshot: rt.snapshot,
    now: new Date(),
    log,
    // Keeps a run well inside the workflow timeout even with poster images (~10–15 s each).
    maxExtractions: 30,
  });
  const anyFailed = Object.keys(r.stats).some((k) => k.startsWith("failed_")) || (r.stats.itemErrors ?? 0) > 0;
  return { stats: r.stats, health: r.health, snapshot: r.snapshot, partial: anyFailed };
});
