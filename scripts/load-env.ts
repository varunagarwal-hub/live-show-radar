/** Loads a local, git-ignored .env for scripts run on your machine. CI and Vercel set env directly. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const file = join(import.meta.dirname, "../.env");
if (existsSync(file)) {
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || process.env[m[1]!] !== undefined) continue;
    process.env[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, "$2");
  }
}
