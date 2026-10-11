import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { fetchJson } from "@radar/core";

const DebugToken = z.object({
  data: z.object({
    is_valid: z.boolean(),
    expires_at: z.number().optional(),
    data_access_expires_at: z.number().optional(),
  }),
});

const Exchange = z.object({ access_token: z.string(), expires_in: z.number().optional() });

export interface TokenInfo {
  token: string;
  /** ISO time the token stops working; null if the token never expires (e.g. a system-user token). */
  expiresAt: string | null;
}

/** Asks Graph API when a token expires. Uses the app token (app_id|app_secret), server-side only. */
export async function inspectToken(token: string, appId: string, appSecret: string, version: string): Promise<{ valid: boolean; expiresAt: string | null }> {
  const url = `https://graph.facebook.com/${version}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`;
  const { data } = DebugToken.parse(await fetchJson(url, { attempts: 2 }));
  const exp = data.expires_at && data.expires_at > 0 ? new Date(data.expires_at * 1000).toISOString() : null;
  return { valid: data.is_valid, expiresAt: exp };
}

// NOTE: Meta documents exchanging a short-lived user token for a ~60-day long-lived one via
// grant_type=fb_exchange_token, but documents no server-side refresh of a long-lived token.
// Re-exchanging a still-valid long-lived token is the closest working approach (it returns a
// fresh ~60-day token in practice), so the watchlist job does that when fewer than
// `instagram.refreshWhenDaysLeft` days remain and warns on Telegram if it fails. A Business
// Manager system-user token (no expiry) avoids refreshes entirely; see the README.
export async function exchangeToken(token: string, appId: string, appSecret: string, version: string): Promise<TokenInfo> {
  const url =
    `https://graph.facebook.com/${version}/oauth/access_token?grant_type=fb_exchange_token` +
    `&client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(appSecret)}&fb_exchange_token=${encodeURIComponent(token)}`;
  const r = Exchange.parse(await fetchJson(url, { attempts: 2 }));
  return { token: r.access_token, expiresAt: r.expires_in ? new Date(Date.now() + r.expires_in * 1000).toISOString() : null };
}

export function daysLeft(info: TokenInfo, now = new Date()): number {
  if (!info.expiresAt) return Infinity;
  return (Date.parse(info.expiresAt) - now.getTime()) / 86_400_000;
}

/**
 * The refreshed token lives in Neon (kv "instagram_token"). Jobs also keep an encrypted copy in
 * their Actions cache so quiet runs needn't wake the database. The key derives from the
 * Facebook app secret, which fork pull-request workflows never receive.
 */
function key(secret: string): Buffer {
  return createHash("sha256").update(`live-show-radar:state:${secret}`).digest();
}

export function sealToken(info: TokenInfo, secret: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(secret), iv);
  const body = Buffer.concat([c.update(JSON.stringify(info), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64");
}

export function openToken(sealed: string, secret: string): TokenInfo | null {
  try {
    const raw = Buffer.from(sealed, "base64");
    const d = createDecipheriv("aes-256-gcm", key(secret), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    const json = Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
    const parsed = z.object({ token: z.string(), expiresAt: z.string().nullable() }).safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
