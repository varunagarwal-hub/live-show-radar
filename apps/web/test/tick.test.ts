import { describe, expect, it } from "vitest";
import { isDue, tick } from "../lib/tick";

const now = new Date("2026-10-21T06:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();

describe("isDue", () => {
  it("starts a job that has never run, or whose last run is older than its interval", () => {
    expect(isDue(undefined, 30, now)).toBe(true);
    expect(isDue({ createdAt: ago(28), status: "completed" }, 30, now)).toBe(true);
    expect(isDue({ createdAt: ago(240), status: "completed" }, 30, now)).toBe(true);
  });

  it("leaves a recent run alone, and never doubles one that's queued or running", () => {
    expect(isDue({ createdAt: ago(10), status: "completed" }, 30, now)).toBe(false);
    expect(isDue({ createdAt: ago(240), status: "in_progress" }, 30, now)).toBe(false);
    expect(isDue({ createdAt: ago(240), status: "queued" }, 30, now)).toBe(false);
  });
});

describe("tick", () => {
  it("dispatches only the jobs that are due", async () => {
    const last: Record<string, { created_at: string; status: string }> = {
      "poll.yml": { created_at: ago(180), status: "completed" },
      "tiers.yml": { created_at: ago(5), status: "completed" },
      "watchlist.yml": { created_at: ago(30), status: "in_progress" },
    };
    const dispatched: string[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      const wf = /workflows\/([^/]+)\//.exec(url)![1]!;
      if (init?.method === "POST") {
        dispatched.push(wf);
        expect(JSON.parse(init.body as string)).toEqual({ ref: "main" });
        return new Response(null, { status: 204 });
      }
      return Response.json({ workflow_runs: [last[wf]] });
    }) as typeof fetch;
    expect(await tick("me/repo", "t", now, f)).toEqual({ poll: "started", tiers: "recent", watchlist: "running" });
    expect(dispatched).toEqual(["poll.yml"]);
  });

  it("reports GitHub errors without throwing", async () => {
    const f = (async () => new Response("bad credentials", { status: 401 })) as unknown as typeof fetch;
    expect(await tick("me/repo", "t", now, f)).toEqual({ poll: "error 401", tiers: "error 401", watchlist: "error 401" });
  });
});
