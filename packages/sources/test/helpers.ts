import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { WatchArtist } from "@radar/core";
import type { SourceContext } from "../src/types";

export const fixture = (name: string) => readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");

export const artist = (over: Partial<WatchArtist> & { id: number; name: string }): WatchArtist => ({
  aliases: [],
  spotifyId: null,
  instagramHandle: null,
  handleStatus: "none",
  matchWeight: 1,
  muted: false,
  priorityTier: "B",
  ...over,
});

export const WATCHLIST: WatchArtist[] = [
  artist({ id: 1, name: "Prateek Kuhad", priorityTier: "A", instagramHandle: "prateekkuhad", handleStatus: "confirmed" }),
  artist({ id: 2, name: "When Chai Met Toast", instagramHandle: "whenchaimettoast", handleStatus: "unconfirmed" }),
  artist({ id: 3, name: "Lifafa", priorityTier: "C" }),
  artist({ id: 4, name: "The Local Train" }),
];

export const ctx = (over: Partial<SourceContext> = {}): SourceContext => ({
  now: new Date("2026-10-11T06:00:00Z"),
  watchlist: WATCHLIST,
  accounts: [],
  cursors: {},
  seen: new Set(),
  log: () => {},
  ...over,
});

/** A page fetcher backed by fixtures; unknown URLs throw like a 404. */
export function fakeFetcher(routes: Record<string, string | Error>) {
  const calls: string[] = [];
  const fn = async (url: string) => {
    calls.push(url);
    const hit = routes[url];
    if (hit === undefined) throw new Error(`HTTP 404 for ${url}`);
    if (hit instanceof Error) throw hit;
    return hit;
  };
  return Object.assign(fn, { calls });
}
