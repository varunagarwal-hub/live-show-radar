"use client";

import { useRef, useState, useTransition } from "react";
import { setTicketsBookedAction } from "@/lib/actions";
import type { ShowCard } from "@/lib/data";
import { cityCode, DEADLINE_LABEL, formatPrice, shortCountdown, shortWhen, stubDate } from "@/lib/format";
import { BoardingPassButton, TicketButton } from "./ActionButtons";
import { confettiFrom } from "./Effects";
import { gsap, prefersReducedMotion } from "./motion";

/** Where the tickets stand for one show, in a few words. */
function saleStatus(s: ShowCard): string {
  if (s.soldOut) return "Sold out";
  if (s.saleStartsAt && Date.parse(s.saleStartsAt) > Date.now()) return `On sale ${shortWhen(s.saleStartsAt)} · ${shortCountdown(s.saleStartsAt)}`;
  if (s.deadline) return `${DEADLINE_LABEL[s.deadline.kind]} ${shortWhen(s.deadline.at)} · ${shortCountdown(s.deadline.at)}`;
  const open = s.tiers.filter((t) => t.status === "open" && t.price_inr !== null);
  if (open.length) return `On sale · from ${formatPrice(Math.min(...open.map((t) => t.price_inr!)))}`;
  return s.ticketUrl ? "Booking page ready" : "Booking page not found yet";
}

/**
 * Decide → "Book your tickets": every Going show you haven't got tickets for, soonest first, with
 * the booking page and a "Got tickets" stamp that moves it to Booked.
 */
export function BookList({ shows }: { shows: ShowCard[] }) {
  const [booked, setBooked] = useState<Set<number>>(new Set(shows.filter((s) => s.ticketsBooked).map((s) => s.id)));
  const [, start] = useTransition();
  const rows = useRef(new Map<number, HTMLLIElement>());
  const toBook = shows.filter((s) => !booked.has(s.id));
  const done = shows.filter((s) => booked.has(s.id));

  const toggle = (s: ShowCard, value: boolean) => {
    const el = rows.current.get(s.id);
    const apply = () =>
      setBooked((b) => {
        const n = new Set(b);
        if (value) n.add(s.id);
        else n.delete(s.id);
        return n;
      });
    if (value && el && !prefersReducedMotion()) {
      confettiFrom(el);
      gsap.to(el, { x: 40, opacity: 0, duration: 0.35, delay: 0.25, ease: "power2.in", onComplete: apply });
    } else apply();
    start(async () => {
      const r = await setTicketsBookedAction(s.id, value);
      if (!r.ok) setBooked((b) => (value ? new Set([...b].filter((x) => x !== s.id)) : new Set(b).add(s.id)));
    });
  };

  return (
    <>
      {toBook.length ? (
        <ul className="book-list">
          {toBook.map((s) => (
            <li key={s.id} ref={(el) => void (el ? rows.current.set(s.id, el) : rows.current.delete(s.id))} className={`book-row${s.isHome ? " home" : " away"}`}>
              <div className="book-when">
                <span className={`city-code ${s.isHome ? "home" : "away"}`}>{cityCode(s.city)}</span>
                <b>{s.date ? stubDate(s.date, s.endDate) : "Date TBA"}</b>
              </div>
              <div className="book-what">
                <b className="book-artist">{s.artistName}</b>
                <span>{[s.venue, s.city].filter(Boolean).join(", ")}</span>
                <span className={`book-status${s.deadline || s.saleStartsAt ? " urgent" : ""}`}>{saleStatus(s)}</span>
              </div>
              <div className="book-actions">
                <TicketButton href={s.ticketUrl ?? s.searchUrl} label="Tickets" sub={s.ticketUrl ? "Book now" : "Search"} />
                {s.flightsUrl && s.flightRoute && <BoardingPassButton href={s.flightsUrl} from={s.flightRoute.from} to={s.flightRoute.to} />}
                <button type="button" className="btn got-btn" onClick={() => toggle(s, true)}>
                  Got tickets ✓
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">Tickets sorted for every show you&apos;re going to. Enjoy the shows.</p>
      )}
      {done.length > 0 && (
        <details className="booked-list">
          <summary>
            Booked <span className="count">{done.length}</span>
          </summary>
          <ul>
            {done.map((s) => (
              <li key={s.id}>
                <span className="stamp-mini">ADMITTED</span>
                <b>{s.artistName}</b> · {s.city} · {s.date ? stubDate(s.date, s.endDate) : "Date TBA"}
                <button type="button" className="btn link" onClick={() => toggle(s, false)}>
                  Undo
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
