"use client";

import { useEffect, useRef } from "react";
import { gsap, prefersReducedMotion } from "./motion";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/**
 * A departures-board split-flap: each character flips through a few random glyphs before it
 * lands, staggered left to right. With reduced motion the final text is simply shown.
 */
export function SplitFlap({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root || prefersReducedMotion()) return;
    const ctx = gsap.context(() => {
      root.querySelectorAll<HTMLElement>(".flap-char").forEach((el, i) => {
        const target = el.dataset.char ?? "";
        if (target === " ") return;
        const flips = 4 + Math.floor(Math.random() * 5);
        const tl = gsap.timeline({ delay: 0.35 + i * 0.05 });
        for (let f = 0; f <= flips; f++) {
          const last = f === flips;
          tl.to(el, { rotateX: -90, duration: 0.045, ease: "none" })
            .call(() => {
              el.textContent = last ? target : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]!;
            })
            .set(el, { rotateX: 90 })
            .to(el, { rotateX: 0, duration: last ? 0.12 : 0.045, ease: last ? "back.out(3)" : "none" });
        }
      });
    }, root);
    return () => ctx.revert();
  }, [text]);

  return (
    <span ref={ref} className={`split-flap ${className ?? ""}`} aria-label={text} role="text">
      {/* Words stay together so the board wraps between words on narrow screens. */}
      {text.split(" ").map((word, w) => (
        <span key={w} className="flap-word" aria-hidden="true">
          {[...word].map((ch, i) => (
            <span key={i} className="flap">
              <span className="flap-char" data-char={ch}>
                {ch}
              </span>
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}
