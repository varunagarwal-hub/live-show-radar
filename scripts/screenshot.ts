/**
 * Screenshots the dashboard for docs/DESIGN.md with real device emulation (headless Chrome's
 * window can't go below ~500px, so `--screenshot` can't do phone widths).
 *   pnpm dev   (with DEV_AUTH_BYPASS=1 in apps/web/.env.local)
 *   pnpm screenshots [baseUrl]
 * Uses the Chrome DevTools Protocol over Node's built-in WebSocket; no extra dependencies.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.argv[2] ?? "http://localhost:3000";
const out = join(import.meta.dirname, "../docs/screenshots");
const CHROME =
  process.env.CHROME_PATH ??
  ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(existsSync);
if (!CHROME) throw new Error("Chrome not found; set CHROME_PATH");

const port = 9333;
const proc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "radar-shot-"))}`, "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let wsUrl = "";
for (let i = 0; i < 50 && !wsUrl; i++) {
  await sleep(200);
  wsUrl = await fetch(`http://127.0.0.1:${port}/json/list`)
    .then((r) => r.json() as Promise<{ type: string; webSocketDebuggerUrl: string }[]>)
    .then((l) => l.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? "")
    .catch(() => "");
}
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0;
const pending = new Map<number, (v: unknown) => void>();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(String(e.data)) as { id?: number; result?: unknown };
  if (m.id && pending.has(m.id)) pending.get(m.id)!(m.result);
});
const send = <T = unknown>(method: string, params: object = {}) =>
  new Promise<T>((resolve) => {
    const id = ++seq;
    pending.set(id, resolve as (v: unknown) => void);
    ws.send(JSON.stringify({ id, method, params }));
  });

const shots = [
  { name: "home-mobile", path: "/", width: 390, height: 844, mobile: true, scheme: "light" },
  { name: "home-mobile-dark", path: "/", width: 390, height: 844, mobile: true, scheme: "dark" },
  { name: "home-desktop", path: "/", width: 1536, height: 900, mobile: false, scheme: "light" },
  { name: "home-desktop-dark", path: "/", width: 1536, height: 900, mobile: false, scheme: "dark" },
  { name: "calendar-mobile", path: `/calendar?m=${new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 7)}`, width: 390, height: 844, mobile: true, scheme: "light" },
  { name: "calendar-desktop", path: `/calendar?m=${new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 7)}`, width: 1536, height: 900, mobile: false, scheme: "light" },
  { name: "health-desktop", path: "/health", width: 1536, height: 900, mobile: false, scheme: "light" },
] as const;

for (const s of shots) {
  await send("Emulation.setDeviceMetricsOverride", { width: s.width, height: s.height, deviceScaleFactor: s.mobile ? 2 : 1, mobile: s.mobile });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: s.scheme }] });
  await send("Page.enable");
  await send("Page.navigate", { url: base + s.path });
  await sleep(4000);
  const { data } = await send<{ data: string }>("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(join(out, `${s.name}.png`), Buffer.from(data, "base64"));
  console.log(`saved docs/screenshots/${s.name}.png`);
}
ws.close();
proc.kill();
