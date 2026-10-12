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
