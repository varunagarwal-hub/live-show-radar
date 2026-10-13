import { eq } from "drizzle-orm";
import { after, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeSpotifyCode, sealSecret, spotifyClient } from "@radar/core";
import { importSpotifyFollows, listeningData } from "@radar/core/db/spotify-import";
import { users } from "@radar/core/db/schema";
import { getViewer } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { secretMatches } from "@/lib/secrets";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Spotify sends people back here. Checks the state cookie, stores the refresh token encrypted,
 * and imports their artists right away (the daily job keeps them in sync after that).
 */
export async function GET(req: Request) {
  const base = process.env.PUBLIC_BASE_URL ?? "";
  const done = (status: string) => {
    const res = NextResponse.redirect(`${base}/you?spotify=${status}`);
    res.cookies.delete({ name: "sp_state", path: "/api/spotify" });
    return res;
  };
  const v = await getViewer();
  if (!v) return NextResponse.redirect(`${base}/signin`);
  const q = new URL(req.url).searchParams;
  const [cookieUser, cookieState] = ((await cookies()).get("sp_state")?.value ?? "").split(".");
  if (cookieUser !== String(v.id) || !secretMatches(q.get("state"), cookieState)) return done("expired");
  if (q.get("error")) return done("cancelled");
  const code = q.get("code");
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  const key = process.env.TOKEN_ENC_KEY;
  if (!code || !id || !secret || !key) return done("error");

  let refresh: string | undefined;
  let access: string;
  try {
    const t = await exchangeSpotifyCode(id, secret, code, `${base}/api/spotify/callback`);
    refresh = t.refresh_token;
    access = t.access_token;
  } catch {
    return done("error");
  }
  // Accounts that aren't on the app's Spotify allowlist get a token but no access (403).
  const me = await fetch("https://api.spotify.com/v1/me", { headers: { authorization: `Bearer ${access}` } });
  if (me.status === 403) return done("not-allowed");
  if (!me.ok || !refresh) return done("error");
  const spotifyUserId = ((await me.json()) as { id?: string }).id ?? null;

  const h = await getDb();
  await h.db.update(users).set({ spotifyRefreshEnc: sealSecret(refresh, key), spotifyUserId }).where(eq(users.id, v.id));
  after(async () => {
    try {
      await importSpotifyFollows(h, v.id, await listeningData(spotifyClient(access)));
      await h.db.update(users).set({ spotifySyncedAt: new Date() }).where(eq(users.id, v.id));
    } catch (err) {
      console.error(`spotify import for user ${v.id}: ${(err as Error).message}`);
    }
  });
  return done("connected");
}
