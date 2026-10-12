import { BROWSER_UA, HttpError, looksLikeBotChallenge, robotsAllows, sleep, withRetry } from "@radar/core";
import { BlockedError, RobotsDisallowedError } from "./types";

/**
 * Fetches a public page the way a person's browser would: realistic User-Agent, robots.txt
 * respected, a pause between requests to the same host, backoff on errors. Bot-protection
 * interstitials raise BlockedError; we never solve challenges, log in, or retry around them.
 */
const lastHit = new Map<string, number>();
const MIN_GAP_MS = 1500;

export type PageFetcher = (url: string) => Promise<string>;

async function rawFetch(url: string, accept: string): Promise<string> {
  return withRetry(
    async () => {
      const res = await fetch(url, {
        headers: { "user-agent": BROWSER_UA, accept, "accept-language": "en-IN,en;q=0.9" },
        signal: AbortSignal.timeout(25_000),
        redirect: "follow",
      });
      const body = await res.text();
      // A challenge page, or a flat 403 on a page robots.txt allows (sites often refuse data-centre
      // addresses this way), is bot protection: report it as blocked and never work around it.
      if (looksLikeBotChallenge(res.status, body) || res.status === 403) throw new BlockedError(url);
      if (!res.ok) throw new HttpError(res.status, url, body.slice(0, 300));
      return body;
    },
    { attempts: 3, baseMs: 2000, shouldRetry: (e) => !(e instanceof BlockedError) && (!(e instanceof HttpError) || e.status === 429 || e.status >= 500) },
  );
}

export async function politeFetch(url: string, accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"): Promise<string> {
  const allowed = await robotsAllows(url, BROWSER_UA, (u) => rawFetch(u, "text/plain"));
  if (!allowed) throw new RobotsDisallowedError(url);
  const host = new URL(url).host;
  const wait = (lastHit.get(host) ?? 0) + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());
  return rawFetch(url, accept);
}
