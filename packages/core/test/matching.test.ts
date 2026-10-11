import { describe, expect, it } from "vitest";
import { matchArtist, normalizeName, similarity, verifyMatch, type WatchArtist } from "../src/matching";
import { createLlm } from "../src/llm";

const artist = (over: Partial<WatchArtist> & { id: number; name: string }): WatchArtist => ({
  aliases: [],
  spotifyId: null,
  instagramHandle: null,
  handleStatus: "none",
  matchWeight: 1,
  muted: false,
  priorityTier: "B",
  ...over,
});

const watchlist: WatchArtist[] = [
  artist({ id: 1, name: "Prateek Kuhad", aliases: ["prateekkuhad"], spotifyId: "0tC995Rfn9k2l7nqgCZsV7", instagramHandle: "prateekkuhad", handleStatus: "confirmed" }),
  artist({ id: 2, name: "When Chai Met Toast", instagramHandle: "whenchaimettoast", handleStatus: "unconfirmed" }),
  artist({ id: 3, name: "Lifafa" }),
  artist({ id: 4, name: "Sid Sriram", aliases: ["Siddharth Sriram"] }),
  artist({ id: 5, name: "Nucleya", muted: true }),
  // Two different artists that share a name.
  artist({ id: 6, name: "Kayan", spotifyId: "AAAAAAAAAAAAAAAAAAAAAA" }),
  artist({ id: 7, name: "Kayan", spotifyId: "BBBBBBBBBBBBBBBBBBBBBB", matchWeight: 0.6 }),
  artist({ id: 8, name: "The Local Train" }),
];

describe("normalizeName / similarity", () => {
  it("ignores case, accents, 'the' and punctuation", () => {
    expect(normalizeName("The Local Train")).toBe("local train");
    expect(normalizeName("Béyoncé")).toBe("beyonce");
    expect(similarity("When Chai Met Toast", "when-chai-met-toast")).toBe(1);
  });
  it("scores spacing variants highly", () => {
    expect(similarity("Prateek Kuhad", "PrateekKuhad")).toBeGreaterThan(0.9);
  });
});

describe("matchArtist", () => {
  it("prefers a Spotify artist link in the source", () => {
    const m = matchArtist("Kayan", watchlist, { sourceText: "Listen: https://open.spotify.com/artist/BBBBBBBBBBBBBBBBBBBBBB" });
    expect(m).toMatchObject({ method: "spotify_id", needsVerification: false });
    expect(m?.artist.id).toBe(7);
  });

  it("trusts a confirmed handle", () => {
    const m = matchArtist("Prateek Kuhad", watchlist, { postedBy: "prateekkuhad" });
    expect(m).toMatchObject({ method: "handle", viaUnconfirmedHandle: false });
  });

  it("uses an unconfirmed handle but flags it", () => {
    const m = matchArtist("When Chai Met Toast", watchlist, { postedBy: "whenchaimettoast" });
    expect(m).toMatchObject({ method: "handle", viaUnconfirmedHandle: true });
  });

  it("matches exact names and aliases without verification", () => {
    expect(matchArtist("Siddharth Sriram", watchlist)).toMatchObject({ method: "exact", needsVerification: false });
    expect(matchArtist("THE LOCAL TRAIN", watchlist)?.artist.id).toBe(8);
  });

  it("sends name collisions to LLM verification", () => {
    const m = matchArtist("Kayan", watchlist);
    expect(m?.needsVerification).toBe(true);
    expect(m?.artist.id).toBe(6); // higher match weight first
  });

  it("verifies fuzzy matches", () => {
    const m = matchArtist("Prateek Kuhaad", watchlist);
    expect(m).toMatchObject({ method: "fuzzy", needsVerification: true });
    expect(m?.artist.id).toBe(1);
  });

  it("rejects names that are merely similar", () => {
    expect(matchArtist("Prateek Kumar", watchlist)).toBeNull();
    expect(matchArtist("Lifafa Kitchen", watchlist)).toBeNull();
  });

  it("never matches muted artists", () => {
    expect(matchArtist("Nucleya", watchlist)).toBeNull();
  });

  it("lowers confidence in artists marked 'wrong artist' before", () => {
    const wl = [artist({ id: 9, name: "Parvaaz", matchWeight: 0.5 })];
    expect(matchArtist("Parvaaz", wl)?.needsVerification).toBe(true);
  });
});

describe("verifyMatch", () => {
  it("accepts only confident same-artist answers", async () => {
    const llm = (answer: string) => createLlm([{ name: "fake", supportsImages: false, complete: async () => answer }]);
    const a = watchlist[0]!;
    expect(await verifyMatch(llm('{"same_artist": true, "confidence": 0.9, "reason": "same"}'), "Prateek Kuhaad", a, "...", [])).toBe(true);
    expect(await verifyMatch(llm('{"same_artist": true, "confidence": 0.4}'), "Prateek Kuhaad", a, "...", [])).toBe(false);
    expect(await verifyMatch(llm('{"same_artist": false, "confidence": 0.9}'), "Prateek Kuhaad", a, "...", [])).toBe(false);
  });
});
