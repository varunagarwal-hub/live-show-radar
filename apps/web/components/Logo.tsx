"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { gsap, prefersReducedMotion } from "./motion";

const WORDS = ["Early", "Access"];

/**
 * The masthead logo. On load the ticket stub is flicked in, spinning, and lands with a bounce; its
 * perforation is punched in, the star pops, and the letters rise. Every so often the stub gives a
 * small wobble and a light glints across it, like a pass catching the stage lights.
 */
export function Logo({ sub }: { sub: string }) {
  const ref = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      tl.fromTo(".logo-mark", { scale: 0.2, rotation: -220, y: -24, opacity: 0 }, { scale: 1, rotation: 0, y: 0, opacity: 1, duration: 0.9, ease: "back.out(1.8)" })
        .fromTo(".logo-perf", { strokeDashoffset: 24 }, { strokeDashoffset: 0, duration: 0.5, ease: "none" }, 0.55)
        .fromTo(".logo-star", { scale: 0, rotation: -90, transformOrigin: "50% 50%" }, { scale: 1, rotation: 0, duration: 0.5, ease: "back.out(3)" }, 0.7)
        .fromTo(".logo-letter", { yPercent: 105 }, { yPercent: 0, duration: 0.5, stagger: 0.03 }, 0.2)
        .fromTo(".logo-sub", { opacity: 0, x: -8 }, { opacity: 1, x: 0, duration: 0.4 }, 0.8);
      // Idle: a wobble and a glint every ~9 seconds.
      gsap
        .timeline({ repeat: -1, repeatDelay: 8, delay: 4 })
        .to(".logo-mark", { rotation: -10, duration: 0.12, ease: "power1.out" })
        .to(".logo-mark", { rotation: 0, duration: 0.9, ease: "elastic.out(1.2, 0.3)" })
        .fromTo(".logo-glint", { x: -12, opacity: 0.9 }, { x: 60, opacity: 0, duration: 0.6, ease: "power2.inOut" }, 0)
        .fromTo(".logo-star", { rotation: 0 }, { rotation: 144, duration: 0.6, ease: "power2.out" }, 0);
    }, el);
    return () => ctx.revert();
  }, []);

  return (
    <Link ref={ref} href="/" className="wordmark" aria-label="Early Access, home">
      <svg className="logo-mark" viewBox="0 0 48 32" aria-hidden="true">
        <defs>
          <clipPath id="logo-clip">
            <path d="M4 2h40a2 2 0 0 1 2 2v7a5 5 0 0 0 0 10v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-7a5 5 0 0 0 0-10V4a2 2 0 0 1 2-2z" />
          </clipPath>
        </defs>
        {/* a ticket stub: notched sides, perforation, admit-one star */}
        <path className="logo-body" d="M4 2h40a2 2 0 0 1 2 2v7a5 5 0 0 0 0 10v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-7a5 5 0 0 0 0-10V4a2 2 0 0 1 2-2z" />
        <g clipPath="url(#logo-clip)">
          <rect className="logo-glint" x="-6" y="-4" width="7" height="40" transform="skewX(-20)" opacity="0" />
        </g>
        <path className="logo-perf" d="M33 6v20" />
        <path className="logo-star" d="M17 9l2.1 4.4 4.8.6-3.5 3.3.9 4.7-4.3-2.3-4.3 2.3.9-4.7-3.5-3.3 4.8-.6z" />
      </svg>
      <span className="logo-text">
        <span className="logo-name">
          {WORDS.map((w, wi) => (
            <span key={w} className="logo-word">
              {wi > 0 && " "}
              {[...w].map((ch, i) => (
                <span key={i} className="logo-clip">
                  <span className="logo-letter">{ch}</span>
                </span>
              ))}
            </span>
          ))}
        </span>
        <small className="logo-sub" suppressHydrationWarning>
          {sub}
        </small>
      </span>
    </Link>
  );
}
