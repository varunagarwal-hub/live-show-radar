"use client";

import { useEffect, useRef } from "react";
import { gsap, prefersReducedMotion, whileVisible } from "./motion";

/**
 * A venue marquee: bulb-lit border, text scrolling forever. Hovering or focusing pauses it, and
 * with reduced motion it sits still (the text is duplicated only for the loop).
 */
export function Marquee({ items }: { items: string[] }) {
  const track = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = track.current;
    if (!el || !items.length || prefersReducedMotion()) return;
    const tween = gsap.to(el, { xPercent: -50, ease: "none", duration: Math.max(18, items.join(" ").length / 4), repeat: -1 });
    const box = el.parentElement!;
    let onScreen = true;
    let hovered = false;
    const sync = () => {
      const run = onScreen && !hovered;
      if (run) tween.play();
      else tween.pause();
      // The chasing bulbs are a CSS animation: pause them too while nobody can see them.
      box.classList.toggle("is-idle", !onScreen);
    };
    const pause = () => ((hovered = true), sync());
    const play = () => ((hovered = false), sync());
    const stopWatching = whileVisible(box, (v) => ((onScreen = v), sync()));
    box.addEventListener("mouseenter", pause);
    box.addEventListener("mouseleave", play);
    box.addEventListener("focusin", pause);
    box.addEventListener("focusout", play);
    return () => {
      stopWatching();
      tween.kill();
      box.removeEventListener("mouseenter", pause);
      box.removeEventListener("mouseleave", play);
      box.removeEventListener("focusin", pause);
      box.removeEventListener("focusout", play);
    };
  }, [items]);

  if (!items.length) return null;
  const run = items.map((t, i) => (
    <span key={i} className="mq-item">
      {t}
      <span className="mq-star" aria-hidden="true">
        ★
      </span>
    </span>
  ));
  return (
    <div className="marquee" role="marquee" aria-label={items.join(". ")}>
      <div className="mq-track" ref={track} aria-hidden="true">
        <div className="mq-run">{run}</div>
        <div className="mq-run">{run}</div>
      </div>
    </div>
  );
}
