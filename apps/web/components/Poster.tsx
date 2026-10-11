import type { ShowCard } from "@/lib/data";
import { cityCode, daysToGo, stubDate } from "@/lib/format";

/** The next show he's going to, set like a gig poster. */
export function Poster({ show }: { show: ShowCard }) {
  const days = show.date ? daysToGo(show.date) : null;
  const when = days === null ? "" : days === 0 ? "Tonight" : days === 1 ? "Tomorrow" : `${days} days to go`;
  return (
    <section className="poster" aria-labelledby="next-up-title">
      <div>
        <div className="poster-kicker">
          <span className={`city-code ${show.isHome ? "home" : "away"}`}>{cityCode(show.city)}</span>
          <span>Your next show</span>
        </div>
        <h1 id="next-up-title" className="poster-artist">
          {show.artistName}
        </h1>
        <p className="poster-meta">{[show.venue, show.city].filter(Boolean).join(", ")}</p>
        <p className="poster-meta">
          {stubDate(show.date, show.endDate)} {when && <span className="poster-days">{when}</span>}
        </p>
        <div className="poster-links">
          {show.playlistUrl ? (
            <a href={show.playlistUrl} target="_blank" rel="noopener noreferrer">
              Pre-show playlist
            </a>
          ) : (
            <span>Playlist on its way</span>
          )}
          {show.ticketUrl && (
            <a href={show.ticketUrl} target="_blank" rel="noopener noreferrer">
              Tickets
            </a>
          )}
          {show.flightsUrl && (
            <a href={show.flightsUrl} target="_blank" rel="noopener noreferrer">
              Search flights
            </a>
          )}
        </div>
      </div>
      {show.imageUrl && (
        <div className={`poster-art ${show.isHome ? "home" : "away"}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={show.imageUrl} alt="" style={{ filter: `url(#${show.isHome ? "duo-home" : "duo-away"})` }} />
        </div>
      )}
    </section>
  );
}
