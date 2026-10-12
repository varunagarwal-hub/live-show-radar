"use client";

import { useState, useTransition } from "react";
import type { ShowCard } from "@/lib/data";
import { decideAction } from "@/lib/actions";
import { cityCode, DEADLINE_LABEL, formatPrice, shortWhen, stubDate } from "@/lib/format";
import { Countdown } from "./Countdown";

type Decision = ShowCard["decision"];

function priceLine(s: ShowCard): string | null {
  const open = s.tiers.filter((t) => t.status === "open" || t.status === "upcoming");
  if (!open.length) return null;
  const t = open[0]!;
  return `${formatPrice(t.price_inr)} ${t.name.toLowerCase()}${t.status === "upcoming" ? " (soon)" : ""}`;
}

/**
 * The signature element: a ticket stub. The tear-off holds the live countdown. When the deadline
 * passes or every tier sells out, the tear-off is gone (torn). Going stamps it ADMITTED.
 */
export function Stub({ show, mini = false, emphasis }: { show: ShowCard; mini?: boolean; emphasis?: "closing" | "decide" }) {
  const [decision, setDecision] = useState<Decision>(show.decision);
  const [justAdmitted, setJustAdmitted] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const deadlinePassed = show.deadline ? Date.parse(show.deadline.at) <= Date.now() : false;
  const torn = show.soldOut || deadlinePassed || (show.earlyBirdStatus === "sold_out" && !show.deadline && !show.tiers.some((t) => t.status === "open"));
  const urgent = show.urgency === "urgent";
  const price = priceLine(show);

  const decide = (next: NonNullable<Decision>) => {
    const prev = decision;
    setDecision(next);
    setError(null);
    if (next === "going") setJustAdmitted(true);
    start(async () => {
      const r = await decideAction(show.id, next).catch(() => ({ ok: false }));
      if (!r.ok) {
        setDecision(prev);
        setJustAdmitted(false);
        setError("Couldn't save that. Try again.");
      }
    });
  };

  const classes = ["stub", mini && "mini", torn && "torn", !torn && emphasis, justAdmitted && "thud"].filter(Boolean).join(" ");
  const label = `${show.artistName}, ${stubDate(show.date, show.endDate)}, ${show.city}`;

  return (
    <article className={classes} aria-label={label}>
      <div className="stub-main">
        <span className={`ink-bar ${show.isHome ? "home" : "away"}${urgent ? " urgent" : ""}`} aria-hidden="true" />
        <div className="stub-date">{stubDate(show.date, show.endDate)}</div>
        <h3 className="stub-artist">{show.artistName}</h3>
        {show.venue && <div className="stub-venue">{show.venue}</div>}
        <div className="stub-meta">
          <span className={`city-code ${show.isHome ? "home" : "away"}`}>{cityCode(show.city)}</span>
          <span className={show.priorityTier === "A" ? "tier-a" : undefined}>tier {show.priorityTier}</span>
          {price && <span>{price}</span>}
          {show.weekPart && !show.isHome && <span>{show.weekPart}</span>}
          {show.handleUnconfirmed && <span>handle unconfirmed</span>}
          {show.unconfirmed && <span className="highlight">Unconfirmed: check before buying</span>}
        </div>
        {!mini && show.clashes.length > 0 && (
          <ul className="stub-notes" aria-label="Clashes">
            {show.clashes.slice(0, 2).map((c, i) => (
              <li key={i}>{c.kind === "calendar" ? `Clashes with “${c.detail}”` : `Same weekend as ${c.detail}`}</li>
            ))}
          </ul>
        )}
        {!mini && (
          <div className="stub-actions">
            <button className="btn" aria-pressed={decision === "going"} disabled={pending} onClick={() => decide("going")}>
              Going
            </button>
            <button className="btn" aria-pressed={decision === "maybe"} disabled={pending} onClick={() => decide("maybe")}>
              Maybe
            </button>
            <button className="btn" aria-pressed={decision === "pass"} disabled={pending} onClick={() => decide("pass")}>
              Pass
            </button>
            {show.ticketUrl ? (
              <a className="btn link" href={show.ticketUrl} target="_blank" rel="noopener noreferrer">
                Open tickets
              </a>
            ) : (
              <>
                {show.bioUrl && (
                  <a className="btn link" href={show.bioUrl} target="_blank" rel="noopener noreferrer" title="The artist's link page usually has a booking link per city">
                    Artist's links
                  </a>
                )}
                <a className="btn link" href={show.searchUrl} target="_blank" rel="noopener noreferrer">
                  Find tickets
                </a>
              </>
            )}
            {show.flightsUrl && (
              <a className="btn link" href={show.flightsUrl} target="_blank" rel="noopener noreferrer">
                Search flights
              </a>
            )}
            {decision === "going" && show.playlistUrl && (
              <a className="btn link" href={show.playlistUrl} target="_blank" rel="noopener noreferrer">
                Playlist
              </a>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="stub-venue">
            {error}
          </p>
        )}
      </div>

      {torn ? (
        <div className="stub-tear" aria-label="Tear-off">
          {show.soldOut ? "Sold out" : deadlinePassed && show.deadline?.kind === "early_bird_closes" ? "Early-bird over" : "Deadline passed"}
        </div>
      ) : decision === "going" ? (
        // Admitted: the stamp owns the tear-off; the deadline no longer matters.
        <div className="stub-tear" aria-hidden="true" />
      ) : (
        <div className="stub-tear">
          {show.deadline ? (
            <>
              <span className="tear-label">{DEADLINE_LABEL[show.deadline.kind]} in</span>
              <Countdown className="tear-count" to={show.deadline.at} />
              <span className="tear-when">{shortWhen(show.deadline.at)}</span>
            </>
          ) : show.tiers.some((t) => t.status === "open") ? (
            <>
              <span className="tear-label">Tickets</span>
              <span className="tear-count">On sale</span>
            </>
          ) : (
            <>
              <span className="tear-label">Tickets</span>
              <span className="tear-count">Soon</span>
            </>
          )}
        </div>
      )}

      {decision === "going" && (
        <span className={`stamp${justAdmitted ? " animate" : ""}`} role="img" aria-label="Admitted: you're going">
          ADMITTED
        </span>
      )}
    </article>
  );
}
