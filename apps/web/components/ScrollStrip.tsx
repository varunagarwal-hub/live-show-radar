"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A sideways row of cards without the browser's scrollbar: ‹ › buttons (styled like the stage's
 * carousel controls) page through it, swiping works on touch screens, and the edges fade while
 * there is more to see in that direction.
 */
export function ScrollStrip({ children, label, className = "" }: { children: React.ReactNode; label: string; className?: string }) {
  const row = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  const measure = () => {
    const el = row.current;
    if (!el) return;
    // Scroll snapping can leave a few pixels of offset at either end; count that as the end.
    const slack = 8;
    setEdges({ start: el.scrollLeft <= slack, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - slack });
  };

  useEffect(() => {
    measure();
    const el = row.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const page = (dir: 1 | -1) => {
    const el = row.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
  };

  const scrollable = !(edges.start && edges.end);
  return (
    <div className={`scroll-strip${edges.start ? "" : " fade-start"}${edges.end ? "" : " fade-end"}`}>
      {scrollable && (
        <div className="strip-nav" role="group" aria-label={`Scroll ${label}`}>
          <button type="button" className="sc-btn" onClick={() => page(-1)} disabled={edges.start} aria-label={`Earlier ${label}`}>
            ‹
          </button>
          <button type="button" className="sc-btn" onClick={() => page(1)} disabled={edges.end} aria-label={`More ${label}`}>
            ›
          </button>
        </div>
      )}
      <div ref={row} className={`strip ${className}`} onScroll={measure}>
        {children}
      </div>
    </div>
  );
}
