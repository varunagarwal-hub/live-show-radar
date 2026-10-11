/**
 * One-time Spotify authorisation (Authorization Code flow) to get Karan's refresh token.
 *   1. In the Spotify app settings, add the redirect URI  http://127.0.0.1:8888/callback
 *   2. Put SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env
 *   3. pnpm spotify:auth  → open the printed link, approve, copy the refresh token it prints
 * Spotify refresh tokens now expire 6 months after authorisation; run this again when the
 * watchlist job's Telegram warning says so.
 */
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { requireEnv } from "@radar/config";
import { exchangeSpotifyCode, SPOTIFY_SCOPES } from "@radar/core";
import "./load-env";

const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } = requireEnv(["SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET"]);
// Spotify requires an explicit loopback IP (not "localhost") for http redirect URIs.
const redirectUri = "http://127.0.0.1:8888/callback";
const state = randomBytes(16).toString("hex");

const url = new URL("https://accounts.spotify.com/authorize");
url.search = new URLSearchParams({ client_id: SPOTIFY_CLIENT_ID, response_type: "code", redirect_uri: redirectUri, scope: SPOTIFY_SCOPES.join(" "), state, show_dialog: "true" }).toString();

const server = createServer(async (req, res) => {
  const u = new URL(req.url ?? "/", redirectUri);
  if (u.pathname !== "/callback") return res.writeHead(404).end();
  if (u.searchParams.get("state") !== state) return res.writeHead(400).end("State mismatch. Start again.");
  const code = u.searchParams.get("code");
  if (!code) return res.writeHead(400).end(`Spotify said: ${u.searchParams.get("error") ?? "no code"}`);
  try {
    const t = await exchangeSpotifyCode(SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, code, redirectUri);
    res.writeHead(200, { "content-type": "text/plain" }).end("Done. Go back to the terminal.");
    console.log("\nYour refresh token (keep it secret; add it as SPOTIFY_REFRESH_TOKEN in GitHub and Vercel):\n");
    console.log(t.refresh_token ?? "(Spotify returned no refresh token; check the app's redirect URI and try again)");
  } catch (err) {
    res.writeHead(500).end("Exchange failed; see terminal.");
    console.error(`Token exchange failed: ${(err as Error).message}`);
  } finally {
    server.close();
  }
});

server.listen(8888, "127.0.0.1", () => {
  console.log("Open this link in your browser and approve access:\n");
  console.log(url.toString());
});
