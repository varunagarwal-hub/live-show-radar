import { decideByDeadline, DEADLINE_LABEL, type DeadlineInput } from "./deadline";
import { encodeCallback, esc, type InlineKeyboard } from "./telegram";
import { countdown, formatDateIST, formatWhenIST } from "./time";

export interface DigestShow extends DeadlineInput {
  id: number;
  artistName: string;
  city: string;
  venue: string | null;
  decision: string | null;
}

export interface DigestInput {
  upcoming: DigestShow[];
  misses: { id: number; artistName: string; city: string; date: string; likelyCause: string; suggestedHandle: string | null; evidenceUrl: string | null }[];
  health: { source: string; healthy: boolean; lastNonzeroAt: Date | null; lastError: string | null; consecutiveFailures: number }[];
  failures: { job: string; startedAt: Date; error: string | null }[];
  now: Date;
}

const SOURCE_NAMES: Record<string, string> = { instagram: "Instagram", district: "District", bookmyshow: "BookMyShow", skillbox: "SkillBox", news: "Google News", email: "Fan-app emails" };
const dayName = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "long" });

function sourceLine(h: DigestInput["health"][number], now: Date): string {
  const name = SOURCE_NAMES[h.source] ?? h.source;
  if (h.lastError?.startsWith("blocked")) return `${name} is blocked by bot protection (we don't get around it). Other sources are still running.`;
  if (h.consecutiveFailures > 0) return `${name} failed the last ${h.consecutiveFailures} runs: ${h.lastError?.slice(0, 120) ?? "unknown error"}`;
  if (h.lastNonzeroAt) {
    const days = (now.getTime() - h.lastNonzeroAt.getTime()) / 86_400_000;
    return `${name} has returned 0 listings since ${days < 7 ? dayName.format(h.lastNonzeroAt) : formatDateIST(h.lastNonzeroAt.toISOString().slice(0, 10))}.`;
  }
  return `${name} hasn't returned any listings yet.`;
}

/** Spec 4.12: the Sunday digest. Telegram HTML plus a keyboard of "Track @handle" buttons. */
export function formatDigest(d: DigestInput): { html: string; keyboard: InlineKeyboard } {
  const L: string[] = ["🗓 <b>Your Sunday gig digest</b>"];

  const going = d.upcoming.filter((s) => s.decision === "going");
  const other = d.upcoming.filter((s) => s.decision !== "going" && s.decision !== "pass" && s.decision !== "not_interested");
  L.push("", `<b>Next 60 days</b> (${d.upcoming.length} shows)`);
  if (!d.upcoming.length) L.push("Nothing announced yet. The radar checks every 30 minutes.");
  for (const s of going) L.push(`✅ ${s.date ? formatDateIST(s.date) : "TBA"} · ${esc(s.artistName)}, ${esc(s.city)}`);
  for (const s of other.slice(0, 15)) L.push(`• ${s.date ? formatDateIST(s.date) : "TBA"} · ${esc(s.artistName)}, ${esc(s.city)}${s.decision === "maybe" ? " (maybe)" : ""}`);
  if (other.length > 15) L.push(`…and ${other.length - 15} more on the dashboard`);

  const decide = d.upcoming
    .filter((s) => s.decision === "maybe")
    .map((s) => ({ s, dl: decideByDeadline(s, d.now) }))
    .sort((a, b) => (a.dl?.at.getTime() ?? Infinity) - (b.dl?.at.getTime() ?? Infinity));
  L.push("", "<b>Decide by</b>");
  if (!decide.length) L.push("Nothing to decide.");
  for (const { s, dl } of decide) {
    L.push(`• ${esc(s.artistName)}, ${esc(s.city)}: ${dl ? `${DEADLINE_LABEL[dl.kind].toLowerCase()} ${formatWhenIST(dl.at, d.now)} (${countdown(dl.at, d.now)})` : "no deadline yet"}`);
  }

  const keyboard: InlineKeyboard = [];
  L.push("", "<b>Shows you might have missed</b>");
  if (!d.misses.length) L.push("None this week. 🎉");
  for (const m of d.misses) {
    L.push(`• ${esc(m.artistName)} played ${esc(m.city)} on ${formatDateIST(m.date)}${m.evidenceUrl ? ` (<a href="${esc(m.evidenceUrl)}">evidence</a>)` : ""}. Likely cause: ${esc(m.likelyCause)}.`);
    if (m.suggestedHandle && keyboard.length < 6) keyboard.push([{ text: `Track @${m.suggestedHandle}`, callback_data: encodeCallback({ kind: "track", missId: m.id }) }]);
  }

  const bad = d.health.filter((h) => !h.healthy && !h.source.endsWith(":notes"));
  L.push("", "<b>Source health</b>");
  L.push(bad.length ? bad.map((h) => `⚠️ ${esc(sourceLine(h, d.now))}`).join("\n") : "All sources healthy.");

  L.push("", "<b>Job failures this week</b>");
  if (!d.failures.length) L.push("None.");
  const byJob = new Map<string, number>();
  for (const f of d.failures) byJob.set(f.job, (byJob.get(f.job) ?? 0) + 1);
  for (const [job, n] of byJob) {
    const last = d.failures.find((f) => f.job === job)!;
    L.push(`• ${esc(job)}: ${n} failed run${n > 1 ? "s" : ""}, last: ${esc((last.error ?? "").slice(0, 100))}`);
  }
  return { html: L.join("\n").slice(0, 4000), keyboard };
}
