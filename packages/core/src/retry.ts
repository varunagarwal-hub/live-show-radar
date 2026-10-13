export interface RetryOptions {
  attempts?: number;
  baseMs?: number;
  maxMs?: number;
  label?: string;
  /** Return false to stop retrying (e.g. a 4xx other than 429). */
  shouldRetry?: (err: unknown) => boolean;
}

export class HttpError extends Error {
  readonly url: string;
  constructor(
    readonly status: number,
    url: string,
    readonly body: string,
    readonly retryAfterMs?: number,
  ) {
    super(`HTTP ${status} for ${redactUrl(url)}`);
    // Kept redacted too: a printed error object shows its properties.
    this.url = redactUrl(url);
  }
}

/** Strip query strings and Telegram's /bot<token>/ path so tokens and keys never reach logs. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.replace(/\/bot\d+:[\w-]+/, "/bot<token>")}${u.search ? "?…" : ""}`;
  } catch {
    return "<url>";
  }
}

export function isRetryable(err: unknown): boolean {
  if (err instanceof HttpError) return err.status === 429 || err.status >= 500;
  return true; // network errors, timeouts
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Exponential backoff with jitter; honours Retry-After on 429s. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { attempts = 3, baseMs = 500, maxMs = 15_000, shouldRetry = isRetryable } = opts;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1 || !shouldRetry(err)) break;
      const hinted = err instanceof HttpError ? err.retryAfterMs : undefined;
      const backoff = Math.min(maxMs, baseMs * 2 ** i) * (0.75 + Math.random() * 0.5);
      await sleep(Math.min(maxMs, hinted ?? backoff));
    }
  }
  throw lastErr;
}
