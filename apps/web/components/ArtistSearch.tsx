"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { followSpotifyArtistAction, searchArtistsAction } from "@/lib/people-actions";
import type { FoundArtist } from "@/lib/spotify-app";
import { confetti } from "./Effects";

/**
 * Search Spotify's catalogue and add artists to your radar. Works for everyone: it uses the app's
 * own Spotify access, not yours.
 */
export function ArtistSearch({ followingIds = [] }: { followingIds?: string[] }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<FoundArtist[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set(followingIds));
  const [searching, startSearch] = useTransition();
  const [adding, startAdd] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(() => {
      startSearch(async () => {
        const r = await searchArtistsAction(q);
        setResults(r.results);
        setError(r.error ?? null);
      });
    }, 300);
  }, [q]);

  return (
    <div className="artist-search">
      <label className="small" htmlFor="artist-q">
        Find an artist
      </label>
      <input
        id="artist-q"
        className="field"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Prateek Kuhad, Diljit, Coldplay…"
        autoComplete="off"
        aria-describedby="artist-q-status"
      />
      <p id="artist-q-status" className="small" aria-live="polite">
        {searching ? "Searching…" : error ?? (q.trim().length >= 2 && !results.length ? "No artists found." : "")}
      </p>
      {results.length > 0 && (
        <ul className="search-results">
          {results.map((a) => {
            const isAdded = added.has(a.spotifyId);
            return (
              <li key={a.spotifyId}>
                {a.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.imageUrl} alt="" width={48} height={48} />
                ) : (
                  <span className="sr-ph" aria-hidden="true">
                    ♪
                  </span>
                )}
                <span className="sr-name">
                  <b>{a.name}</b>
                  {a.genres.length > 0 && <small>{a.genres.join(", ")}</small>}
                </span>
                <button
                  type="button"
                  className={`btn${isAdded ? "" : " solid"}`}
                  disabled={isAdded || adding}
                  onClick={(e) => {
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    startAdd(async () => {
                      const res = await followSpotifyArtistAction(a.spotifyId);
                      if (res.ok) {
                        setAdded((s) => new Set(s).add(a.spotifyId));
                        confetti(r.left + r.width / 2, r.top + r.height / 2, 36);
                      }
                    });
                  }}
                >
                  {isAdded ? "On your radar ✓" : "Add"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
