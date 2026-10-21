import { secretMatches } from "@/lib/secrets";
import { tick } from "@/lib/tick";

export const dynamic = "force-dynamic";

/**
 * /api/tick?key=<TICK_SECRET> — called every few minutes by an outside uptime pinger. Starts any
 * GitHub job that GitHub's own timer has left waiting too long (see lib/tick.ts). Without the
 * right key it answers 404, as if it weren't there.
 */
export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key");
  if (!secretMatches(key, process.env.TICK_SECRET)) return new Response("not found", { status: 404 });
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) return Response.json({ error: "GITHUB_DISPATCH_TOKEN is not set" }, { status: 503 });
  const jobs = await tick(process.env.GITHUB_REPO ?? "varunagarwal-hub/live-show-radar", token, new Date());
  const failed = Object.values(jobs).some((s) => s.startsWith("error"));
  return Response.json({ jobs }, { status: failed ? 502 : 200 });
}
