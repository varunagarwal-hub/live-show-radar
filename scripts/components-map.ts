/**
 * Draws docs/components-map.png: who does what, from trigger to output, for the system as built.
 * Deliberately kept to the main flow (10 lanes) so it reads at a glance.
 *   pnpm components-map
 * Edit the ROWS / BOXES / LINKS below and re-run; the PNG is rendered with headless Chrome.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Kind = "ai" | "data" | "plain" | "human";

const COLS = ["Actor", "Trigger", "Input", "Context", "Processing", "AI", "Output"] as const;
const COL_W = [200, 180, 180, 190, 210, 200, 210];
const X0 = 15;
const HEAD = 60;
const ROW_H = 112;
const colX = (c: number) => X0 + COL_W.slice(0, c).reduce((a, b) => a + b, 0);
const colMid = (c: number) => colX(c) + COL_W[c]! / 2;

const ROWS: [string, string][] = [
  ["Karan", "Fan, decision maker"],
  ["Scheduler", "GitHub Actions"],
  ["Sources", "Where shows appear"],
  ["Spotify", "Watchlist, playlists"],
  ["Neon", "Database"],
  ["Gemini", "AI reader (Groq backup)"],
  ["Rules", "Matching, urgency"],
  ["Tier watcher", "Ticket pages"],
  ["Telegram", "Alerts, bot"],
  ["Vercel", "Dashboard"],
];
const rowY = (r: number) => 15 + HEAD + r * ROW_H;
const rowMid = (r: number) => rowY(r) + ROW_H / 2;

const BW = 156;
const BH = 86;
interface Box {
  row: number;
  col: number;
  kind: Kind;
  text: string;
}
const BOXES: Box[] = [
  { row: 0, col: 1, kind: "plain", text: "Follows artists on Spotify" },
  { row: 0, col: 6, kind: "human", text: "Decides Going / Maybe, buys tickets" },
  { row: 1, col: 1, kind: "plain", text: "Runs jobs: posts every 30 min, tickets every 15 min" },
  { row: 2, col: 2, kind: "data", text: "Instagram, Google News, SkillBox, fan-app emails" },
  { row: 3, col: 3, kind: "data", text: "Follows + plays → priority tiers A/B/C" },
  { row: 3, col: 6, kind: "data", text: "Pre-show playlist from setlist.fm" },
  { row: 4, col: 4, kind: "plain", text: "Skips seen posts, stores every show" },
  { row: 5, col: 5, kind: "ai", text: "Reads post + poster → artist, city, date" },
  { row: 6, col: 4, kind: "data", text: "Matches your artists, sets urgency" },
  { row: 7, col: 4, kind: "data", text: "Checks early-birds, sends reminders" },
  { row: 8, col: 6, kind: "plain", text: "Alerts, reminders, ask the bot" },
  { row: 9, col: 6, kind: "plain", text: "Next up, Decide-by, calendar feed" },
];
const box = (row: number, col: number) => {
  const cx = colMid(col);
  const cy = rowMid(row);
  return { l: cx - BW / 2, r: cx + BW / 2, t: cy - BH / 2, b: cy + BH / 2, cx, cy };
};

/** Orthogonal links as point lists; a dot marks the start, an arrowhead the end (both = two-way). */
const B = box;
const LINKS: { pts: [number, number][]; both?: boolean }[] = [
  // Karan follows artists → Spotify watchlist.
  { pts: [[B(0, 1).r, B(0, 1).cy], [colX(3) + 30, B(0, 1).cy], [colX(3) + 30, B(3, 3).t]] },
  // Scheduler starts the polls…
  { pts: [[B(1, 1).r, B(1, 1).cy], [B(2, 2).cx, B(1, 1).cy], [B(2, 2).cx, B(2, 2).t]] },
  // …and the tier watcher.
  { pts: [[B(1, 1).r, B(1, 1).cy + 24], [colX(2) + 4, B(1, 1).cy + 24], [colX(2) + 4, B(7, 4).cy], [B(7, 4).l, B(7, 4).cy]] },
  // New posts → database.
  { pts: [[B(2, 2).r, B(2, 2).cy], [B(4, 4).cx, B(2, 2).cy], [B(4, 4).cx, B(4, 4).t]] },
  // Database → Gemini reads them → rules.
  { pts: [[B(4, 4).r, B(4, 4).cy], [B(5, 5).cx, B(4, 4).cy], [B(5, 5).cx, B(5, 5).t]] },
  { pts: [[B(5, 5).cx, B(5, 5).b], [B(5, 5).cx, B(6, 4).cy], [B(6, 4).r, B(6, 4).cy]] },
  // Spotify tiers feed the rules.
  { pts: [[B(3, 3).cx, B(3, 3).b], [B(3, 3).cx, B(6, 4).cy], [B(6, 4).l, B(6, 4).cy]] },
  // Matched shows → Telegram and the dashboard.
  { pts: [[B(6, 4).r, B(6, 4).cy - 26], [colX(6) + 8, B(6, 4).cy - 26], [colX(6) + 8, B(8, 6).cy], [B(8, 6).l, B(8, 6).cy]] },
  { pts: [[B(6, 4).r, B(6, 4).cy + 26], [colX(6) - 8, B(6, 4).cy + 26], [colX(6) - 8, B(9, 6).cy], [B(9, 6).l, B(9, 6).cy]] },
  // Ticket changes and reminders → Telegram.
  { pts: [[B(7, 4).cx, B(7, 4).b], [B(7, 4).cx, B(8, 6).cy + 20], [B(8, 6).l, B(8, 6).cy + 20]] },
  // Telegram and the dashboard reach Karan.
  { pts: [[B(8, 6).r, B(8, 6).cy], [B(8, 6).r + 24, B(8, 6).cy], [B(8, 6).r + 24, B(0, 6).cy], [B(0, 6).r, B(0, 6).cy]] },
  { pts: [[B(9, 6).r, B(9, 6).cy], [B(9, 6).r + 24, B(9, 6).cy], [B(9, 6).r + 24, B(8, 6).cy]] },
  // Going → pre-show playlist.
  { pts: [[B(0, 6).cx, B(0, 6).b], [B(3, 6).cx, B(3, 6).t]] },
];

const W = colX(COLS.length) + X0;
const GRID_H = HEAD + ROWS.length * ROW_H;
const H = 15 + GRID_H + 70;

const STYLE: Record<Kind, { fill: string; stroke: string; text: string; dash?: string }> = {
  ai: { fill: "#25206a", stroke: "#5a4fe0", text: "#c3bbff" },
  data: { fill: "#142f19", stroke: "#2f6e3b", text: "#4fd067" },
  plain: { fill: "#1b1b1b", stroke: "#5a5a5a", text: "#f2f2f2" },
  human: { fill: "#3b2206", stroke: "#c07812", text: "#f3a62a", dash: "5 4" },
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const path = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1,1 L9,5 L1,9" fill="none" stroke="#bdbdbd" stroke-width="1.6"/></marker>
</defs>
<rect width="${W}" height="${H}" fill="#121212"/>
<rect x="${X0}" y="15" width="${W - 2 * X0}" height="${GRID_H}" rx="14" fill="#171717" stroke="#3a3a3a"/>
${COLS.map((c, i) => `<text x="${colMid(i)}" y="${15 + 37}" fill="#e6e6e6" font-size="19" font-weight="600" text-anchor="middle">${c}</text>`).join("\n")}
<line x1="${X0}" y1="${15 + HEAD}" x2="${W - X0}" y2="${15 + HEAD}" stroke="#444" stroke-width="2"/>
${COLS.slice(1).map((_, i) => `<line x1="${colX(i + 1)}" y1="15" x2="${colX(i + 1)}" y2="${15 + GRID_H}" stroke="#2c2c2c"/>`).join("\n")}
${ROWS.map((_, r) => (r ? `<line x1="${X0}" y1="${rowY(r)}" x2="${W - X0}" y2="${rowY(r)}" stroke="#2c2c2c"/>` : "")).join("\n")}
<rect x="${colX(6)}" y="${rowY(0)}" width="${COL_W[6]}" height="${ROW_H}" fill="#2a1a07"/>
${ROWS.map(([n, s], r) => `<foreignObject x="${X0 + 10}" y="${rowY(r)}" width="${COL_W[0]! - 14}" height="${ROW_H}"><div xmlns="http://www.w3.org/1999/xhtml" class="actor"><b>${esc(n)}</b><span>${esc(s)}</span></div></foreignObject>`).join("\n")}
${LINKS.map((l) => `<path d="${path(l.pts)}" fill="none" stroke="#9c9c9c" stroke-width="1.6" stroke-dasharray="5 4" marker-end="url(#arr)"${l.both ? ' marker-start="url(#arr)"' : ""}/>${l.both ? "" : `<circle cx="${l.pts[0]![0]}" cy="${l.pts[0]![1]}" r="4.5" fill="#2fbf7f"/>`}`).join("\n")}
${BOXES.map((b) => {
  const g = box(b.row, b.col);
  const s = STYLE[b.kind];
  return `<rect x="${g.l}" y="${g.t}" width="${BW}" height="${BH}" rx="9" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.6"${s.dash ? ` stroke-dasharray="${s.dash}"` : ""}/><foreignObject x="${g.l}" y="${g.t}" width="${BW}" height="${BH}"><div xmlns="http://www.w3.org/1999/xhtml" class="box" style="color:${s.text}">${esc(b.text)}</div></foreignObject>`;
}).join("\n")}
${(
  [
    ["ai", "AI"],
    ["data", "Rules, data and APIs"],
    ["plain", "Person, channel or storage"],
    ["human", "Human decision gate"],
  ] as [Kind, string][]
)
  .map(([k, label], i) => {
    const x = X0 + 4 + [0, 110, 370, 680][i]!;
    const s = STYLE[k];
    return `<rect x="${x}" y="${15 + GRID_H + 26}" width="22" height="22" rx="4" fill="${s.fill}" stroke="${s.stroke}"${s.dash ? ` stroke-dasharray="3 3"` : ""}/><text x="${x + 32}" y="${15 + GRID_H + 43}" fill="#d8d8d8" font-size="18">${label}</text>`;
  })
  .join("\n")}
<text x="${W - X0}" y="${15 + GRID_H + 43}" fill="#7a7a7a" font-size="15" text-anchor="end">Early Access · live show radar · Oct 2026</text>
</svg>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#121212;font-family:"Segoe UI",system-ui,sans-serif}
.actor{height:100%;display:flex;flex-direction:column;justify-content:center;gap:4px}
.actor b{color:#fff;font-size:18px}.actor span{color:#9a9a9a;font-size:15px;line-height:1.3}
.box{height:100%;display:flex;align-items:center;justify-content:center;text-align:center;padding:6px 9px;box-sizing:border-box;font-size:15px;line-height:1.3}
</style></head><body>${svg}</body></html>`;

const outDir = join(import.meta.dirname, "../docs");
const work = mkdtempSync(join(tmpdir(), "components-map-"));
const htmlFile = join(work, "map.html");
writeFileSync(htmlFile, html);

const chrome =
  process.env.CHROME_PATH ??
  ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome"].find(existsSync);
if (!chrome) throw new Error("Chrome not found; set CHROME_PATH");
const out = join(outDir, "components-map.png");
const r = spawnSync(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--user-data-dir=${join(work, "profile")}`, "--force-device-scale-factor=2", `--window-size=${W},${H}`, `--screenshot=${out}`, `file:///${htmlFile.replace(/\\/g, "/")}`], { encoding: "utf8" });
if (r.status !== 0) throw new Error(r.stderr);
console.log(`wrote ${out} (${W}×${H} @2x)`);
