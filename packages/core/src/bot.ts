import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { radarConfig } from "@radar/config";
import type { DbHandle } from "./db/index";
import { artists, decisions, events, eventSources, feedback, misses, OWNER_USER_ID, users, watchedAccounts } from "./db/schema";
import { answerQuestion } from "./ask";
import { buildCalendar } from "./ics";
import type { Llm } from "./llm";
import { decodeCallback, esc, eventKeyboard, type InlineKeyboard, type TelegramSink } from "./telegram";

const Chat = z.object({ id: z.number() });
const Message = z.object({ message_id: z.number(), chat: Chat, text: z.string().optional() });
export const TelegramUpdate = z.object({
  update_id: z.number(),
  message: Message.optional(),
  callback_query: z
    .object({
      id: z.string(),
      data: z.string().optional(),
      message: Message.optional(),
    })
    .optional(),
});
export type TelegramUpdate = z.infer<typeof TelegramUpdate>;

export interface BotDeps {
  h: DbHandle;
  tg: TelegramSink;
  allowedChats: Set<string>;
  llm: () => Llm;
  /** Called after a "Going" decision (pre-show playlist). Runs after the reply is sent. */
  onGoing?: (eventId: number) => Promise<void>;
  now?: Date;
  log?: (m: string) => void;
}

const HELP =
  "I'm Early Access, your live show radar. I'll message you when an artist you follow announces a show in India.\n\n" +
  "Ask me anything about upcoming shows, for example:\n" +
  "• anything in Bengaluru in December under ₹2,000?\n" +
  "• what do I need to decide on this week?\n" +
  "• which shows am I going to next month?";

const DECISION_TEXT = { going: "Going", maybe: "Maybe", pass: "Pass", not_interested: "Not interested" } as const;

/** Marks the chosen button so both Telegram and the dashboard show the same decision. */
function markChosen(eventId: number, chosen: keyof typeof DECISION_TEXT): InlineKeyboard {
  return eventKeyboard(eventId).map((row) => row.map((b) => (b.text === DECISION_TEXT[chosen] ? { ...b, text: `✓ ${b.text}` } : b)));
}

/** Writes one person's decision (shared by Telegram buttons and the dashboard). */
export async function setDecision(
  h: DbHandle,
  eventId: number,
  status: keyof typeof DECISION_TEXT,
  via: "telegram" | "dashboard",
  now = new Date(),
  userId: number = OWNER_USER_ID,
): Promise<boolean> {
  const [ev] = await h.db.select({ id: events.id }).from(events).where(eq(events.id, eventId));
  if (!ev) return false;
  await h.db
    .insert(decisions)
    .values({ userId, eventId, status, via, decidedAt: now })
    .onConflictDoUpdate({ target: [decisions.userId, decisions.eventId], set: { status, via, decidedAt: now } });
  return true;
}

const WELCOME =
  "You're connected. I'm Early Access: when an artist you follow announces a show in India, I'll message you here, with tickets, early-bird deadlines and reminders.\n\n" +
  "Tap Going or Maybe on any alert, and ask me things like <i>anything in Mumbai next month?</i>";

/**
 * Handles one webhook update. Chats not on the allow-list are ignored entirely. Questions only
 * ever read (see ask.ts); buttons are the only way chat changes data.
 */
export async function handleUpdate(raw: unknown, d: BotDeps): Promise<"ignored" | "handled"> {
  const parsed = TelegramUpdate.safeParse(raw);
  if (!parsed.success) return "ignored";
  const u = parsed.data;
  const now = d.now ?? new Date();
  const chatId = String(u.callback_query?.message?.chat.id ?? u.message?.chat.id ?? "");
  if (!chatId) return "ignored";
  // Who is this? The owner's chats come from TELEGRAM_ALLOWED_CHAT_IDS; everyone else connected
  // their own chat with a one-time link (/start <code>) from their settings page.
  let userId: number | null = d.allowedChats.has(chatId) ? OWNER_USER_ID : null;
  if (userId === null) {
    const [member] = await d.h.db.select({ id: users.id }).from(users).where(eq(users.telegramChatId, chatId));
    userId = member?.id ?? null;
  }
  const startCode = u.message?.text?.match(/^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{8,64})\s*$/)?.[1];
  if (startCode && u.message?.chat.id && u.message.chat.id > 0) {
    const [linked] = await d.h.db
      .update(users)
      .set({ telegramChatId: chatId, telegramLinkToken: null })
      .where(eq(users.telegramLinkToken, startCode))
      .returning({ id: users.id });
    if (linked) {
      await d.tg.sendMessage(chatId, WELCOME);
      return "handled";
    }
  }
  if (userId === null) {
    // Unknown chat: never act on it.
    return "ignored";
  }
  const isOwner = userId === OWNER_USER_ID;

  if (u.callback_query) {
    const cq = u.callback_query;
    const cb = cq.data ? decodeCallback(cq.data) : null;
    if (!cb) {
      await d.tg.answerCallback(cq.id, "That button has expired.");
      return "handled";
    }
    switch (cb.kind) {
      case "decide": {
        const ok = await setDecision(d.h, cb.eventId, cb.status, "telegram", now, userId);
        await d.tg.answerCallback(cq.id, ok ? `Marked ${DECISION_TEXT[cb.status]}` : "That show is gone.");
        if (ok && cq.message) await d.tg.editKeyboard(chatId, cq.message.message_id, markChosen(cb.eventId, cb.status)).catch(() => {});
        if (ok && isOwner && cb.status === "going" && d.onGoing && radarConfig.features.playlists) await d.onGoing(cb.eventId).catch((e) => d.log?.(`playlist: ${(e as Error).message}`));
        return "handled";
      }
      case "wrong_artist": {
        const [ev] = await d.h.db.select().from(events).where(eq(events.id, cb.eventId));
        if (!ev) {
          await d.tg.answerCallback(cq.id, "That show is gone.");
          return "handled";
        }
        if (!isOwner) {
          // Only the owner curates matching; anyone else's report is kept for them to review.
          await d.h.db.insert(feedback).values({ eventId: ev.id, artistId: ev.artistId, kind: "wrong_artist", note: `from user ${userId}` });
          await d.tg.answerCallback(cq.id, "Thanks, I've passed that on.");
          return "handled";
        }
        const [a] = await d.h.db.select().from(artists).where(eq(artists.id, ev.artistId));
        const weight = Math.max(0.3, (a?.matchWeight ?? 1) * 0.7);
        await d.h.batch([
          d.h.db.insert(feedback).values({ eventId: ev.id, artistId: ev.artistId, kind: "wrong_artist" }),
          d.h.db.update(artists).set({ matchWeight: weight, updatedAt: now }).where(eq(artists.id, ev.artistId)),
          d.h.db.update(events).set({ status: "cancelled", updatedAt: now }).where(eq(events.id, ev.id)),
        ]);
        await d.tg.answerCallback(cq.id, "Thanks, I'll be stricter matching this artist.");
        return "handled";
      }
      case "ics": {
        const [row] = await d.h.db
          .select({ e: events, name: artists.name, decision: decisions.status })
          .from(events)
          .innerJoin(artists, eq(events.artistId, artists.id))
          .leftJoin(decisions, and(eq(decisions.eventId, events.id), eq(decisions.userId, userId)))
          .where(eq(events.id, cb.eventId));
        if (!row?.e.date) {
          await d.tg.answerCallback(cq.id, row ? "No date yet, so nothing to add." : "That show is gone.");
          return "handled";
        }
        const srcs = await d.h.db.select({ url: eventSources.url }).from(eventSources).where(eq(eventSources.eventId, row.e.id));
        const ics = buildCalendar(
          [{ ...row.e, artistName: row.name, sourceUrls: srcs.map((s) => s.url).filter((u): u is string => !!u), decision: row.decision === "maybe" ? "maybe" : "going" }],
          { name: row.name, now },
        );
        await d.tg.answerCallback(cq.id);
        await d.tg.sendDocument(chatId, `${row.name.replace(/[^\w]+/g, "-").toLowerCase()}-${row.e.date}.ics`, ics, "text/calendar", "Open this to add the show to your calendar.");
        return "handled";
      }
      case "handle": {
        if (!isOwner) {
          await d.tg.answerCallback(cq.id);
          return "handled";
        }
        const [a] = await d.h.db.select().from(artists).where(eq(artists.id, cb.artistId));
        if (!a) {
          await d.tg.answerCallback(cq.id, "That artist is gone.");
          return "handled";
        }
        if (cb.action === "ok") {
          await d.h.db.update(artists).set({ handleStatus: "confirmed", updatedAt: now }).where(eq(artists.id, a.id));
          await d.tg.answerCallback(cq.id, `Confirmed @${a.instagramHandle}`);
        } else {
          await d.h.db.update(artists).set({ instagramHandle: null, handleStatus: "none", updatedAt: now }).where(eq(artists.id, a.id));
          await d.tg.answerCallback(cq.id, "Removed. You can set the right handle on the Artists page.");
        }
        if (cq.message) await d.tg.editKeyboard(chatId, cq.message.message_id, []).catch(() => {});
        return "handled";
      }
      case "track": {
        if (!isOwner) {
          await d.tg.answerCallback(cq.id);
          return "handled";
        }
        const [m] = await d.h.db.select().from(misses).where(eq(misses.id, cb.missId));
        if (!m?.suggestedHandle) {
          await d.tg.answerCallback(cq.id, "Nothing to track for that one.");
          return "handled";
        }
        await d.h.db
          .insert(watchedAccounts)
          .values({ handle: m.suggestedHandle, kind: "promoter", city: m.city, active: true })
          .onConflictDoUpdate({ target: watchedAccounts.handle, set: { active: true } });
        await d.tg.answerCallback(cq.id, `Now watching @${m.suggestedHandle}`);
        return "handled";
      }
    }
  }

  const text = u.message?.text?.trim();
  if (!text) return "handled";
  if (/^\/(start|help)\b/.test(text)) {
    await d.tg.sendMessage(chatId, esc(HELP));
    return "handled";
  }
  const question = text.replace(/^\/ask(@\w+)?\s*/i, "").trim();
  if (!question) {
    await d.tg.sendMessage(chatId, "Ask me something like: <i>anything in Bengaluru in December under ₹2,000?</i>");
    return "handled";
  }
  if (!radarConfig.features.askAnything) {
    await d.tg.sendMessage(chatId, "Questions are switched off right now. The dashboard has everything.");
    return "handled";
  }
  const answer = await answerQuestion(d.h, d.llm(), question, now, userId);
  await d.tg.sendMessage(chatId, answer.html, { keyboard: answer.keyboard, replyTo: u.message?.message_id });
  return "handled";
}
