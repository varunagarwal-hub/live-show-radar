/**
 * Points the Telegram bot at the Vercel webhook, with the secret token Telegram will send back
 * in X-Telegram-Bot-Api-Secret-Token.  pnpm telegram:webhook
 * Needs TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and PUBLIC_BASE_URL in .env.
 */
import { requireEnv } from "@radar/config";
import { telegramClient } from "@radar/core";
import "./load-env";

const env = requireEnv(["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "PUBLIC_BASE_URL"]);
const tg = telegramClient(env.TELEGRAM_BOT_TOKEN);
const url = `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/api/telegram`;

await tg.call("setWebhook", {
  url,
  secret_token: env.TELEGRAM_WEBHOOK_SECRET,
  allowed_updates: ["message", "callback_query"],
  drop_pending_updates: true,
  max_connections: 5,
});
await tg.call("setMyCommands", {
  commands: [
    { command: "ask", description: "Ask about upcoming shows" },
    { command: "help", description: "What I can do" },
  ],
});
const info = (await tg.call("getWebhookInfo", {})) as { url: string; pending_update_count: number; last_error_message?: string };
console.log(`Webhook set to ${info.url}${info.last_error_message ? ` (last error: ${info.last_error_message})` : ""}`);
