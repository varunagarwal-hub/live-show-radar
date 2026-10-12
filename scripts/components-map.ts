/**
 * Draws docs/components-map.png: a one-glance view of how Early Access works.
 *   pnpm components-map
 * Four steps left to right (where shows appear → the radar reads them → matched to your
 * artists → reaches you), with the background helpers underneath. Edit STEPS / HELPERS and re-run.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Kind = "ai" | "data" | "plain" | "human";
interface Card {
  kind: Kind;
  title: string;
  note: string;
}
interface Step {
  n: number;
  title: string;
  when: string;
  cards: Card[];
}

const STEPS: Step[] = [
  {
    n: 1,
    title: "Where shows appear",
    when: "announcements, listings, emails",
    cards: [
      { kind: "data", title: "Instagram", note: "Your artists + 30 promoter and venue pages" },
      { kind: "data", title: "Google News", note: "Tour and concert headlines" },
      { kind: "data", title: "SkillBox", note: "New event listings" },
      { kind: "data", title: "Fan-app emails", note: "Bandsintown + Songkick, via Gmail" },
    ],
  },
  {
    n: 2,
    title: "The radar reads them",
    when: "every 30 min · GitHub Actions",
    cards: [
      { kind: "plain", title: "Skips what it's seen", note: "Only new posts go further" },
      { kind: "ai", title: "Gemini reads each post", note: "Caption + poster → artist, city, date, early-bird" },
    ],
  },
  {
    n: 3,
    title: "Matched to your artists",
    when: "Spotify watchlist, synced every 6 h",
    cards: [
      { kind: "data", title: "Your Spotify artists", note: "Follows + plays → tiers A / B / C" },
      { kind: "data", title: "Urgency rules", note: "Tier A or Bengaluru early-bird = urgent" },
      { kind: "plain", title: "Saved in Neon", note: "One show, every source merged" },
    ],
  },
  {
    n: 4,
    title: "Reaches you",
    when: "within one 30-minute cycle",
    cards: [
      { kind: "plain", title: "Telegram", note: "Alerts, reminders, ask the bot" },
      { kind: "plain", title: "Dashboard", note: "Next up, Decide-by, tour dates, tickets" },
      { kind: "human", title: "You decide", note: "Going / Maybe / Pass, then buy" },
    ],
  },
];

const HELPERS: Card[] = [
  { kind: "data", title: "Tier watcher · 15 min", note: "Early-bird open or closing, sale starts, sold out" },
  { kind: "data", title: "Pre-show playlist", note: "setlist.fm songs → private Spotify playlist when you're Going" },
  { kind: "ai", title: "Sunday check", note: "Finds shows the radar missed, sends the weekly digest" },
  { kind: "data", title: "Calendar", note: "Clash warnings from Google Calendar + your .ics feed" },
];

const KIND_LABEL: [Kind, string][] = [
  ["ai", "AI"],
  ["data", "Rules, data and APIs"],
  ["plain", "Person, channel or storage"],
  ["human", "Your decision"],
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const card = (c: Card) => `<div class="card ${c.kind}"><b>${esc(c.title)}</b><span>${esc(c.note)}</span></div>`;

const W = 1600;
const H = 890;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
html,body{margin:0;width:${W}px;height:${H}px;background:#121212;color:#eee;font-family:"Segoe UI",system-ui,sans-serif}
.wrap{padding:38px 44px}
h1{margin:0;font-size:34px;font-weight:700;letter-spacing:.2px}
.sub{color:#9a9a9a;font-size:17px;margin:6px 0 30px}
.flow{display:grid;grid-template-columns:1fr 48px 1fr 48px 1fr 48px 1fr;align-items:start}
.step{background:#181818;border:1px solid #333;border-radius:16px;padding:18px 16px 16px;min-height:470px}
.step h2{margin:0;font-size:21px;display:flex;align-items:center;gap:10px}
.num{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:50%;background:#2fbf7f;color:#0d1d14;font-size:16px;font-weight:800}
.when{color:#8f8f8f;font-size:14.5px;margin:6px 0 16px 40px}
.arrow{align-self:center;justify-self:center;color:#7d7d7d;font-size:34px;margin-top:-40px}
.card{border-radius:11px;padding:12px 14px;margin-bottom:12px;border:1.6px solid}
.card b{display:block;font-size:17px;margin-bottom:3px}
.card span{display:block;font-size:14.5px;line-height:1.35;opacity:.9}
.ai{background:#25206a;border-color:#5a4fe0;color:#cdc6ff}
.data{background:#142f19;border-color:#2f6e3b;color:#62d77a}
.plain{background:#1f1f1f;border-color:#5a5a5a;color:#f2f2f2}
.human{background:#3b2206;border-color:#c07812;border-style:dashed;color:#f3a62a}
.loop{margin:-6px 0 0;color:#f3a62a;font-size:14.5px;text-align:right}
.helpers{margin-top:26px;background:#181818;border:1px solid #333;border-radius:16px;padding:16px 18px}
.helpers h3{margin:0 0 12px;font-size:18px;color:#cfcfcf}
.helpers .row{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.helpers .card{margin:0}
.legend{display:flex;gap:30px;align-items:center;margin-top:22px;color:#cfcfcf;font-size:15.5px}
.legend i{display:inline-block;width:18px;height:18px;border-radius:4px;border:1.6px solid;vertical-align:-3px;margin-right:8px}
.legend .end{margin-left:auto;color:#6f6f6f;font-size:14px}
</style></head><body><div class="wrap">
<h1>Early Access: how it works</h1>
<p class="sub">Every show an artist you listen to announces in India, found and sent to you before the early-birds are gone.</p>
<div class="flow">
${STEPS.map(
  (s, i) =>
    `<section class="step"><h2><span class="num">${s.n}</span>${esc(s.title)}</h2><p class="when">${esc(s.when)}</p>${s.cards.map(card).join("")}${
      s.n === 4 ? `<p class="loop">↺ your choices feed playlists, reminders and the calendar</p>` : ""
    }</section>${i < STEPS.length - 1 ? `<div class="arrow">➜</div>` : ""}`,
).join("\n")}
</div>
<section class="helpers"><h3>Also running in the background</h3><div class="row">${HELPERS.map(card).join("")}</div></section>
<div class="legend">${KIND_LABEL.map(([k, l]) => `<span><i class="${k}"></i>${l}</span>`).join("")}<span class="end">Early Access · Oct 2026</span></div>
</div></body></html>`;

const outDir = join(import.meta.dirname, "../docs");
const work = mkdtempSync(join(tmpdir(), "components-map-"));
const htmlFile = join(work, "map.html");
writeFileSync(htmlFile, html);
writeFileSync(join(outDir, "components-map.html"), html);

const chrome =
  process.env.CHROME_PATH ??
  ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome"].find((p) => existsSync(p));
if (!chrome) throw new Error("Chrome not found; set CHROME_PATH");
const out = join(outDir, "components-map.png");
const r = spawnSync(
  chrome,
  ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--user-data-dir=${join(work, "profile")}`, "--force-device-scale-factor=2", `--window-size=${W},${H}`, `--screenshot=${out}`, `file:///${htmlFile.replace(/\\/g, "/")}`],
  { encoding: "utf8" },
);
if (r.status !== 0) throw new Error(r.stderr);
console.log(`wrote ${out} (${W}×${H} @2x)`);
