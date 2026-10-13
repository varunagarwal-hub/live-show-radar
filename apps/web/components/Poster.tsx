"use client";

import { useEffect, useRef } from "react";
import type { ShowCard } from "@/lib/data";
import { cityCode, daysToGo, stubDate } from "@/lib/format";
import { BoardingPassButton, CassetteButton, InstagramButton, TicketButton, WristbandButton } from "./ActionButtons";
import { gsap, prefersReducedMotion } from "./motion";
import { SplitFlap } from "./SplitFlap";

/** A halftone crowd: heads, shoulders and a few raised hands, printed in dots. */
export function Crowd() {
  const people = Array.from({ length: 22 }, (_, i) => {
    const x = 12 + i * 46 + (i % 3) * 6;
    const h = 30 + ((i * 37) % 22);
    const raised = i % 4 === 1 || i % 7 === 3;
    return (
      <g key={i}>
        <circle cx={x} cy={160 - h} r={11 + (i % 3)} />
        <rect x={x - 22} y={168 - h} width={44} height={h + 10} rx={16} />
        {raised && <path d={`M${x + 14} ${168 - h} L${x + 26} ${118 - h} L${x + 31} ${114 - h} L${x + 33} ${120 - h} L${x + 22} ${172 - h} Z`} />}
      </g>
    );
  });
  return (
    <svg className="crowd" viewBox="0 0 1024 170" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <pattern id="crowd-dots" width="5" height="5" patternUnits="userSpaceOnUse">
          <circle cx="2.5" cy="2.5" r="1.6" />
        </pattern>
      </defs>
      <g fill="url(#crowd-dots)">{people}</g>
    </svg>
  );
}

/**
 * The next show you're going to, on a stage: two ink spotlights sweep in and settle on the name,
 * the name rises word by word, the countdown flips into place like a departures board, and a
 * halftone crowd fills the front. Everything is static with reduced motion.
 */
export function Poster({ show, kicker = "Your next show", sameDay = false }: { show: ShowCard; kicker?: string; sameDay?: boolean }) {
  const stage = useRef<HTMLElement>(null);
  const days = show.date ? daysToGo(show.date) : null;
  const countdown = days === null ? "DATE TBA" : days <= 0 ? "TONIGHT" : days === 1 ? "TOMORROW" : `${days} DAYS TO GO`;

  useEffect(() => {
    const el = stage.current;
    if (!el || prefersReducedMotion()) return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      tl.fromTo(".spot-l", { rotate: -48, opacity: 0 }, { rotate: 14, opacity: 1, duration: 1.1 }, 0)
        .fromTo(".spot-r", { rotate: 48, opacity: 0 }, { rotate: -14, opacity: 1, duration: 1.1 }, 0.08)
        .to(".spot-l", { rotate: 6, duration: 1.4, ease: "sine.inOut" }, 1.1)
        .to(".spot-r", { rotate: -6, duration: 1.4, ease: "sine.inOut" }, 1.15)
        .from(".pa-word", { yPercent: 110, duration: 0.7, stagger: 0.08 }, 0.25)
        .from(".crowd", { yPercent: 40, opacity: 0, duration: 0.9 }, 0.2)
        .from(".stage-meta > *", { y: 14, opacity: 0, duration: 0.45, stagger: 0.06 }, 0.6)
        // The photo: a camera flash, then the print develops from grey into colour.
        .fromTo(".art-flash", { opacity: 0.95 }, { opacity: 0, duration: 0.7, ease: "power2.out" }, 0.35)
        .fromTo(".stage-art img", { filter: "grayscale(1) contrast(1.4) brightness(1.3)" }, { filter: "grayscale(0) contrast(1.08) brightness(1)", duration: 1.6, ease: "power2.out" }, 0.4)
        .from(".stage-art", { rotate: -12, scale: 0.86, opacity: 0, duration: 0.7, ease: "back.out(1.6)" }, 0.3);
      // A slow push-in on the photo while it holds the stage.
      gsap.fromTo(".stage-art img", { scale: 1.12 }, { scale: 1, duration: 9, ease: "sine.out" });
      // The lights keep breathing gently, like a stage between songs.
      gsap.to(".spot-l", { rotate: 10, duration: 4, ease: "sine.inOut", yoyo: true, repeat: -1, delay: 2.6 });
      gsap.to(".spot-r", { rotate: -10, duration: 4.6, ease: "sine.inOut", yoyo: true, repeat: -1, delay: 2.7 });
    }, el);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={stage} className={`stage ${show.isHome ? "home" : "away"}`} aria-labelledby="next-up-title">
      <div className="spot spot-l" aria-hidden="true" />
      <div className="spot spot-r" aria-hidden="true" />
      <div className="stage-inner">
        <div className="stage-kicker">
          <span className={`city-code ${show.isHome ? "home" : "away"}`}>{cityCode(show.city)}</span>
          <span>{kicker}</span>
          {sameDay && <span className="same-day">Same day</span>}
          {show.unconfirmed && <span className="highlight">Unconfirmed</span>}
        </div>
        <h1 id="next-up-title" className="poster-artist">
          {show.artistName.split(" ").map((w, i) => (
            <span key={i}>
              {i > 0 && " "}
              <span className="pa-clip">
                <span className="pa-word">{w}</span>
              </span>
            </span>
          ))}
        </h1>
        <div className="stage-meta">
          <p className="poster-meta">{[show.venue, show.city].filter(Boolean).join(", ")}</p>
          <p className="poster-meta">{stubDate(show.date, show.endDate)}</p>
          <SplitFlap text={countdown} className="stage-flap" />
          <div className="stage-actions">
            {show.ticketUrl ? (
              <TicketButton href={show.ticketUrl} label="Tickets" sub="Open booking" />
            ) : (
              <TicketButton href={show.searchUrl} label="Tickets" sub="Search" />
            )}
            {show.playlistUrl && <CassetteButton href={show.playlistUrl} />}
            {show.bioUrl && !show.ticketUrl && <WristbandButton href={show.bioUrl} label="Artist's links" />}
            {show.flightsUrl && show.flightRoute && <BoardingPassButton href={show.flightsUrl} from={show.flightRoute.from} to={show.flightRoute.to} />}
            {show.instagramUrl && show.instagramHandle && <InstagramButton href={show.instagramUrl} handle={show.instagramHandle} />}
          </div>
          {!show.playlistUrl && <p className="stage-note">Your pre-show playlist is being made.</p>}
        </div>
      </div>
      {show.imageUrl && (
        <div className="stage-art" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={show.imageUrl} alt="" />
          <i className="art-flash" />
        </div>
      )}
      <Crowd />
    </section>
  );
}
