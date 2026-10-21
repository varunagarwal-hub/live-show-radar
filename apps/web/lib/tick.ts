/**
 * GitHub's scheduler is best-effort: on a busy day it can skip most of a repo's timed runs. An
 * outside pinger calls /api/tick every few minutes, and this starts any job whose last run is
 * older than its interval. The GitHub timers stay on, so whichever fires first wins; a job that
 * ran recently (from either) is left alone, and one already queued or running is never doubled.
 */
export const TICKED_JOBS = [
  { workflow: "poll.yml", everyMinutes: 30 },
  { workflow: "tiers.yml", everyMinutes: 15 },
  { workflow: "watchlist.yml", everyMinutes: 360 },
] as const;

/** A couple of minutes' slack, so a pinger every 5 minutes doesn't fire just before the timer. */
const SLACK_MINUTES = 3;

export interface LastRun {
  createdAt: string;
  status: string;
}

export function isDue(last: LastRun | undefined, everyMinutes: number, now: Date): boolean {
  if (!last) return true;
  if (last.status !== "completed") return false;
  return now.getTime() - Date.parse(last.createdAt) >= (everyMinutes - SLACK_MINUTES) * 60_000;
}

type Fetch = typeof fetch;

/** Checks each job's latest run and starts the ones that are due. Returns what it did per job. */
export async function tick(repo: string, token: string, now: Date, f: Fetch = fetch): Promise<Record<string, string>> {
  const gh = (path: string, init?: RequestInit) =>
    f(`https://api.github.com/repos/${repo}/actions/workflows/${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "early-access-tick" },
      cache: "no-store",
    });
  const out: Record<string, string> = {};
  for (const job of TICKED_JOBS) {
    const name = job.workflow.replace(/\.yml$/, "");
    try {
      const res = await gh(`${job.workflow}/runs?per_page=1`);
      if (!res.ok) {
        out[name] = `error ${res.status}`;
        continue;
      }
      const run = ((await res.json()) as { workflow_runs?: { created_at: string; status: string }[] }).workflow_runs?.[0];
      if (!isDue(run && { createdAt: run.created_at, status: run.status }, job.everyMinutes, now)) {
        out[name] = run?.status === "completed" ? "recent" : "running";
        continue;
      }
      const started = await gh(`${job.workflow}/dispatches`, { method: "POST", body: JSON.stringify({ ref: "main" }) });
      out[name] = started.status === 204 ? "started" : `error ${started.status}`;
    } catch (err) {
      out[name] = `error ${(err as Error).name}`;
    }
  }
  return out;
}
