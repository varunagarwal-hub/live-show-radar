import { HttpError, withRetry, type RetryOptions } from "./retry";

/** A realistic browser User-Agent for public listing pages (we never log in or evade blocks). */
export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
/** Descriptive UA for APIs whose terms ask for one (MusicBrainz) and for robots.txt matching. */
export const RADAR_UA = "LiveShowRadar/1.0 (personal, non-commercial; +https://github.com/)";

export interface FetchOptions extends RetryOptions {
  headers?: Record<string, string>;
  method?: string;
  body?: BodyInit;
  timeoutMs?: number;
}

function parseRetryAfter(h: string | null): number | undefined {
  if (!h) return undefined;
  const s = Number(h);
  if (Number.isFinite(s)) return s * 1000;
  const t = Date.parse(h);
  return Number.isNaN(t) ? undefined : Math.max(0, t - Date.now());
}

/** fetch with timeout, retry/backoff on network errors, 429 and 5xx. Throws HttpError otherwise. */
export async function fetchWithRetry(url: string, opts: FetchOptions = {}): Promise<Response> {
  const { headers, method, body, timeoutMs = 20_000, ...retry } = opts;
  return withRetry(async () => {
    const res = await fetch(url, { headers, method, body, signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new HttpError(res.status, url, text.slice(0, 500), parseRetryAfter(res.headers.get("retry-after")));
    }
    return res;
  }, retry);
}

export async function fetchJson<T = unknown>(url: string, opts: FetchOptions = {}): Promise<T> {
  const res = await fetchWithRetry(url, { ...opts, headers: { accept: "application/json", ...opts.headers } });
  return (await res.json()) as T;
}

export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  const res = await fetchWithRetry(url, opts);
  return res.text();
}

/** Detects bot-protection interstitials. We report these as "blocked" and never try to get past them. */
export function looksLikeBotChallenge(status: number, body: string): boolean {
  if (status === 403 || status === 503) {
    return /just a moment|cf-chl|challenge-platform|captcha|attention required/i.test(body);
  }
  return /<title>\s*just a moment/i.test(body);
}
