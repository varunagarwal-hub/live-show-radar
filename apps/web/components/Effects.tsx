"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { gsap, prefersReducedMotion, ScrollTrigger } from "./motion";

/**
 * The small stuff that makes the app feel like a gig: a spark burst under every button press,
 * confetti cannons for "Going", a stage-light sweep between pages, and section titles that rise
 * into place as they scroll in. All of it is skipped under prefers-reduced-motion.
 */

const INKS = ["#ff48b0", "#0078bf", "#ffe800", "#e4e6e1"];

function layer(): HTMLDivElement {
  let el = document.getElementById("fx-layer") as HTMLDivElement | null;
  if (!el) {
    el = document.createElement("div");
    el.id = "fx-layer";
    el.setAttribute("aria-hidden", "true");
    document.body.appendChild(el);
  }
  return el;
}

/** A pinch of pyro: eight ink dots flying out from where the button was pressed. */
export function spark(x: number, y: number) {
  if (prefersReducedMotion()) return;
  const host = layer();
  for (let i = 0; i < 8; i++) {
    const d = document.createElement("i");
    d.className = "fx-spark";
    d.style.left = `${x}px`;
    d.style.top = `${y}px`;
    d.style.background = INKS[i % 3]!;
    host.appendChild(d);
    const a = (i / 8) * Math.PI * 2 + Math.random() * 0.4;
    const r = 18 + Math.random() * 16;
    gsap.fromTo(d, { x: 0, y: 0, scale: 1, opacity: 1 }, { x: Math.cos(a) * r, y: Math.sin(a) * r, scale: 0.2, opacity: 0, duration: 0.45, ease: "power2.out", onComplete: () => d.remove() });
  }
}

/** Confetti cannon: ticket stubs, stars and dots arc up and tumble down. For "Going". */
export function confetti(x: number, y: number, count = 42) {
  if (prefersReducedMotion()) return;
  const host = layer();
  for (let i = 0; i < count; i++) {
    const d = document.createElement("i");
    const shape = i % 3;
    d.className = `fx-confetti ${shape === 0 ? "stub" : shape === 1 ? "star" : "dot"}`;
    d.style.left = `${x}px`;
    d.style.top = `${y}px`;
    d.style.setProperty("--c", INKS[i % INKS.length]!);
    host.appendChild(d);
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.9;
    const v = 140 + Math.random() * 220;
    const dx = Math.cos(angle) * v;
    const up = Math.sin(angle) * v;
    const tl = gsap.timeline({ onComplete: () => d.remove() });
    tl.to(d, { x: dx * 0.6, y: up, rotation: (Math.random() - 0.5) * 360, duration: 0.5, ease: "power2.out" })
      .to(d, { x: dx, y: up + 260 + Math.random() * 160, rotation: `+=${(Math.random() - 0.5) * 540}`, duration: 1.1 + Math.random() * 0.5, ease: "power1.in" })
      .to(d, { opacity: 0, duration: 0.3 }, "-=0.3");
  }
}

/** Fires confetti from the middle of an element (the stub that was just admitted). */
export function confettiFrom(el: Element | null) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  confetti(r.left + r.width / 2, r.top + r.height / 3);
}

let firstPage = true;

/** Mounted once in the layout: sparks on presses, the page-change light sweep and title reveals. */
export function Effects() {
  const path = usePathname();
  const sweep = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = (e.target as Element | null)?.closest("button, .btn, .act, .bottom-nav a, .masthead nav a");
      if (!t || (t as HTMLButtonElement).disabled) return;
      if (t.matches("[data-fx='confetti']")) confetti(e.clientX, e.clientY, 30);
      else spark(e.clientX, e.clientY);
    };
    document.addEventListener("pointerdown", onDown, { passive: true });
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  useEffect(() => {
    const main = document.getElementById("main");
    if (!main || prefersReducedMotion()) {
      firstPage = false;
      return;
    }
    const ctx = gsap.context(() => {
      // Between pages: a pink-and-blue stage light sweeps across while the new page rises in.
      if (!firstPage && sweep.current) {
        gsap.fromTo(sweep.current, { xPercent: -110, opacity: 1 }, { xPercent: 110, duration: 0.7, ease: "power2.inOut", onComplete: () => void gsap.set(sweep.current, { opacity: 0 }) });
        gsap.from(main, { y: 18, opacity: 0, duration: 0.45, ease: "power2.out", delay: 0.12, clearProps: "transform,opacity" });
      }
      // Section titles rise out of a slot as they reach the viewport, like a set-list being lit.
      // Only titles still below the fold are hidden first, so nothing on screen ever flickers.
      const below = [...main.querySelectorAll<HTMLElement>(".section-title")].filter((t) => t.getBoundingClientRect().top > window.innerHeight);
      if (below.length) {
        gsap.set(below, { yPercent: 60, opacity: 0 });
        ScrollTrigger.batch(below, {
          start: "top 94%",
          once: true,
          onEnter: (els) => gsap.to(els, { yPercent: 0, opacity: 1, duration: 0.55, ease: "power3.out", stagger: 0.08, clearProps: "transform,opacity" }),
        });
      }
    });
    firstPage = false;
    return () => ctx.revert();
  }, [path]);

  return <div ref={sweep} className="page-sweep" aria-hidden="true" />;
}
