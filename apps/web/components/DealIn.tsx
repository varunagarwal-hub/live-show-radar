"use client";

import { useEffect, useRef } from "react";
import { gsap, prefersReducedMotion, ScrollTrigger } from "./motion";

/**
 * Stubs are "dealt" onto the wall as they scroll into view: each drops in with a slight,
 * alternating tilt, like tickets tossed on a table. Off with reduced motion.
 */
export function DealIn({ className, children }: { className: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    const items = Array.from(el.children) as HTMLElement[];
    const ctx = gsap.context(() => {
      gsap.set(items, { opacity: 0, y: 46, rotation: (i) => (i % 2 ? 2.5 : -2.5) });
      ScrollTrigger.batch(items, {
        start: "top 92%",
        once: true,
        onEnter: (batch) => gsap.to(batch, { opacity: 1, y: 0, rotation: 0, duration: 0.65, ease: "back.out(1.4)", stagger: 0.09, clearProps: "transform" }),
      });
    }, el);
    return () => ctx.revert();
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
