/**
 * Tests each connected service with the keys in .env. Prints ✓/✗ and a hint, never a key.
 *   pnpm check            everything that's configured
 *   pnpm check telegram   just one service (telegram, gemini, groq, setlistfm, spotify, instagram, database)
 */
import "./load-env";
import { z } from "zod";
import { fetchJson, HttpError, refreshSpotifyToken, spotifyClient } from "@radar/core";

const only = process.argv[2]?.toLowerCase();
const env = process.env;
let failures = 0;

async function check(name: string, needs: string[], fn: () => Promise<string>) {
  if (only && !name.toLowerCase().startsWith(only)) return;
  const missing = needs.filter((k) => !env[k]);
  if (missing.length) {
    console.log(`·  ${name}: not set up yet (missing ${missing.join(", ")})`);
    return;
  }
  try {
    console.log(`✓  ${name}: ${await fn()}`);
  } catch (err) {
    failures++;
    const msg = err instanceof HttpError ? `HTTP ${err.status}: ${err.body.replace(/\s+/g, " ").slice(0, 160)}` : (err as Error).message.slice(0, 200);
    console.log(`✗  ${name}: ${msg}`);
  }
}

await check("Database (Neon)", ["DATABASE_URL"], async () => {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(env.DATABASE_URL!);
  const r = await sql`select count(*)::int as n from artists`;
  return `connected, ${r[0]?.n} artists`;
});

await check("Telegram", ["TELEGRAM_BOT_TOKEN"], async () => {
  const base = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;
  const me = z.object({ result: z.object({ username: z.string() }) }).parse(await fetchJson(`${base}/getMe`));
  const hook = z.object({ result: z.object({ url: z.string() }) }).parse(await fetchJson(`${base}/getWebhookInfo`));
  let chats = "";
  if (!hook.result.url) {
    // getUpdates only works while no webhook is set; that's exactly when you need chat IDs.
    const up = z
      .object({ result: z.array(z.object({ message: z.object({ chat: z.object({ id: z.number(), type: z.string(), title: z.string().optional(), first_name: z.string().optional() }) }).optional() })) })
      .parse(await fetchJson(`${base}/getUpdates`));
    const seen = new Map<number, string>();
    for (const u of up.result) if (u.message) seen.set(u.message.chat.id, `${u.message.chat.type} "${u.message.chat.title ?? u.message.chat.first_name ?? ""}"`);
    chats = seen.size
      ? `\n     Chats that messaged the bot:\n${[...seen].map(([id, d]) => `       ${id}  ${d}`).join("\n")}`
      : "\n     No chats yet: send your bot a message (and one in your test group), then run this again.";
  }
  const want = ["TELEGRAM_ALERT_CHAT_ID", "TELEGRAM_TEST_CHAT_ID", "TELEGRAM_ALLOWED_CHAT_IDS"].filter((k) => !env[k]);
  return `bot @${me.result.username}${hook.result.url ? `, webhook → ${hook.result.url}` : ""}${want.length ? `; still to set: ${want.join(", ")}` : ""}${chats}`;
});

await check("Gemini", ["GEMINI_API_KEY"], async () => {
  const model = env.GEMINI_MODEL || "gemini-3.8-flash";
  const r = z
    .object({ candidates: z.array(z.object({ content: z.object({ parts: z.array(z.object({ text: z.string().optional() })) }) })) })
    .parse(
      await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY! },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply with the JSON {"ok": true}' }] }], generationConfig: { responseMimeType: "application/json" } }),
        attempts: 1,
      }),
    );
  return `${model} answered (${(r.candidates[0]?.content.parts[0]?.text ?? "").trim().slice(0, 30)})`;
});

await check("Groq", ["GROQ_API_KEY"], async () => {
  const model = env.GROQ_MODEL || "openai/gpt-oss-120b";
  await fetchJson("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.GROQ_API_KEY}` },
    body: JSON.stringify({ model, messages: [{ role: "user", content: "Say ok" }], max_tokens: 5 }),
    attempts: 1,
  });
  return `${model} answered`;
});

await check("setlist.fm", ["SETLISTFM_API_KEY"], async () => {
  const r = z.object({ total: z.number() }).parse(
    await fetchJson("https://api.setlist.fm/rest/1.0/search/artists?artistName=Prateek%20Kuhad&p=1", { headers: { "x-api-key": env.SETLISTFM_API_KEY!, accept: "application/json" }, attempts: 1 }),
  );
  return `key works (${r.total} artist match for a test search)`;
});

await check("Spotify", ["SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET", "SPOTIFY_REFRESH_TOKEN"], async () => {
  const t = await refreshSpotifyToken(env.SPOTIFY_CLIENT_ID!, env.SPOTIFY_CLIENT_SECRET!, env.SPOTIFY_REFRESH_TOKEN!);
  const sp = spotifyClient(t.accessToken);
  const followed = await sp.followedArtists();
  const top = await sp.topArtists("short_term");
  return `${followed.length} followed artists; top artists ${top ? `available (${top.length})` : "NOT available to this app"}${t.refreshToken ? "; Spotify rotated the refresh token, so run `pnpm spotify:auth` output into .env again if checks start failing" : ""}`;
});

await check("Instagram", ["INSTAGRAM_USER_ID", "INSTAGRAM_ACCESS_TOKEN"], async () => {
  const v = env.GRAPH_API_VERSION || "v25.0";
  const fields = encodeURIComponent("business_discovery.username(instagram){username,media_count}");
  const r = z
    .object({ business_discovery: z.object({ username: z.string(), media_count: z.number().optional() }) })
    .parse(await fetchJson(`https://graph.facebook.com/${v}/${env.INSTAGRAM_USER_ID}?fields=${fields}&access_token=${encodeURIComponent(env.INSTAGRAM_ACCESS_TOKEN!)}`, { attempts: 1 }));
  let expiry = "";
  if (env.FACEBOOK_APP_ID && env.FACEBOOK_APP_SECRET) {
    const d = z
      .object({ data: z.object({ is_valid: z.boolean(), expires_at: z.number().optional() }) })
      .parse(await fetchJson(`https://graph.facebook.com/${v}/debug_token?input_token=${encodeURIComponent(env.INSTAGRAM_ACCESS_TOKEN!)}&access_token=${encodeURIComponent(`${env.FACEBOOK_APP_ID}|${env.FACEBOOK_APP_SECRET}`)}`, { attempts: 1 }));
    expiry = d.data.expires_at ? `; token expires ${new Date(d.data.expires_at * 1000).toISOString().slice(0, 10)}` : "; token never expires";
  }
  return `Business Discovery works (read @${r.business_discovery.username})${expiry}`;
});

process.exitCode = failures ? 1 : 0;
