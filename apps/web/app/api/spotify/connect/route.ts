import { NextResponse } from "next/server";
import { getViewer, newSecret } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Read-only scopes: follows, top artists and recent plays to build someone's artist list. */
const SCOPES = ["user-follow-read", "user-top-read", "user-read-recently-played"];

/**
 * Starts "Connect Spotify". Spotify's Development Mode only lets accounts the owner added in the
 * Spotify dashboard (User Management, 5 at most) through; anyone else is told to use search.
 */
export async function GET() {
  const base = process.env.PUBLIC_BASE_URL ?? "";
  const v = await getViewer();
  if (!v) return NextResponse.redirect(`${base}/signin`);
  const state = newSecret(16);
  const url = new URL("https://accounts.spotify.com/authorize");
  url.search = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID ?? "",
    response_type: "code",
    redirect_uri: `${base}/api/spotify/callback`,
    scope: SCOPES.join(" "),
    state,
    show_dialog: "true",
  }).toString();
  const res = NextResponse.redirect(url.toString());
  res.cookies.set("sp_state", `${v.id}.${state}`, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/spotify", maxAge: 600 });
  return res;
}
