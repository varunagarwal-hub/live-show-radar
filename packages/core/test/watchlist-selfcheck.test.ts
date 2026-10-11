import { describe, expect, it } from "vitest";
import { assignTiers, proposeHandle } from "../src/watchlist";
import { findMisses, likelyCause, looksPostShow, mentionsIn, type MissContext, type PlayedShow } from "../src/selfcheck";
import { formatDigest } from "../src/digest";
import { playlistName } from "../src/playlist";
import { rankSongs, setlistDate, type Setlist } from "../src/setlists";
import { createLlm } from "../src/llm";

const A = (id: string, name = id) => ({ id, name, imageUrl: null });

describe("priority tiers (spec 4.1)", () => {
  it("assigns A, B, C and adds heavy listening without a follow", () => {
    const t = assignTiers({
      followed: [A("pk", "Prateek Kuhad"), A("lf", "Lifafa"), A("wc", "WCMT"), A("lt", "Local Train")],
      shortTop: [A("pk"), A("hk", "Hanumankind")],
      mediumTop: [A("lf")],
      recent: [
        { id: "wc", name: "WCMT", plays: 4 },
        { id: "lt", name: "Local Train", plays: 1 },
        { id: "sm", name: "Seedhe Maut", plays: 5 },
      ],
    });
    const by = Object.fromEntries(t.map((x) => [x.spotifyId, x]));
    expect(by.pk).toMatchObject({ tier: "A", followed: true, listenedNotFollowed: false });
    expect(by.hk).toMatchObject({ tier: "A", followed: false, listenedNotFollowed: true });
    expect(by.lf!.tier).toBe("B");
    expect(by.wc!.tier).toBe("B");
    expect(by.lt!.tier).toBe("C");
    expect(by.sm).toMatchObject({ tier: "B", listenedNotFollowed: true });
  });

  it("degrades to followed + recent when top artists are unavailable", () => {
    const t = assignTiers({ followed: [A("pk")], shortTop: null, mediumTop: null, recent: null });
    expect(t).toEqual([{ spotifyId: "pk", name: "pk", imageUrl: null, tier: "C", followed: true, listenedNotFollowed: false }]);
  });

  it("validates handle proposals and drops junk", async () => {
    const llm = (out: object) => createLlm([{ name: "x", supportsImages: false, complete: async () => JSON.stringify(out) }]);
    expect(await proposeHandle(llm({ instagram_handle: "@PrateekKuhad", aliases: ["Prateek Kuhad", "प्रतीक कुहाड़"], confidence: 0.9 }), { name: "Prateek Kuhad" })).toEqual({
      instagram_handle: "prateekkuhad",
      aliases: ["प्रतीक कुहाड़"],
      confidence: 0.9,
    });
    expect((await proposeHandle(llm({ instagram_handle: "not a handle!", aliases: [], confidence: 0.9 }), { name: "X" })).instagram_handle).toBeNull();
  });
});

describe("weekly self-check (spec 4.10)", () => {
  const ctx = (over: Partial<MissContext["artist"]> = {}, unhealthy: string[] = []): MissContext => ({
    artist: { id: 1, instagramHandle: "lifafa", handleStatus: "confirmed", ...over },
    unhealthySources: unhealthy,
    watchedHandles: new Set(["fandomatgilly"]),
  });
  const played = (over: Partial<PlayedShow> = {}): PlayedShow => ({ artistId: 1, city: "Bangalore", date: "2026-10-09", evidenceUrl: "https://setlist.fm/x", via: "setlistfm", ...over });

  it("spots post-show captions cheaply", () => {
    expect(looksPostShow("Thank you Bengaluru!! last night was unreal")).toBe(true);
    expect(looksPostShow("Shukriya Pune ❤️")).toBe(true);
    expect(looksPostShow("New single out Friday")).toBe(false);
    expect(mentionsIn("Thanks @gigsbangalore and @fandomatgilly.")).toEqual(["gigsbangalore", "fandomatgilly"]);
  });

  it("ignores shows that were tracked (±1 day, city aliases)", () => {
    expect(findMisses([played()], [{ artistId: 1, city: "Bengaluru", date: "2026-10-10", status: "announced" }], () => ctx())).toEqual([]);
  });

  it("names the likely cause of each miss", () => {
    expect(likelyCause(played({ mentions: ["gigsbangalore", "fandomatgilly"] }), ctx(), undefined)).toEqual({ cause: "announced by @gigsbangalore, an account you don't track", suggestedHandle: "gigsbangalore" });
    expect(likelyCause(played(), ctx({ handleStatus: "unconfirmed" }), undefined).cause).toMatch(/unconfirmed/);
    expect(likelyCause(played(), ctx({ instagramHandle: null, handleStatus: "none" }), undefined).cause).toMatch(/no Instagram handle/);
    expect(likelyCause(played(), ctx({}, ["district"]), undefined).cause).toBe("the District parser was failing");
    expect(likelyCause(played(), ctx(), undefined).cause).toBe("announced only by a promoter or venue you don't track");
    expect(likelyCause(played(), ctx(), { artistId: 1, city: "Bengaluru", date: "2026-10-09", status: "possible" }).cause).toMatch(/low-confidence/);
  });

  it("dedupes the same show seen on setlist.fm and Instagram", () => {
    const m = findMisses([played(), played({ via: "instagram", city: "Bengaluru" })], [], () => ctx());
    expect(m).toHaveLength(1);
    expect(m[0]!.city).toBe("Bengaluru");
  });
});

describe("pre-show playlist (spec 4.11)", () => {
  const sl = (id: string, songs: string[], date = "01-10-2026"): Setlist => ({ id, eventDate: date, sets: { set: [{ song: songs.map((name) => ({ name })) }] } });

  it("ranks songs by how often they're played across recent setlists", () => {
    const ranked = rankSongs([sl("1", ["Intro", "cold/mess", "Kasoor", "Tune Kaha"]), sl("2", ["cold/mess", "Kasoor", "Full Time Lover"]), sl("3", ["Kasoor", "cold/mess"]), sl("4", [])]);
    expect(ranked.slice(0, 2)).toEqual([
      { title: "cold/mess", count: 3 },
      { title: "Kasoor", count: 3 },
    ]);
    expect(ranked.find((r) => r.title === "Intro")?.count).toBe(1);
  });

  it("names playlists '<Artist> — <City>, <D Mon>'", () => {
    expect(playlistName("Prateek Kuhad", "Bengaluru", "2026-12-12")).toBe("Prateek Kuhad — Bengaluru, 12 Dec");
    expect(setlistDate("13-12-2026")).toBe("2026-12-13");
  });
});

describe("Sunday digest (spec 4.12)", () => {
  it("covers upcoming shows, decide-by, misses with track buttons, health and job failures", () => {
    const now = new Date("2026-10-11T03:30:00Z");
    const d = formatDigest({
      now,
      upcoming: [
        { id: 1, artistName: "Prateek Kuhad", city: "Bengaluru", venue: null, date: "2026-12-12", decision: "going", earlyBirdStatus: "sold_out", earlyBirdOpensAt: null, earlyBirdClosesAt: null, saleStartsAt: null, tiers: [] },
        { id: 2, artistName: "Lifafa", city: "Bengaluru", venue: null, date: "2026-11-14", decision: "maybe", earlyBirdStatus: "open", earlyBirdOpensAt: null, earlyBirdClosesAt: new Date("2026-10-12T18:29:00Z"), saleStartsAt: null, tiers: [{ name: "EB", price_inr: 799, status: "open" }] },
      ],
      misses: [{ id: 7, artistName: "Parvaaz", city: "Pune", date: "2026-10-08", likelyCause: "announced by @gigspune, an account you don't track", suggestedHandle: "gigspune", evidenceUrl: null }],
      health: [{ source: "district", healthy: false, lastNonzeroAt: new Date("2026-10-08T05:00:00Z"), lastError: null, consecutiveFailures: 0 }],
      failures: [{ job: "tiers", startedAt: now, error: "fetch failed" }],
    });
    expect(d.html).toContain("✅ Sat, 12 Dec 2026 · Prateek Kuhad, Bengaluru");
    expect(d.html).toContain("Lifafa, Bengaluru: early-bird ends");
    expect(d.html).toContain("Parvaaz played Pune");
    expect(d.html).toContain("District has returned 0 listings since Thursday.");
    expect(d.html).toContain("tiers: 1 failed run");
    expect(d.keyboard).toEqual([[{ text: "Track @gigspune", callback_data: "t:7" }]]);
  });
});
