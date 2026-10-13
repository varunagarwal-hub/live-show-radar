import { and, eq } from "drizzle-orm";
import type { DbHandle } from "./db/index";
import { alerts } from "./db/schema";
import type { InlineKeyboard, TelegramSink } from "./telegram";

export interface SendOnceInput {
  dedupKey: string;
  kind: string;
  eventId: number | null;
  chatId: string;
  html: string;
  keyboard?: InlineKeyboard;
  silent?: boolean;
  photo?: string | null;
  dryRun: boolean;
}

/**
 * Claims the alert row first (unique on dedup_key + dry_run), then sends. If Telegram fails the
 * claim is released so the next run retries. A key can therefore be sent at most once, even when
 * GitHub runs two late cron jobs back to back.
 */
export async function sendOnce(h: DbHandle, tg: TelegramSink, a: SendOnceInput): Promise<"sent" | "duplicate"> {
  const claimed = await h.db
    .insert(alerts)
    .values({ eventId: a.eventId, kind: a.kind, dedupKey: a.dedupKey, dryRun: a.dryRun })
    .onConflictDoNothing()
    .returning({ id: alerts.id });
  const id = claimed[0]?.id;
  if (id === undefined) return "duplicate";
  try {
    const { messageId } = await tg.sendMessage(a.chatId, a.html, { keyboard: a.keyboard, silent: a.silent, photo: a.photo });
    await h.db.update(alerts).set({ telegramMessageId: messageId }).where(eq(alerts.id, id));
    return "sent";
  } catch (err) {
    await h.db.delete(alerts).where(and(eq(alerts.id, id), eq(alerts.dedupKey, a.dedupKey)));
    throw err;
  }
}

/** Snapshot keys are prefixed "dry:" for dry-run alerts so the two modes never mask each other. */
export const snapshotAlertKey = (dedupKey: string, dryRun: boolean) => `${dryRun ? "dry:" : ""}${dedupKey}`;
