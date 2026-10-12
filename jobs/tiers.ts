/** Every 15 minutes: tier watcher plus sale-start and decide-by reminders. */
import { runTiers } from "./lib/tiers-pipeline";
import { createRuntime, log, runJob } from "./lib/runtime";

const rt = createRuntime("tiers");
process.exitCode = await runJob("tiers", rt, async (rt) => {
  const r = await runTiers({ getDb: rt.getDb, llm: rt.llm, tg: rt.tg, chatId: rt.chatId, dryRun: rt.dryRun, state: rt.state, snapshot: rt.snapshot, now: new Date(), log, groqKey: process.env.GROQ_API_KEY || undefined, groqModel: process.env.GROQ_MODEL || undefined });
  return { stats: r.stats, snapshot: r.snapshot, partial: (r.stats.pageErrors ?? 0) > 0 };
});
