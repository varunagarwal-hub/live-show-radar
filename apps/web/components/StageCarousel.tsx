"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ShowCard } from "@/lib/data";
import { gsap, prefersReducedMotion, whileVisible } from "./motion";
import { Poster } from "./Poster";

const HOLD_SECONDS = 7;

/**
 * The stage rotates through every upcoming show you're going to, soonest first. Each artist
 * gets the full entrance (lights sweep in, name rises, countdown flips); the previous act fades
 * off first. A progress bar shows the time left on the current act. Auto-advance pauses on
 * hover, focus or the pause button, and never runs with reduced motion (the arrows still work).
 */
export function StageCarousel({ shows }: { shows: ShowCard[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [autoplay, setAutoplay] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const switching = useRef(false);
  const many = shows.length > 1;

  useEffect(() => setAutoplay(many && !prefersReducedMotion()), [many]);

  // Scrolled out of view (or tab hidden): hold the rotation, like hovering does.
  const [offscreen, setOffscreen] = useState(false);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    return whileVisible(el, (v) => setOffscreen(!v));
  }, []);

  const go = useCallback(
    (next: number) => {
      const el = wrap.current;
      if (!many || switching.current) return;
      const target = (next + shows.length) % shows.length;
      if (!el || prefersReducedMotion()) return setIndex(target);
      switching.current = true;
      gsap.to(el.querySelectorAll(".stage-inner, .stage-art, .spot"), {
        opacity: 0,
        y: -16,
        duration: 0.32,
        ease: "power2.in",
        onComplete: () => {
          switching.current = false;
          setIndex(target);
        },
      });
    },
    [many, shows.length],
  );

  // Progress bar doubles as the timer: when it fills, the next act comes on.
  useEffect(() => {
    const el = bar.current;
    if (!el || !autoplay) return;
    const tween = gsap.fromTo(el, { scaleX: 0 }, { scaleX: 1, duration: HOLD_SECONDS, ease: "none", onComplete: () => go(index + 1) });
    if (paused || hovering || offscreen) tween.pause();
    return () => {
      tween.kill();
    };
  }, [index, autoplay, paused, hovering, offscreen, go]);

  if (!shows.length) return null;
  const show = shows[index]!;
  const first = shows[0]!;
  const kicker = index === 0 ? "Your next show" : "Coming up";
  const sameDay = index > 0 && show.date === first.date;

  return (
    <div
      ref={wrap}
      className="stage-carousel"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocus={() => setHovering(true)}
      onBlur={() => setHovering(false)}
      aria-roledescription="carousel"
      aria-label="Shows you're going to"
    >
      <div aria-live={autoplay && !paused ? "off" : "polite"}>
        <Poster key={show.id} show={show} kicker={kicker} sameDay={sameDay} />
      </div>
      {many && (
        <div className="stage-controls">
          <button type="button" className="sc-btn" onClick={() => go(index - 1)} aria-label="Previous show">
            ‹
          </button>
          <span className="sc-count" aria-live="polite">
            {index + 1} / {shows.length}
          </span>
          <button type="button" className="sc-btn" onClick={() => go(index + 1)} aria-label="Next show">
            ›
          </button>
          {autoplay && (
            <button type="button" className="sc-btn sc-pause" onClick={() => setPaused((p) => !p)} aria-label={paused ? "Play the rotation" : "Pause the rotation"}>
              {paused ? "▶" : "❚❚"}
            </button>
          )}
          <span className="sc-dots" aria-hidden="true">
            {shows.map((s, i) => (
              <i key={s.id} className={i === index ? "on" : undefined} />
            ))}
          </span>
        </div>
      )}
      {autoplay && (
        <span className="sc-progress" aria-hidden="true">
          <span ref={bar} />
        </span>
      )}
    </div>
  );
}
