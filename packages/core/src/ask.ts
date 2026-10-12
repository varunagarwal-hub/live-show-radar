import { and, asc, eq, gte, inArray, isNull, lte, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { z } from "zod";
import { radarConfig } from "@radar/config";
import type { DbHandle } from "./db/index";
import { artists, decisions, events } from "./db/schema";
import type { TierJson } from "./db/schema";
import type { Llm } from "./llm";
import { decideByDeadline, DEADLINE_LABEL } from "./deadline";
import { formatDateIST, formatWhenIST, countdown, istDate } from "./time";
import { esc, eventKeyboard, formatPrice, type InlineKeyboard } from "./telegram";

/**
 * Ask-it-anything (spec 4.9): the LLM turns a question into this filter object. It never writes
 * SQL; the server builds a parameterized query from the filter and runs it read-only.
 */
export const AskFilterSchema = z.object({
  cities: z.array(z.string()).default([]),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  max_price_inr: z.coerce.number().positive().nullable().default(null),
  artists: z.array(z.string()).default([]),
  priority_tiers: z.array(z.enum(["A", "B", "C"])).default([]),
  /** "undecided" = no decision yet. */
  decision_status: z.array(z.enum(["going", "maybe", "pass", "not_interested", "undecided"])).default([]),
  early_bird_status: z.array(z.enum(["open", "opening", "sold_out", "none", "unknown"])).default([]),
  /** Only shows whose decide-by deadline (early-bird close / sale start) falls within N days. */
  deadline_within_days: z.coerce.number().int().positive().max(366).nullable().default(null),
  /** "sale" when the question is about when tickets go on sale. */
  focus: z.enum(["shows", "sale", "deadline"]).catch("shows").default("shows"),
  sort: z.enum(["date", "deadline", "price"]).catch("date").default("date"),
  limit: z.coerce.number().int().min(1).max(20).catch(10).default(10),
});
export type AskFilter = z.infer<typeof AskFilterSchema>;

export function askSystemPrompt(now: Date, artistNames: string[]): string {
  return `You convert a question about upcoming live shows into a JSON filter. Never write SQL.
Today (IST) is ${istDate(now)}. Known cities: ${radarConfig.cities.map((c) => c.name).join(", ")}. Watched artists include: ${artistNames.slice(0, 150).join(", ")}.
Return exactly:
{"cities": string[], "date_from": "YYYY-MM-DD"|null, "date_to": "YYYY-MM-DD"|null, "max_price_inr": number|null, "artists": string[], "priority_tiers": ("A"|"B"|"C")[], "decision_status": ("going"|"maybe"|"pass"|"not_interested"|"undecided")[], "early_bird_status": ("open"|"opening"|"sold_out"|"none"|"unknown")[], "deadline_within_days": number|null, "focus": "shows"|"sale"|"deadline", "sort": "date"|"deadline"|"price", "limit": number}
Rules: a month name means that whole month (the next occurrence, this year if not yet over). "this week" = today through 7 days. "next month" = the whole next calendar month.
"what do I need to decide" → decision_status ["maybe","undecided"], focus "deadline", sort "deadline", deadline_within_days from the timeframe.
"which shows am I going to" → decision_status ["going"]. "when does X go on sale" → artists [X], focus "sale".
Use canonical city names from the list. Leave a field empty or null when the question doesn't constrain it.`;
}

export async function questionToFilter(llm: Llm, question: string, artistNames: string[], now = new Date()): Promise<AskFilter> {
  const { data } = await llm.generateJson(
    { task: "ask-filter", system: askSystemPrompt(now, artistNames), user: `<<<QUESTION (from the user)\n${question.slice(0, 500)}\nQUESTION>>>`, temperature: 0 },
    AskFilterSchema,
  );
  return data;
}

/** Aliased column, so raw read-only rows come back keyed like AskRow. */
const col = (c: AnyColumn, name: string) => sql`${c}`.as(name);

/** Builds the parameterized SELECT for a filter. Values only ever travel as bind parameters. */
export function buildAskQuery(h: DbHandle, f: AskFilter, now = new Date()): { sql: string; params: unknown[] } {
  const today = istDate(now);
  const conds: (SQL | undefined)[] = [
    inArray(events.status, ["announced"]),
    eq(artists.muted, false),
    f.date_from ? gte(events.date, f.date_from) : or(gte(events.date, today), isNull(events.date)),
  ];
  if (f.date_to) conds.push(lte(events.date, f.date_to));
  if (f.cities.length) conds.push(inArray(sql`lower(${events.city})`, f.cities.map((c) => c.toLowerCase())));
  if (f.priority_tiers.length) conds.push(inArray(artists.priorityTier, f.priority_tiers));
  if (f.early_bird_status.length) conds.push(inArray(events.earlyBirdStatus, f.early_bird_status));
  if (f.artists.length) {
    const names = f.artists.map((a) => a.toLowerCase());
    conds.push(or(inArray(sql`lower(${artists.name})`, names), sql`exists (select 1 from unnest(${artists.aliases}) al where lower(al) = any(${sql.param(names)}::text[]))`));
  }
  if (f.max_price_inr !== null) {
    conds.push(sql`exists (select 1 from jsonb_array_elements(${events.tiers}) t where (t->>'price_inr') is not null and (t->>'price_inr')::numeric <= ${f.max_price_inr} and coalesce(t->>'status','unknown') <> 'sold_out')`);
  }
  if (f.decision_status.length) {
    const st = f.decision_status.filter((s) => s !== "undecided") as ("going" | "maybe" | "pass" | "not_interested")[];
    conds.push(or(st.length ? inArray(decisions.status, st) : undefined, f.decision_status.includes("undecided") ? isNull(decisions.status) : undefined));
  } else {
    // By default hide shows he said no to.
    conds.push(or(isNull(decisions.status), inArray(decisions.status, ["going", "maybe"])));
  }
  const q = h.db
    .select({
      id: col(events.id, "id"),
      artist_name: col(artists.name, "artist_name"),
      priority_tier: col(artists.priorityTier, "priority_tier"),
      city: col(events.city, "city"),
      venue: col(events.venue, "venue"),
      date: col(events.date, "date"),
      end_date: col(events.endDate, "end_date"),
      ticket_url: col(events.ticketUrl, "ticket_url"),
      tiers: col(events.tiers, "tiers"),
      early_bird_status: col(events.earlyBirdStatus, "early_bird_status"),
      early_bird_opens_at: col(events.earlyBirdOpensAt, "early_bird_opens_at"),
      early_bird_closes_at: col(events.earlyBirdClosesAt, "early_bird_closes_at"),
      sale_starts_at: col(events.saleStartsAt, "sale_starts_at"),
      decision: col(decisions.status, "decision"),
    })
    .from(events)
    .innerJoin(artists, eq(events.artistId, artists.id))
    .leftJoin(decisions, eq(decisions.eventId, events.id))
    .where(and(...conds))
    .orderBy(asc(events.date))
    .limit(100);
  const { sql: text, params } = q.toSQL();
  return { sql: text, params };
}

export interface AskRow {
  id: number;
  artist_name: string;
  priority_tier: "A" | "B" | "C";
  city: string;
  venue: string | null;
  date: string | null;
  end_date: string | null;
  ticket_url: string | null;
  tiers: TierJson[];
  early_bird_status: "open" | "opening" | "sold_out" | "none" | "unknown";
  early_bird_opens_at: Date | null;
  early_bird_closes_at: Date | null;
  sale_starts_at: Date | null;
  decision: string | null;
}

const toDate = (v: unknown): Date | null => (v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v)));
const toDateStr = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? istDate(v) : String(v).slice(0, 10));

/** Raw driver rows (strings for timestamps over HTTP) → typed rows. */
function normalizeRow(r: Record<string, unknown>): AskRow {
  return {
    ...(r as unknown as AskRow),
    id: Number(r.id),
    date: toDateStr(r.date),
    end_date: toDateStr(r.end_date),
    tiers: (typeof r.tiers === "string" ? JSON.parse(r.tiers) : r.tiers) as TierJson[],
    early_bird_opens_at: toDate(r.early_bird_opens_at),
    early_bird_closes_at: toDate(r.early_bird_closes_at),
    sale_starts_at: toDate(r.sale_starts_at),
  };
}

const rowDeadline = (r: AskRow, now: Date) =>
  decideByDeadline({ date: r.date, earlyBirdStatus: r.early_bird_status, earlyBirdOpensAt: r.early_bird_opens_at, earlyBirdClosesAt: r.early_bird_closes_at, saleStartsAt: r.sale_starts_at, tiers: r.tiers }, now);

const minPrice = (r: AskRow) => Math.min(...r.tiers.filter((t) => t.price_inr !== null && t.status !== "sold_out").map((t) => t.price_inr!), Infinity);

/** Runs the filter read-only, then applies the deadline window and sort (computed in code). */
export async function runAsk(h: DbHandle, f: AskFilter, now = new Date()): Promise<AskRow[]> {
  const q = buildAskQuery(h, f, now);
  let rows = (await h.readOnly<Record<string, unknown>>(q.sql, q.params)).map(normalizeRow);
  if (f.deadline_within_days !== null) {
    const until = now.getTime() + f.deadline_within_days * 86_400_000;
    rows = rows.filter((r) => {
      const d = rowDeadline(r, now);
      return d !== null && d.at.getTime() <= until;
    });
  }
  if (f.sort === "deadline") rows.sort((a, b) => (rowDeadline(a, now)?.at.getTime() ?? Infinity) - (rowDeadline(b, now)?.at.getTime() ?? Infinity));
  if (f.sort === "price") rows.sort((a, b) => minPrice(a) - minPrice(b));
  return rows.slice(0, f.limit);
}

/** One factual line per show; used as the LLM's only material and as the fallback reply. */
export function showLine(r: AskRow, now = new Date()): string {
  const when = r.date ? formatDateIST(r.date) : "date TBA";
  const open = r.tiers.filter((t) => t.status !== "sold_out");
  const price = open.length ? `${open[0]!.name} ${formatPrice(open[0]!.price_inr)}` : r.tiers.length ? "sold out" : "price TBA";
  const d = rowDeadline(r, now);
  const deadline = d ? ` · ${DEADLINE_LABEL[d.kind]} ${formatWhenIST(d.at, now)} (${countdown(d.at, now)})` : "";
  const decided = r.decision ? ` · you: ${r.decision.replace("_", " ")}` : "";
  return `${r.artist_name} — ${when}, ${r.venue ? `${r.venue}, ` : ""}${r.city} · ${price}${deadline}${decided}${r.ticket_url ? ` · ${r.ticket_url}` : ""}`;
}

const ReplySchema = z.object({ reply: z.string().min(1).max(3500) });

export interface AskAnswer {
  html: string;
  keyboard?: InlineKeyboard;
  rows: AskRow[];
  filter: AskFilter | null;
}

/** Full ask flow: question → filter (LLM) → read-only query → short reply (LLM, with fallback). */
export async function answerQuestion(h: DbHandle, llm: Llm, question: string, now = new Date()): Promise<AskAnswer> {
  const names = (await h.readOnly<{ name: string }>("select name from artists where muted = false order by priority_tier, name limit 200", [])).map((r) => r.name);
  let filter: AskFilter;
  try {
    filter = await questionToFilter(llm, question, names, now);
  } catch {
    return { html: "I couldn't work that question out right now. Try again in a minute, or open the dashboard.", rows: [], filter: null };
  }
  const rows = await runAsk(h, filter, now);
  if (!rows.length) {
    return { html: "Nothing matches that right now. The radar checks every 30 minutes, so ask again later or widen the dates.", rows, filter };
  }
  const lines = rows.map((r) => showLine(r, now));
  let body: string;
  try {
    const { data } = await llm.generateJson(
      {
        task: "ask-reply",
        system:
          'You are a friend who keeps track of gigs. Answer the question in a short, plain reply (sentence case, no marketing tone). Use ONLY the shows listed; list each one on its own line with its date, venue, price tier, early-bird or sale deadline, and link. If a show has no deadline or no link, simply leave that out: never write "none", "no link" or "not listed". No markdown, no HTML. Return JSON {"reply": string}.',
        user: `Question: ${question.slice(0, 500)}\n\nShows (from the database):\n${lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}`,
        temperature: 0.2,
      },
      ReplySchema,
    );
    body = esc(data.reply);
  } catch {
    body = lines.map((l) => `• ${esc(l)}`).join("\n");
  }
  const keyboard = rows.slice(0, 6).flatMap((r) => eventKeyboard(r.id, { compact: true }).map((row) => row.map((b) => ({ ...b, text: `${b.text}: ${r.artist_name.length > 26 ? `${r.artist_name.slice(0, 25)}…` : r.artist_name}` }))));
  return { html: body, keyboard, rows, filter };
}

