/**
 * Manage local secrets without pasting them anywhere else.
 *   pnpm secrets set GEMINI_API_KEY GROQ_API_KEY   prompt (hidden) and save to .env
 *   pnpm secrets generate                          fill the random secrets that are still empty
 *   pnpm secrets push                              copy the GitHub-side values from .env to GitHub secrets (gh CLI)
 *   pnpm secrets status                            which variables are set (names only)
 * Values are never printed.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const ENV = join(import.meta.dirname, "../.env");

/** Secrets the GitHub Actions jobs need (README → "Where every secret goes"). */
const GITHUB_SECRETS = [
  "DATABASE_URL",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_ALERT_CHAT_ID",
  "TELEGRAM_TEST_CHAT_ID",
  "SPOTIFY_CLIENT_ID",
  "SPOTIFY_CLIENT_SECRET",
  "SPOTIFY_REFRESH_TOKEN",
  "FACEBOOK_APP_ID",
  "FACEBOOK_APP_SECRET",
  "INSTAGRAM_USER_ID",
  "INSTAGRAM_ACCESS_TOKEN",
  "SETLISTFM_API_KEY",
  "MUSICBRAINZ_CONTACT",
  // Deploy safety net (.github/workflows/deploy.yml).
  "VERCEL_DEPLOY_HOOK",
];
/** What the Vercel side (dashboard, webhook, calendar feed, email ingest) reads. */
const VERCEL_VARS = [
  "DATABASE_URL",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_ALERT_CHAT_ID",
  "TELEGRAM_TEST_CHAT_ID",
  "TELEGRAM_ALLOWED_CHAT_IDS",
  "TELEGRAM_WEBHOOK_SECRET",
  "SPOTIFY_CLIENT_ID",
  "SPOTIFY_CLIENT_SECRET",
  "SPOTIFY_REFRESH_TOKEN",
  "SETLISTFM_API_KEY",
  "MUSICBRAINZ_CONTACT",
  "GOOGLE_CALENDAR_ICS_URL",
  "CALENDAR_FEED_TOKEN",
  "INGEST_EMAIL_SECRET",
  "ALLOWED_EMAIL",
  "NEXTAUTH_SECRET",
  "NEXTAUTH_URL",
  "PUBLIC_BASE_URL",
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "RADAR_DRY_RUN",
];
const RANDOM = { TELEGRAM_WEBHOOK_SECRET: 32, CALENDAR_FEED_TOKEN: 32, INGEST_EMAIL_SECRET: 32, NEXTAUTH_SECRET: 32 } as const;

function readEnv(): Map<string, string> {
  const m = new Map<string, string>();
  if (!existsSync(ENV)) return m;
  for (const line of readFileSync(ENV, "utf8").split(/\r?\n/)) {
    const x = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (x) m.set(x[1]!, x[2]!.replace(/^(['"])(.*)\1$/, "$2"));
  }
  return m;
}

function writeEnv(updates: Record<string, string>): void {
  const lines = existsSync(ENV) ? readFileSync(ENV, "utf8").split(/\r?\n/) : [];
  const done = new Set<string>();
  const out = lines.map((line) => {
    const k = /^\s*([A-Z0-9_]+)\s*=/.exec(line)?.[1];
    if (k && k in updates) {
      done.add(k);
      return `${k}=${updates[k]}`;
    }
    return line;
  });
  for (const [k, v] of Object.entries(updates)) if (!done.has(k)) out.push(`${k}=${v}`);
  writeFileSync(ENV, out.join("\n").replace(/\n+$/, "") + "\n");
}

/**
 * Reads a line without echoing it. In raw mode Ctrl+V arrives as a control character instead of
 * pasting, so control characters are ignored (with a hint) and terminal escape sequences, such as
 * bracketed-paste markers, are stripped.
 */
function askHiddenOnce(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    let value = "";
    let hinted = false;
    const raw = stdin.isTTY;
    if (raw) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (input: string) => {
      const chunk = input.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.off("data", onData);
          if (raw) stdin.setRawMode(false);
          stdin.pause();
          process.stdout.write("\n");
          return resolve(value.trim());
        }
        if (ch === "\u0003") process.exit(130); // Ctrl-C
        if (ch === "\u007f" || ch === "\b") {
          if (value.length) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
        } else if (ch.charCodeAt(0) < 32) {
          if (!hinted) {
            process.stdout.write("\n  (Ctrl+V doesn't paste here: right-click to paste instead)\n" + prompt + "•".repeat(value.length));
            hinted = true;
          }
        } else {
          value += ch;
          process.stdout.write("•");
        }
      }
    };
    stdin.on("data", onData);
  });
}

/** Asks until the value looks like a real key (or is empty, meaning keep/skip). */
async function askHidden(prompt: string): Promise<string> {
  for (;;) {
    const v = await askHiddenOnce(prompt);
    if (!v || v.length >= 8) return v;
    console.log(`  That's only ${v.length} character(s), which doesn't look like a key. Try again (right-click to paste).`);
  }
}

const [cmd = "status", ...names] = process.argv.slice(2);
const env = readEnv();

/** The system clipboard's text, for `set NAME --clipboard` (no pasting into a terminal). */
function readClipboard(): string {
  const r =
    process.platform === "win32"
      ? spawnSync("powershell", ["-NoProfile", "-Command", "Get-Clipboard -Raw"], { encoding: "utf8" })
      : process.platform === "darwin"
        ? spawnSync("pbpaste", [], { encoding: "utf8" })
        : spawnSync("xclip", ["-selection", "clipboard", "-o"], { encoding: "utf8" });
  return (r.stdout ?? "").trim();
}

if (cmd === "set" && names.includes("--clipboard")) {
  const name = names.find((n) => n !== "--clipboard");
  const value = readClipboard();
  if (!name) {
    console.log("Usage: pnpm secrets set NAME --clipboard");
    process.exit(1);
  }
  if (value.length < 8 || /\s/.test(value)) {
    console.log(`The clipboard doesn't look like a key (${value.length} characters${/\s/.test(value) ? ", contains spaces or line breaks" : ""}). Copy just the key and try again.`);
    process.exit(1);
  }
  writeEnv({ [name]: value });
  console.log(`Saved ${name} from the clipboard (${value.length} characters).`);
} else if (cmd === "set") {
  if (!names.length) {
    console.log("Usage: pnpm secrets set NAME [NAME...]");
    process.exit(1);
  }
  const updates: Record<string, string> = {};
  for (const n of names) {
    const v = await askHidden(`${n}${env.get(n) ? " (already set; Enter to keep)" : ""}: `);
    if (v) updates[n] = v;
  }
  if (Object.keys(updates).length) writeEnv(updates);
  console.log(`Saved ${Object.keys(updates).length} value(s) to .env.`);
} else if (cmd === "generate") {
  const updates: Record<string, string> = {};
  for (const [k, bytes] of Object.entries(RANDOM)) if (!env.get(k)) updates[k] = randomBytes(bytes).toString("base64url");
  writeEnv(updates);
  console.log(Object.keys(updates).length ? `Generated: ${Object.keys(updates).join(", ")}` : "All random secrets already exist.");
} else if (cmd === "push-vercel") {
  // Uses the Vercel CLI's own login and the project linked in .vercel/project.json.
  const home = homedir();
  const authFile = [
    process.env.APPDATA && join(process.env.APPDATA, "com.vercel.cli/Data/auth.json"),
    join(home, "AppData/Roaming/com.vercel.cli/Data/auth.json"),
    join(home, ".local/share/com.vercel.cli/auth.json"),
    join(home, "Library/Application Support/com.vercel.cli/auth.json"),
  ].find((p): p is string => !!p && existsSync(p));
  const linkFile = join(import.meta.dirname, "../.vercel/project.json");
  if (!authFile) {
    console.log("No Vercel login found on this computer. Run `npx vercel login` first.");
    process.exit(1);
  }
  if (!existsSync(linkFile)) {
    console.log("This folder isn't linked to a Vercel project. Run `npx vercel link` first.");
    process.exit(1);
  }
  const token = (JSON.parse(readFileSync(authFile, "utf8")) as { token: string }).token;
  const { projectId, orgId } = JSON.parse(readFileSync(linkFile, "utf8")) as { projectId: string; orgId: string };
  const present = VERCEL_VARS.filter((k) => env.get(k));
  const body = present.map((key) => ({ key, value: env.get(key)!, type: "encrypted", target: ["production", "preview"] }));
  const res = await fetch(`https://api.vercel.com/v10/projects/${projectId}/env?upsert=true&teamId=${orgId}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.log(`✗ Vercel said HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    process.exit(1);
  }
  console.log(`✓ Saved ${present.length} variables to Vercel: ${present.join(", ")}`);
  const missing = VERCEL_VARS.filter((k) => !env.get(k));
  if (missing.length) console.log(`  Not set in .env yet (skipped): ${missing.join(", ")}`);
  console.log("  Redeploy for them to take effect (pushing to GitHub does that).");
} else if (cmd === "push") {
  const present = GITHUB_SECRETS.filter((k) => env.get(k));
  const missing = GITHUB_SECRETS.filter((k) => !env.get(k));
  for (const k of present) {
    const r = spawnSync("gh", ["secret", "set", k], { input: env.get(k), stdio: ["pipe", "ignore", "pipe"], encoding: "utf8" });
    console.log(r.status === 0 ? `✓ ${k}` : `✗ ${k}: ${r.stderr.trim().split("\n")[0]}`);
  }
  if (missing.length) console.log(`\nNot set in .env yet (skipped): ${missing.join(", ")}`);
} else {
  const all = [...new Set([...GITHUB_SECRETS, ...Object.keys(RANDOM), "TELEGRAM_ALLOWED_CHAT_IDS", "ALLOWED_EMAIL", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET", "GOOGLE_CALENDAR_ICS_URL", "PUBLIC_BASE_URL"])];
  for (const k of all) console.log(`${env.get(k) ? "✓" : "·"} ${k}`);
}
