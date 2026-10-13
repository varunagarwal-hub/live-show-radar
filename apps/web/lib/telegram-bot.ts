import "server-only";

let username: string | null = null;

/** The bot's @username (for t.me connect links), looked up once per server instance. */
export async function botUsername(): Promise<string | null> {
  if (username) return username;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  try {
    const r = (await (await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(8000) })).json()) as { result?: { username?: string } };
    username = r.result?.username ?? null;
  } catch {
    return null;
  }
  return username;
}
