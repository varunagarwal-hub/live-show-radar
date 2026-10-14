"use client";

import { useEffect, useRef } from "react";
import { whileVisible } from "./motion";

/**
 * A venue marquee: bulb-lit border, text scrolling forever. The scroll is a CSS animation, so the
 * browser runs it on the compositor without touching the main thread. Hovering or focusing pauses
 * it, it stops while scrolled out of view, and with reduced motion it sits still (the text is
 * duplicated only for the loop).
 */
export function Marquee({ items }: { items: string[] }) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    return whileVisible(el, (v) => el.classList.toggle("is-idle", !v));
  }, []);

  if (!items.length) return null;
  const run = items.map((t, i) => (
    <span key={i} className="mq-item">
      {t}
      <span className="mq-star" aria-hidden="true">
        ★
      </span>
    </span>
  ));
  // About as fast as the old version: longer text scrolls for longer.
  const seconds = Math.max(18, Math.round(items.join(" ").length / 4));
  return (
    <div ref={box} className="marquee" role="marquee" aria-label={items.join(". ")} style={{ "--mq-seconds": `${seconds}s` } as React.CSSProperties}>
      <div className="mq-track" aria-hidden="true">
        <div className="mq-run">{run}</div>
        <div className="mq-run">{run}</div>
      </div>
    </div>
  );
}
