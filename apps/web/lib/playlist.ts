import "server-only";
import { radarConfig, requireEnv, optionalEnv } from "@radar/config";
import { alertChat, ensurePlaylist, esc, sendOnce, spotifyFromStore, telegramClient } from "@radar/core";
import { getDb } from "./db";

/**
 * Builds the pre-show playlist after a Going decision (from the dashboard or Telegram) and sends
 * the link to Telegram once. Runs after the response is sent, so the tap feels instant.
 */
export async function ensurePlaylistForEvent(eventId: number): Promise<void> {
  if (!radarConfig.features.playlists) return;
  const env = requireEnv(["SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET", "SPOTIFY_REFRESH_TOKEN"]);
  const h = await getDb();
  const sp = await spotifyFromStore(h, env);
  const result = await ensurePlaylist(h, sp, { ...env, SETLISTFM_API_KEY: optionalEnv("SETLISTFM_API_KEY"), MUSICBRAINZ_CONTACT: optionalEnv("MUSICBRAINZ_CONTACT") }, eventId);
  const token = optionalEnv("TELEGRAM_BOT_TOKEN");
  if (!result || !token) return;
  const dryRun = radarConfig.dryRun;
  await sendOnce(h, telegramClient(token), {
    dedupKey: `playlist:${eventId}`,
    kind: "playlist",
    eventId,
    chatId: alertChat({ TELEGRAM_ALERT_CHAT_ID: process.env.TELEGRAM_ALERT_CHAT_ID, TELEGRAM_TEST_CHAT_ID: process.env.TELEGRAM_TEST_CHAT_ID }, dryRun),
    html: `🎧 Your pre-show playlist is ready: <a href="${esc(result.url)}">open in Spotify</a>\n${result.basis === "setlists" ? `${result.trackCount} songs, most-played live first.` : "No recent setlists, so it's their latest releases."}`,
    dryRun,
  });
}
