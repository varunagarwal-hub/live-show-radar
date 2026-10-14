"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { setHomeCityAction } from "@/lib/people-actions";
import { gsap, prefersReducedMotion } from "./motion";

/**
 * "Change" next to "Bengaluru & beyond" under the logo: pick your home city right there (it
 * decides which shows count as home and where flight searches start). Same setting as on You.
 */
export function CityPicker({ current, cities }: { current: string; cities: string[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const wrap = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    if (panel.current && !prefersReducedMotion()) gsap.fromTo(panel.current, { y: -6, opacity: 0 }, { y: 0, opacity: 1, duration: 0.22, ease: "back.out(2)" });
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const choose = (city: string) => {
    setOpen(false);
    if (city === current) return;
    const f = new FormData();
    f.set("city", city);
    start(async () => {
      await setHomeCityAction(f);
      router.refresh();
    });
  };

  return (
    <span ref={wrap} className="city-picker">
      <button type="button" className="city-change" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)} disabled={pending}>
        {pending ? "Saving…" : "Change"}
      </button>
      {open && (
        <div ref={panel} className="city-panel" role="menu" aria-label="Home city">
          <p className="city-panel-label">Your home city</p>
          <div className="city-options">
            {cities.map((c) => (
              <button key={c} type="button" role="menuitemradio" aria-checked={c === current} className={`city-option${c === current ? " on" : ""}`} onClick={() => choose(c)}>
                {c}
              </button>
            ))}
          </div>
        </div>
      )}
    </span>
  );
}
