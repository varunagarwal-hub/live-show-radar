"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { ShowCard } from "@/lib/data";
import { decideAction } from "@/lib/actions";
import { cityCode, DEADLINE_LABEL, formatPrice, shortWhen, stubDate } from "@/lib/format";
import { BoardingPassButton, CassetteButton, TicketButton, WristbandButton } from "./ActionButtons";
import { Countdown } from "./Countdown";
import { Draggable, gsap } from "./motion";

type Decision = ShowCard["decision"];

function priceLine(s: ShowCard): string | null {
  const open = s.tiers.filter((t) => t.status === "open" || t.status === "upcoming");
  if (!open.length) return null;
  const t = open[0]!;
  return `${formatPrice(t.price_inr)} ${t.name.toLowerCase()}${t.status === "upcoming" ? " (soon)" : ""}`;
}

/**
 * The signature element: a ticket stub. The tear-off holds the live countdown. Drag it off (or
 * tap Going) and the stub is admitted: the tear-off flies away and the ADMITTED stamp lands.
 * When the deadline passes or every tier sells out, the tear-off is already gone (torn).
 */
export function Stub({ show, mini = false, emphasis }: { show: ShowCard; mini?: boolean; emphasis?: "closing" | "decide" }) {
  const [decision, setDecision] = useState<Decision>(show.decision);
  const [justAdmitted, setJustAdmitted] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const tearRef = useRef<HTMLDivElement>(null);

  const deadlinePassed = show.deadline ? Date.parse(show.deadline.at) <= Date.now() : false;
  const torn = show.soldOut || deadlinePassed || (show.earlyBirdStatus === "sold_out" && !show.deadline && !show.tiers.some((t) => t.status === "open"));
  const urgent = show.urgency === "urgent";
  const price = priceLine(show);
  const canTear = !mini && !torn && decision !== "going";

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
  const decideRef = useRef(decide);
  decideRef.current = decide;

  // Tear to go: drag the tear-off past the halfway mark and it rips away.
  useEffect(() => {
    const el = tearRef.current;
    if (!el || !canTear) return;
    const card = el.closest("article");
    const [drag] = Draggable.create(el, {
      type: "x",
      bounds: { minX: 0, maxX: 200 },
      onPress() {
        card?.classList.add("tearing");
      },
      onDrag() {
        gsap.set(el, { rotation: this.x / 18 });
      },
      onDragEnd() {
        if (this.x > 64) {
          gsap.to(el, {
            x: 300,
            y: 90,
            rotation: 28,
            opacity: 0,
            duration: 0.42,
            ease: "power2.in",
            onComplete: () => {
              gsap.set(el, { clearProps: "transform,opacity" });
              card?.classList.remove("tearing");
              decideRef.current("going");
            },
          });
        } else {
          gsap.to(el, { x: 0, rotation: 0, duration: 0.4, ease: "back.out(2.6)", onComplete: () => card?.classList.remove("tearing") });
        }
      },
    });
    return () => {
      drag?.kill();
    };
  }, [canTear]);

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
          <>
            <div className="stub-actions" role="group" aria-label="Your decision">
              <button className="btn" aria-pressed={decision === "going"} disabled={pending} onClick={() => decide("going")}>
                Going
              </button>
              <button className="btn" aria-pressed={decision === "maybe"} disabled={pending} onClick={() => decide("maybe")}>
                Maybe
              </button>
              <button className="btn" aria-pressed={decision === "pass"} disabled={pending} onClick={() => decide("pass")}>
                Pass
              </button>
            </div>
            <div className="gig-actions">
              {show.ticketUrl ? (
                <TicketButton href={show.ticketUrl} label="Tickets" sub="Open booking" />
              ) : (
                <TicketButton href={show.searchUrl} label="Tickets" sub="Best match" />
              )}
              {show.bioUrl && !show.ticketUrl && <WristbandButton href={show.bioUrl} label="Artist's links" />}
              {decision === "going" && show.playlistUrl && <CassetteButton href={show.playlistUrl} />}
              {show.flightsUrl && show.flightRoute && <BoardingPassButton href={show.flightsUrl} from={show.flightRoute.from} to={show.flightRoute.to} />}
            </div>
          </>
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
        <div className={`stub-tear${canTear ? " can-tear" : ""}`} ref={tearRef}>
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
          {canTear && (
            <span className="tear-hint" aria-hidden="true">
              Tear to go →
            </span>
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
