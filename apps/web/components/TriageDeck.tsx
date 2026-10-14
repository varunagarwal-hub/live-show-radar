"use client";

import { useRef, useState, useTransition } from "react";
import { decideAction } from "@/lib/actions";
import type { ShowCard } from "@/lib/data";
import { cityCode, formatPrice, stubDate } from "@/lib/format";
import { confettiFrom } from "./Effects";
import { gsap, prefersReducedMotion } from "./motion";

type Choice = "going" | "maybe" | "pass";
const FLY: Record<Choice, gsap.TweenVars> = {
  going: { x: 520, rotate: 18 },
  maybe: { y: -420, rotate: -4 },
  pass: { x: -520, rotate: -18 },
};

/**
 * Decide → "New for you": shows you haven't decided on, as a deck of gig flyers. Going flies the
 * card right (with confetti), Pass left, Maybe up; the next one is underneath.
 */
export function TriageDeck({ shows }: { shows: ShowCard[] }) {
  const [left, setLeft] = useState(shows);
  const [, start] = useTransition();
  const top = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  if (!left.length) return <p className="empty">You&apos;re all caught up: every new show has a decision.</p>;
  const s = left[0]!;
  const price = s.tiers.filter((t) => t.status !== "sold_out" && t.price_inr !== null);

  const choose = (c: Choice) => {
    if (busy) return;
    setBusy(true);
    start(async () => void (await decideAction(s.id, c).catch(() => null)));
    const next = () => {
      setLeft((l) => l.slice(1));
      setBusy(false);
    };
    if (c === "going") confettiFrom(top.current);
    if (top.current && !prefersReducedMotion()) gsap.to(top.current, { ...FLY[c], opacity: 0, duration: 0.45, ease: "power2.in", onComplete: next });
    else next();
  };

  return (
    <div className="deck">
      <p className="deck-count">
        {left.length} to sort {left.length > 1 && <span aria-hidden="true">{"▮".repeat(Math.min(left.length - 1, 6))}</span>}
      </p>
      <div className="deck-stack">
        {left.length > 1 && <div className="deck-card deck-under" aria-hidden="true" />}
        <div ref={top} key={s.id} className={`deck-card${s.isHome ? " home" : " away"}`}>
          {s.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="deck-photo" src={s.imageUrl} alt="" />
          )}
          <div className="deck-body">
            <span className={`city-code ${s.isHome ? "home" : "away"}`}>{cityCode(s.city)}</span>
            <h3 className="deck-artist">{s.artistName}</h3>
            <p>
              {[s.venue, s.city].filter(Boolean).join(", ")} · {s.date ? stubDate(s.date, s.endDate) : "Date TBA"}
            </p>
            <p className="deck-meta">
              {price.length ? `From ${formatPrice(Math.min(...price.map((t) => t.price_inr!)))}` : "Price not out yet"}
              {s.unconfirmed ? " · unconfirmed" : ""}
              {s.ticketUrl ? (
                <>
                  {" · "}
                  <a href={s.ticketUrl} target="_blank" rel="noopener noreferrer">
                    booking page
                  </a>
                </>
              ) : null}
            </p>
          </div>
        </div>
      </div>
      <div className="deck-choices" role="group" aria-label={`Decide on ${s.artistName}`}>
        <button type="button" className="btn deck-pass" onClick={() => choose("pass")} disabled={busy}>
          ← Pass
        </button>
        <button type="button" className="btn deck-maybe" onClick={() => choose("maybe")} disabled={busy}>
          Maybe ↑
        </button>
        <button type="button" className="btn solid deck-going" onClick={() => choose("going")} disabled={busy}>
          Going →
        </button>
      </div>
    </div>
  );
}
