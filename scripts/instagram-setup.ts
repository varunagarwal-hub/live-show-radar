/**
 * One-time Instagram setup (README → Instagram, steps 4–6).
 *   1. Graph API Explorer → generate a user token with instagram_basic, instagram_manage_insights, pages_show_list,
 *      pages_read_engagement, business_management → copy it.
 *   2. pnpm instagram:setup
 * Reads the short-lived token from the clipboard (or $SHORT_LIVED_TOKEN), exchanges it for a
 * ~60-day token server-side, finds the Instagram account linked to your Page, and saves
 * INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_USER_ID to .env. No token is ever printed.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { requireEnv } from "@radar/config";
import { fetchJson, HttpError } from "@radar/core";
import { exchangeToken, inspectToken } from "@radar/sources";
import "./load-env";

const ENV_FILE = join(import.meta.dirname, "../.env");
const env = requireEnv(["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET", "GRAPH_API_VERSION"]);
const v = env.GRAPH_API_VERSION;

function clipboard(): string {
  const r = process.platform === "win32" ? spawnSync("powershell", ["-NoProfile", "-Command", "Get-Clipboard -Raw"], { encoding: "utf8" }) : spawnSync("pbpaste", [], { encoding: "utf8" });
  return (r.stdout ?? "").trim();
}

function save(updates: Record<string, string>) {
  let t = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  for (const [k, val] of Object.entries(updates)) {
    const re = new RegExp(`^${k}=.*$`, "m");
    t = re.test(t) ? t.replace(re, `${k}=${val}`) : `${t.replace(/\n*$/, "\n")}${k}=${val}\n`;
  }
  writeFileSync(ENV_FILE, t);
}

const short = (process.env.SHORT_LIVED_TOKEN || clipboard()).replace(/\s+/g, "");
if (!/^EA[A-Za-z0-9]{50,}$/.test(short)) {
  console.log(`The clipboard doesn't look like a Meta access token (they start with "EA" and are long; got ${short.length} characters). Copy the token from Graph API Explorer and run this again.`);
  process.exit(1);
}

try {
  const info = await inspectToken(short, env.FACEBOOK_APP_ID, env.FACEBOOK_APP_SECRET, v);
  if (!info.valid) throw new Error("Meta says this token isn't valid. Generate a new one in Graph API Explorer.");
  const long = await exchangeToken(short, env.FACEBOOK_APP_ID, env.FACEBOOK_APP_SECRET, v);

  const Accounts = z.object({
    data: z.array(z.object({ name: z.string(), instagram_business_account: z.object({ id: z.string(), username: z.string().optional() }).optional() })),
  });
  const pages = Accounts.parse(
    await fetchJson(`https://graph.facebook.com/${v}/me/accounts?fields=${encodeURIComponent("name,instagram_business_account{id,username}")}&access_token=${encodeURIComponent(long.token)}`, { attempts: 2 }),
  );
  const linked = pages.data.filter((p) => p.instagram_business_account);
  if (!pages.data.length) throw new Error("The token can't see any Facebook Pages. When generating it, make sure you ticked your Page in the approval dialog (and pages_show_list is in the permissions).");
  if (!linked.length) throw new Error(`Found Page(s) ${pages.data.map((p) => `"${p.name}"`).join(", ")} but no Instagram account linked to them. Check the Instagram ↔ Page connection, and that instagram_basic was granted.`);
  const ig = linked[0]!.instagram_business_account!;

  save({ INSTAGRAM_ACCESS_TOKEN: long.token, INSTAGRAM_USER_ID: ig.id });
  console.log(`✓ Linked Instagram @${ig.username ?? ig.id} via Page "${linked[0]!.name}".`);
  console.log(`✓ Long-lived token saved to .env (expires ${long.expiresAt ? long.expiresAt.slice(0, 10) : "never"}). The daily job refreshes it from now on.`);
  if (linked.length > 1) console.log(`  (More than one Page has Instagram linked; used the first. Others: ${linked.slice(1).map((p) => p.name).join(", ")}.)`);
} catch (err) {
  const msg = err instanceof HttpError ? err.body.replace(/\s+/g, " ").slice(0, 300) : (err as Error).message;
  console.log(`✗ ${msg}`);
  process.exitCode = 1;
}
