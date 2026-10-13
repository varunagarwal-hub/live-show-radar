import "server-only";
import { scryptSync, timingSafeEqual } from "node:crypto";
import { kvGet, kvSet } from "@radar/core/db/queries";
import { getDb } from "./db";

/**
 * Username-and-password sign-in into the owner's dashboard (for reviewers who can't use the
 * owner's Google account). Off unless LOGIN_USERNAME and LOGIN_PASSWORD_HASH are set. The password
 * is stored only as an scrypt hash ("scrypt$<salt>$<hash>", from `pnpm secrets login`), and after
 * 8 wrong tries in 15 minutes sign-in is locked for 15 minutes.
 */
const WINDOW_MS = 15 * 60_000;
const MAX_FAILS = 8;

export const passwordLoginEnabled = () => Boolean(process.env.LOGIN_USERNAME && process.env.LOGIN_PASSWORD_HASH);

function hashMatches(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = scryptSync(password, Buffer.from(salt, "base64url"), expected.length);
  return timingSafeEqual(actual, expected);
}

type Fails = { count: number; since: number };

/** True when the username and password match. Counts failures and enforces the lockout. */
export async function checkPasswordLogin(username: string, password: string): Promise<boolean> {
  if (!passwordLoginEnabled()) return false;
  const h = await getDb();
  const now = Date.now();
  const fails = (await kvGet<Fails>(h, "login_fails")) ?? { count: 0, since: now };
  const fresh = now - fails.since > WINDOW_MS ? { count: 0, since: now } : fails;
  if (fresh.count >= MAX_FAILS) return false;
  const userOk = username.trim().toLowerCase() === process.env.LOGIN_USERNAME!.trim().toLowerCase();
  // Always run the hash so a wrong username takes as long as a wrong password.
  const passOk = hashMatches(password.slice(0, 200), process.env.LOGIN_PASSWORD_HASH!);
  if (userOk && passOk) {
    if (fresh.count) await kvSet(h, "login_fails", { count: 0, since: now });
    return true;
  }
  await kvSet(h, "login_fails", { count: fresh.count + 1, since: fresh.since });
  return false;
}
