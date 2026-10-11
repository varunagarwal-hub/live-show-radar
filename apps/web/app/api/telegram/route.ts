import { after, NextResponse } from "next/server";
import { radarConfig } from "@radar/config";
import { handleUpdate, llmFromEnv, parseAllowedChats, telegramClient } from "@radar/core";
import { getDb } from "@/lib/db";
import { ensurePlaylistForEvent } from "@/lib/playlist";
import { secretMatches } from "@/lib/secrets";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Telegram webhook. Requests must carry the secret token we registered with setWebhook
 * (X-Telegram-Bot-Api-Secret-Token); chats outside TELEGRAM_ALLOWED_CHAT_IDS are ignored.
 * Always answers 200 for authenticated requests so Telegram doesn't retry a bad update forever.
 */
export async function POST(req: Request) {
  if (!secretMatches(req.headers.get("x-telegram-bot-api-secret-token"), process.env.TELEGRAM_WEBHOOK_SECRET)) {
    return new NextResponse("unauthorized", { status: 401 });
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return new NextResponse("not configured", { status: 503 });
  let update: unknown;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ ok: true });
  }
  const allowed = parseAllowedChats(process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? "");
  if (radarConfig.dryRun && process.env.TELEGRAM_TEST_CHAT_ID) allowed.add(process.env.TELEGRAM_TEST_CHAT_ID);
  try {
    await handleUpdate(update, {
      h: await getDb(),
      tg: telegramClient(token),
      allowedChats: allowed,
      llm: () => llmFromEnv(process.env),
      onGoing: async (eventId) => after(() => ensurePlaylistForEvent(eventId).catch((e) => console.error(`playlist ${eventId}: ${(e as Error).message}`))),
      log: (m) => console.log(m),
    });
  } catch (err) {
    // Log the message only: updates can contain personal text.
    console.error(`telegram update failed: ${(err as Error).message}`);
  }
  return NextResponse.json({ ok: true });
}
