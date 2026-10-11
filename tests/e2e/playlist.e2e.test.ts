/** Tapping Going (Telegram) → pre-show playlist created once, refreshed in place later. */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensurePlaylist, handleUpdate, encodeCallback, type SpotifyClient, type SpotifyTrack } from "@radar/core";
import { connectPglite } from "@radar/core/db/pglite";
import type { DbHandle } from "@radar/core/db";
import { artists, events, playlists } from "@radar/core/db/schema";
import { recordingSink, fixtureLlm } from "./fixtures";

let h: DbHandle;
const track = (name: string): SpotifyTrack => ({ id: name, uri: `spotify:track:${name.replace(/\W/g, "")}`, name, artists: [{ id: "artist1", name: "Lifafa" }] });

function fakeSpotify() {
  const calls = { created: [] as string[], replaced: [] as string[][] };
  const sp: SpotifyClient = {
    followedArtists: async () => [],
    topArtists: async () => [],
    recentlyPlayedArtists: async () => [],
    artist: async () => null,
    recentTracks: async () => ["Jaago", "Nikamma", "Din Raat", "Waqt", "Jee Le", "Dil Ko"].map(track),
    findTrack: async () => null,
    createPlaylist: async (name) => (calls.created.push(name), { id: "pl1", url: "https://open.spotify.com/playlist/pl1" }),
    replacePlaylistItems: async (_id, uris) => void calls.replaced.push(uris),
  };
  return { sp, calls };
}

beforeAll(async () => {
  h = await connectPglite();
  await h.db.insert(artists).values({ id: 3, name: "Lifafa", spotifyId: "artist1", priorityTier: "B" });
  await h.db.insert(events).values({ id: 30, artistId: 3, city: "Bengaluru", date: "2026-12-13", fingerprint: "3|bengaluru|2026-12-13", confidence: 0.9 });
}, 60_000);

describe("pre-show playlist", () => {
  it("is created when Going is tapped, from recent releases when there are no setlists", async () => {
    const { sp, calls } = fakeSpotify();
    await handleUpdate(
      { update_id: 1, callback_query: { id: "cq", data: encodeCallback({ kind: "decide", status: "going", eventId: 30 }), message: { message_id: 1, chat: { id: 111 } } } },
      { h, tg: recordingSink(), allowedChats: new Set(["111"]), llm: () => fixtureLlm(), onGoing: async (id) => void (await ensurePlaylist(h, sp, { SPOTIFY_CLIENT_ID: "x", SPOTIFY_CLIENT_SECRET: "x", SPOTIFY_REFRESH_TOKEN: "x" }, id)) },
    );
    expect(calls.created).toEqual(["Lifafa — Bengaluru, 13 Dec"]);
    expect(calls.replaced[0]).toHaveLength(6);
    expect((await h.db.select().from(playlists).where(eq(playlists.eventId, 30)))[0]).toMatchObject({ basis: "releases", url: "https://open.spotify.com/playlist/pl1", trackCount: 6 });
  });

  it("refreshes the same playlist instead of creating another", async () => {
    const { sp, calls } = fakeSpotify();
    const r = await ensurePlaylist(h, sp, { SPOTIFY_CLIENT_ID: "x", SPOTIFY_CLIENT_SECRET: "x", SPOTIFY_REFRESH_TOKEN: "x" }, 30);
    expect(r).toMatchObject({ created: false });
    expect(calls.created).toEqual([]);
    expect(calls.replaced).toHaveLength(1);
  });
});
