import { z } from "zod";
import { fetchJson, fetchWithRetry } from "./http";
import type { TierJson } from "./db/schema";
import { decideByDeadline, DEADLINE_LABEL } from "./deadline";
import { URGENCY_EMOJI, type Urgency } from "./rules";
import { countdown, formatDateIST, formatWhenIST } from "./time";

export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}
export type InlineKeyboard = InlineButton[][];

export interface SendOptions {
  keyboard?: InlineKeyboard;
  replyTo?: number;
  silent?: boolean;
}

/** What jobs and the webhook need from Telegram. The real client and test fakes both implement it. */
export interface TelegramSink {
  sendMessage(chatId: string, html: string, opts?: SendOptions): Promise<{ messageId: number }>;
  sendDocument(chatId: string, filename: string, content: string, mime: string, caption?: string): Promise<{ messageId: number }>;
  answerCallback(callbackId: string, text?: string): Promise<void>;
  editKeyboard(chatId: string, messageId: number, keyboard: InlineKeyboard): Promise<void>;
}

const TgResponse = z.object({ ok: z.boolean(), result: z.unknown().optional(), description: z.string().optional() });
const TgMessage = z.object({ message_id: z.number() });

export function telegramClient(botToken: string): TelegramSink & { call(method: string, body: unknown): Promise<unknown> } {
  const base = `https://api.telegram.org/bot${botToken}`;
  async function call(method: string, body: unknown): Promise<unknown> {
    const raw = TgResponse.parse(
      await fetchJson(`${base}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), attempts: 3 }),
    );
    if (!raw.ok) throw new Error(`telegram ${method}: ${raw.description ?? "failed"}`);
    return raw.result;
  }
  return {
    call,
    async sendMessage(chatId, html, opts = {}) {
      const r = TgMessage.parse(
        await call("sendMessage", {
          chat_id: chatId,
          text: html.slice(0, 4096),
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
          disable_notification: opts.silent ?? false,
          reply_markup: opts.keyboard ? { inline_keyboard: opts.keyboard } : undefined,
          reply_parameters: opts.replyTo ? { message_id: opts.replyTo } : undefined,
        }),
      );
      return { messageId: r.message_id };
    },
    async sendDocument(chatId, filename, content, mime, caption) {
      const form = new FormData();
      form.append("chat_id", chatId);
      if (caption) form.append("caption", caption);
      form.append("document", new Blob([content], { type: mime }), filename);
      const res = await fetchWithRetry(`${base}/sendDocument`, { method: "POST", body: form, attempts: 2 });
      const parsed = TgResponse.parse(await res.json());
      if (!parsed.ok) throw new Error(`telegram sendDocument: ${parsed.description ?? "failed"}`);
      return { messageId: TgMessage.parse(parsed.result).message_id };
    },
    async answerCallback(callbackId, text) {
      await call("answerCallbackQuery", { callback_query_id: callbackId, text });
    },
    async editKeyboard(chatId, messageId, keyboard) {
      await call("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: keyboard } });
    },
  };
}

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const link = (href: string, label: string) => `<a href="${esc(href)}">${esc(label)}</a>`;

/** Allow-list check for incoming updates. */
export function parseAllowedChats(csv: string): Set<string> {
  return new Set(csv.split(",").map((s) => s.trim()).filter(Boolean));
}

/**
 * Where alerts go. In dry-run mode everything is redirected to the test chat, and the `alerts`
 * rows are marked dry_run so real alerts are still sent once dry-run is switched off.
 */
export function alertChat(env: { TELEGRAM_ALERT_CHAT_ID?: string; TELEGRAM_TEST_CHAT_ID?: string }, dryRun: boolean): string {
  const chat = dryRun ? env.TELEGRAM_TEST_CHAT_ID : env.TELEGRAM_ALERT_CHAT_ID;
  if (!chat) throw new Error(dryRun ? "Dry-run is on but TELEGRAM_TEST_CHAT_ID is not set" : "TELEGRAM_ALERT_CHAT_ID is not set");
  return chat;
}

// ---------- callback data (≤ 64 bytes) ----------

export type Callback =
  | { kind: "decide"; status: "going" | "maybe" | "not_interested" | "pass"; eventId: number }
  | { kind: "wrong_artist"; eventId: number }
  | { kind: "ics"; eventId: number }
  | { kind: "handle"; action: "ok" | "no"; artistId: number }
  | { kind: "track"; missId: number };

const DECIDE_CODES = { going: "g", maybe: "m", not_interested: "n", pass: "p" } as const;

export function encodeCallback(c: Callback): string {
  switch (c.kind) {
    case "decide":
      return `d:${DECIDE_CODES[c.status]}:${c.eventId}`;
    case "wrong_artist":
      return `w:${c.eventId}`;
    case "ics":
      return `c:${c.eventId}`;
    case "handle":
      return `h:${c.action}:${c.artistId}`;
    case "track":
      return `t:${c.missId}`;
  }
}

export function decodeCallback(data: string): Callback | null {
  const parts = data.split(":");
  const id = Number(parts.at(-1));
  if (!Number.isInteger(id) || id <= 0) return null;
  switch (parts[0]) {
    case "d": {
      const status = (Object.entries(DECIDE_CODES).find(([, v]) => v === parts[1])?.[0] ?? null) as keyof typeof DECIDE_CODES | null;
      return status ? { kind: "decide", status, eventId: id } : null;
    }
    case "w":
      return { kind: "wrong_artist", eventId: id };
    case "c":
      return { kind: "ics", eventId: id };
    case "h":
      return parts[1] === "ok" || parts[1] === "no" ? { kind: "handle", action: parts[1], artistId: id } : null;
    case "t":
      return { kind: "track", missId: id };
    default:
      return null;
  }
}

export function eventKeyboard(eventId: number, opts: { compact?: boolean } = {}): InlineKeyboard {
  const going = { text: "Going", callback_data: encodeCallback({ kind: "decide", status: "going", eventId }) };
  const maybe = { text: "Maybe", callback_data: encodeCallback({ kind: "decide", status: "maybe", eventId }) };
  if (opts.compact) return [[going, maybe]];
  return [
    [going, maybe, { text: "Not interested", callback_data: encodeCallback({ kind: "decide", status: "not_interested", eventId }) }],
    [
      { text: "Wrong artist", callback_data: encodeCallback({ kind: "wrong_artist", eventId }) },
      { text: "Add to calendar", callback_data: encodeCallback({ kind: "ics", eventId }) },
    ],
  ];
}

// ---------- message formatting ----------

export interface AlertEvent {
  id: number;
  artistName: string;
  priorityTier: "A" | "B" | "C";
  city: string;
  venue: string | null;
  date: string | null;
  endDate: string | null;
  tiers: TierJson[];
  earlyBirdStatus: "open" | "opening" | "sold_out" | "none" | "unknown";
  earlyBirdOpensAt: Date | null;
  earlyBirdClosesAt: Date | null;
  saleStartsAt: Date | null;
  ticketUrl: string | null;
  confidence: number;
  urgency: Urgency;
  handleUnconfirmed: boolean;
  sources: { source: string; url: string | null }[];
  /** Artist's Instagram bio link, shown when there is no direct ticket link. */
  bioUrl?: string | null;
}

/** A web search for the booking page: the fallback when no source gave a ticket link. */
export function ticketSearchUrl(artistName: string, city: string, date: string | null): string {
  const when = date ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`)) : "";
  return `https://www.google.com/search?q=${encodeURIComponent(`${artistName} ${city} ${when} tickets`.replace(/\s+/g, " ").trim())}`;
}

const LINK_PAGES = /(^|\.)(linktr\.ee|lnk\.to|bio\.link|beacons\.ai|hoo\.be|solo\.to|linkin\.bio|komi\.io|tap\.bio|campsite\.bio|later\.com|direct\.me|fanlink\.tv|ffm\.to)$/i;
const TICKETING = /(^|\.)(district\.in|bookmyshow\.com|skillboxes\.com|insider\.in|thumpn\.com|ticketmaster\.[a-z.]+|bandsintown\.com|songkick\.com|platinumlist\.net|zomato\.com|paytm\.com|townscript\.com|allevents\.in)$/i;

/** Only bio links that plausibly lead to tickets: link-in-bio pages, ticketing sites, tour pages. */
export function isBookingLikeUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return LINK_PAGES.test(u.hostname) || TICKETING.test(u.hostname) || /tour|ticket|shows|live|concert|gigs?\b/i.test(u.pathname + u.hostname);
  } catch {
    return false;
  }
}

/** "Open tickets", or the artist's link page plus a search when no direct link is known. */
export function bookingLines(e: Pick<AlertEvent, "ticketUrl" | "bioUrl" | "artistName" | "city" | "date">): string[] {
  if (e.ticketUrl) return [`🛒 ${link(e.ticketUrl, "Open tickets")}`];
  const lines: string[] = [];
  if (isBookingLikeUrl(e.bioUrl)) lines.push(`🛒 ${link(e.bioUrl!, "Artist's links")} (booking links are usually here)`);
  lines.push(`🔎 ${link(ticketSearchUrl(e.artistName, e.city, e.date), "Find tickets")}`);
  return lines;
}

const TIER_STATUS: Record<TierJson["status"], string> = { open: "on sale", upcoming: "not yet", sold_out: "sold out", unknown: "" };
const EB_STATUS: Record<AlertEvent["earlyBirdStatus"], string> = {
  open: "Early-bird is on sale",
  opening: "Early-bird opens soon",
  sold_out: "Early-bird sold out",
  none: "No early-bird",
  unknown: "Early-bird: not announced",
};

export function formatPrice(n: number | null): string {
  if (n === null) return "price TBA";
  if (n === 0) return "free";
  return `₹${n.toLocaleString("en-IN")}`;
}

function dateLine(e: Pick<AlertEvent, "date" | "endDate">): string {
  if (!e.date) return "Date TBA";
  return e.endDate && e.endDate !== e.date ? `${formatDateIST(e.date)} – ${formatDateIST(e.endDate)}` : formatDateIST(e.date);
}

/** The ticket-state lines shared by alerts, reminders and ask replies. */
export function ticketLines(e: AlertEvent, now = new Date()): string[] {
  const lines: string[] = [];
  if (e.tiers.length) {
    lines.push(
      "🎟 " +
        e.tiers
          .slice(0, 5)
          .map((t) => `${esc(t.name)} ${formatPrice(t.price_inr)}${TIER_STATUS[t.status] ? ` (${TIER_STATUS[t.status]})` : ""}`)
          .join(" · "),
    );
  }
  let eb = EB_STATUS[e.earlyBirdStatus];
  if (e.earlyBirdStatus === "open" && e.earlyBirdClosesAt && e.earlyBirdClosesAt > now) {
    eb = `Early-bird ends ${formatWhenIST(e.earlyBirdClosesAt, now)}, ${countdown(e.earlyBirdClosesAt, now)}`;
  } else if (e.earlyBirdStatus === "opening" && e.earlyBirdOpensAt && e.earlyBirdOpensAt > now) {
    eb = `Early-bird opens ${formatWhenIST(e.earlyBirdOpensAt, now)}, ${countdown(e.earlyBirdOpensAt, now).replace(" left", " to go")}`;
  }
  lines.push(`⏳ ${eb}`);
  if (e.saleStartsAt && e.saleStartsAt > now) {
    lines.push(`🕒 Tickets go on sale ${formatWhenIST(e.saleStartsAt, now)} (${countdown(e.saleStartsAt, now).replace(" left", " to go")})`);
  }
  return lines;
}

export function formatAlert(e: AlertEvent, now = new Date()): string {
  const head =
    e.urgency === "possible"
      ? `${URGENCY_EMOJI.possible} <b>Possible show, please check</b>: ${esc(e.artistName)}`
      : `${URGENCY_EMOJI[e.urgency]} <b>${esc(e.artistName)}</b> · tier ${e.priorityTier}`;
  const lines = [head, `📍 ${e.venue ? `${esc(e.venue)}, ` : ""}${esc(e.city)}`, `📅 ${dateLine(e)}`, ...ticketLines(e, now)];
  lines.push(...bookingLines(e));
  const srcs = e.sources.filter((s) => s.url);
  if (srcs.length) lines.push(`🔗 ${srcs.slice(0, 4).map((s) => link(s.url!, s.source)).join(" · ")}`);
  if (e.confidence < 0.9) lines.push(`Confidence ${e.confidence.toFixed(2)}`);
  if (e.handleUnconfirmed) lines.push("⚠️ Found via an Instagram handle you haven't confirmed yet");
  return lines.join("\n");
}

export type ReminderKind = "sale_reminder" | "early_bird_reminder" | "decide_reminder";

export function formatReminder(kind: ReminderKind, e: AlertEvent, now = new Date()): string {
  const deadline = decideByDeadline(e, now);
  const head =
    kind === "decide_reminder"
      ? `⏰ <b>Decide on ${esc(e.artistName)}</b>${deadline ? `: ${DEADLINE_LABEL[deadline.kind].toLowerCase()} ${formatWhenIST(deadline.at, now)}, ${countdown(deadline.at, now)}` : ""}`
      : kind === "early_bird_reminder"
        ? `⏰ <b>Early-bird for ${esc(e.artistName)} opens ${e.earlyBirdOpensAt ? formatWhenIST(e.earlyBirdOpensAt, now) : "soon"}</b>`
        : `⏰ <b>Tickets for ${esc(e.artistName)} go on sale ${e.saleStartsAt ? formatWhenIST(e.saleStartsAt, now) : "soon"}</b>`;
  const lines = [head, `📍 ${e.venue ? `${esc(e.venue)}, ` : ""}${esc(e.city)} · ${dateLine(e)}`, ...ticketLines(e, now), ...bookingLines(e)];
  return lines.join("\n");
}
