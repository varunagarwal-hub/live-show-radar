"use client";

import { useEffect, useRef } from "react";
import { Draggable, gsap, prefersReducedMotion } from "@/components/motion";

/**
 * The sign-in scene: an Early Access pass on a lanyard drops in from the rig, swings and settles.
 * Grab it and it swings from the strap; let go and it sways back. Spotlights sweep the room, and
 * the hologram strip shimmers. Static (and still fully usable) under reduced motion.
 */
export function BackstagePass() {
  const root = useRef<HTMLDivElement>(null);
  const pass = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    const card = pass.current;
    if (!el || !card || prefersReducedMotion()) return;
    let drag: Draggable | undefined;
    // Scoped to the whole sign-in section, so the headline words animate too.
    const ctx = gsap.context(() => {
      gsap.set(card, { transformOrigin: "50% 0%" });
      const sway = () =>
        gsap.to(card, {
          rotation: 2.5,
          duration: 2.6,
          ease: "sine.inOut",
          yoyo: true,
          repeat: -1,
        });
      let idle: gsap.core.Tween | null = null;
      const tl = gsap.timeline({ onComplete: () => void (idle = sway()) });
      tl.fromTo(card, { y: -560 }, { y: 0, duration: 0.9, ease: "power3.in" })
        .fromTo(card, { rotation: 0 }, { rotation: -14, duration: 0.25, ease: "power2.out" })
        .to(card, { rotation: 0, duration: 1.6, ease: "elastic.out(1, 0.25)" })
        .from(".si-word", { yPercent: 110, duration: 0.6, stagger: 0.07, ease: "power3.out" }, 0.3)
        .from(".si-rise", { y: 16, opacity: 0, duration: 0.45, stagger: 0.08 }, 0.7);
      gsap.to(".si-spot-l", {
        rotate: 10,
        duration: 4,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
      });
      gsap.to(".si-spot-r", {
        rotate: -10,
        duration: 4.6,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
      });
      gsap.to(".bp-holo", {
        backgroundPosition: "200% 0",
        duration: 3,
        ease: "none",
        repeat: -1,
      });

      [drag] = Draggable.create(card, {
        type: "rotation",
        bounds: { minRotation: -38, maxRotation: 38 },
        onPress: () => idle?.kill(),
        onRelease: () => {
          gsap.to(card, {
            rotation: 0,
            duration: 1.8,
            ease: "elastic.out(1, 0.22)",
            onComplete: () => void (idle = sway()),
          });
        },
      });
    }, el.closest("section") ?? el);
    return () => {
      drag?.kill();
      ctx.revert();
    };
  }, []);

  return (
    <div ref={root} className="si-scene" aria-hidden="true">
      <div className="bp-rig">
        <div ref={pass} className="bp-swing">
          <svg className="bp-lanyard" viewBox="0 0 120 150">
            <path d="M20 0 L52 140 M100 0 L68 140" />
            <rect x="48" y="132" width="24" height="16" rx="3" />
          </svg>
          <div className="bp-card">
            <div className="bp-hole" />
            <div className="bp-head">
              <span>Early access</span>
              <span className="bp-star">★</span>
            </div>
            <div className="bp-body">
              <p className="bp-label">Guest list</p>
              <p className="bp-name">You?</p>
              <dl className="bp-grid">
                <div>
                  <dt>Valid</dt>
                  <dd>Every show</dd>
                </div>
                <div>
                  <dt>Zone</dt>
                  <dd>Front row</dd>
                </div>
                <div>
                  <dt>Doors</dt>
                  <dd>Before the early-birds go</dd>
                </div>
              </dl>
            </div>
            <div className="bp-holo" />
            <div className="bp-code">
              {Array.from({ length: 34 }, (_, i) => (
                <i key={i} style={{ width: `${1 + ((i * 7) % 4)}px` }} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
