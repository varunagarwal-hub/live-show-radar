"use client";

import { gsap } from "gsap";
import { Draggable } from "gsap/Draggable";
import { ScrollTrigger } from "gsap/ScrollTrigger";

if (typeof window !== "undefined") gsap.registerPlugin(ScrollTrigger, Draggable);

export { gsap, Draggable, ScrollTrigger };

/**
 * Every animation checks this first. With reduced motion things simply appear; the same goes for
 * a page that loads in a background tab, where browsers pause animation frames and the intro
 * would otherwise leave content half-drawn until the tab is opened.
 */
export const prefersReducedMotion = () =>
  typeof window !== "undefined" && (window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.visibilityState !== "visible");

/**
 * Calls back whenever the element scrolls into or out of view (and when the tab is hidden), so
 * never-ending animations (spotlights, marquee, carousel) stop costing anything off screen.
 * Returns a cleanup function.
 */
export function whileVisible(el: Element, onChange: (visible: boolean) => void): () => void {
  let inView = true;
  const report = () => onChange(inView && document.visibilityState === "visible");
  const io = new IntersectionObserver(([entry]) => {
    inView = !!entry?.isIntersecting;
    report();
  });
  io.observe(el);
  document.addEventListener("visibilitychange", report);
  return () => {
    io.disconnect();
    document.removeEventListener("visibilitychange", report);
  };
}
