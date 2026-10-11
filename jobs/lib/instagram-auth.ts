import { optionalEnv, radarConfig, requireEnv } from "@radar/config";
import { esc, sendOnce, sha256, type JobState, type TelegramSink } from "@radar/core";
import type { DbHandle } from "@radar/core/db";
import { kvGet, kvSet } from "@radar/core/db/queries";
import { daysLeft, exchangeToken, inspectToken, openToken, sealToken, type TokenInfo } from "@radar/sources";

const KV_KEY = "instagram_token";
// The cache key includes the env token fingerprint, so replacing the secret invalidates the cached copy.
const stateKey = () => `igTokenSealed:${fp(optionalEnv("INSTAGRAM_ACCESS_TOKEN") ?? "")}`;

type StoredToken = TokenInfo & { envFp?: string };
const fp = (t: string) => sha256(t).slice(0, 16);

/** The refreshed token wins, unless INSTAGRAM_ACCESS_TOKEN was replaced since it was stored. */
function pickToken(stored: StoredToken | null): StoredToken | null {
  const envToken = optionalEnv("INSTAGRAM_ACCESS_TOKEN");
  if (envToken && (!stored || stored.envFp !== fp(envToken))) return { token: envToken, expiresAt: null, envFp: fp(envToken) };
  return stored;
}

/**
 * The current Instagram token without waking the database when possible: an encrypted copy in
 * the job state, else the refreshed token in Neon, else the bootstrap env var.
 */
export async function currentInstagramToken(state: JobState, getDb: () => Promise<DbHandle>): Promise<string | null> {
  const env = requireEnv(["FACEBOOK_APP_SECRET"]);
  const sealed = state.cursors[stateKey()];
  const cached = sealed ? openToken(sealed, env.FACEBOOK_APP_SECRET) : null;
  if (cached && daysLeft(cached) > 1) return cached.token;
  const info = pickToken(await kvGet<StoredToken>(await getDb(), KV_KEY));
  if (!info) return null;
  state.cursors[stateKey()] = sealToken(info, env.FACEBOOK_APP_SECRET);
  return info.token;
}

/**
 * Daily (watchlist job): learn the token's expiry, re-exchange it when fewer than
 * `refreshWhenDaysLeft` days remain, store it in Neon, and warn on Telegram if that fails.
 */
export async function maintainInstagramToken(h: DbHandle, state: JobState, tg: TelegramSink, chatId: string, dryRun: boolean, now = new Date()) {
  const env = requireEnv(["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET", "GRAPH_API_VERSION"]);
  const stored = pickToken(await kvGet<StoredToken>(h, KV_KEY));
  let info: StoredToken | null = stored;
  if (!info) return { status: "missing" as const };

  const warn = async (reason: string) => {
    const left = daysLeft(info!, now);
    await sendOnce(h, tg, {
      dedupKey: `igtoken:${now.toISOString().slice(0, 10)}`,
      kind: "token_warning",
      eventId: null,
      chatId,
      html:
        `⚠️ <b>Instagram token refresh failed</b>: ${esc(reason)}\n` +
        (Number.isFinite(left) ? `The current token stops working in about ${Math.max(0, Math.floor(left))} days. ` : "") +
        "Follow README → Instagram → “Getting a new token”, then update INSTAGRAM_ACCESS_TOKEN.",
      dryRun,
    });
  };

  try {
    const inspected = await inspectToken(info.token, env.FACEBOOK_APP_ID, env.FACEBOOK_APP_SECRET, env.GRAPH_API_VERSION);
    if (!inspected.valid) {
      await warn("Meta says the token is no longer valid");
      return { status: "invalid" as const };
    }
    info = { ...info, expiresAt: inspected.expiresAt };
    if (daysLeft(info, now) < radarConfig.instagram.refreshWhenDaysLeft) {
      info = { ...(await exchangeToken(info.token, env.FACEBOOK_APP_ID, env.FACEBOOK_APP_SECRET, env.GRAPH_API_VERSION)), envFp: info.envFp };
    }
    await kvSet(h, KV_KEY, info);
    state.cursors[stateKey()] = sealToken(info, env.FACEBOOK_APP_SECRET);
    return { status: "ok" as const, daysLeft: daysLeft(info, now) };
  } catch (err) {
    await warn((err as Error).message.slice(0, 200));
    return { status: "error" as const };
  }
}
