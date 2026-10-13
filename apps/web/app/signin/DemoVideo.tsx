"use client";

import { useEffect, useRef, useState } from "react";
import { gsap, prefersReducedMotion } from "@/components/motion";

/**
 * "Watch the demo": a screening-room button on the sign-in page that opens the walkthrough video
 * in a full-screen player. Esc, the close button or a click outside closes it.
 */
export function DemoVideo({ src, poster }: { src: string; poster?: string }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      if (!prefersReducedMotion()) gsap.fromTo(d.querySelector(".demo-frame"), { scale: 0.86, rotate: -2, opacity: 0 }, { scale: 1, rotate: 0, opacity: 1, duration: 0.45, ease: "back.out(1.6)" });
    }
    if (!open && d.open) {
      d.querySelector("video")?.pause();
      d.close();
    }
  }, [open]);

  return (
    <>
      <button type="button" className="act demo-btn" onClick={() => setOpen(true)}>
        <span className="demo-play" aria-hidden="true">
          ▶
        </span>
        <span className="act-text">
          <span className="act-kicker">Now showing</span>Watch the demo
        </span>
      </button>
      <dialog ref={dialog} className="demo-dialog" aria-label="Early Access demo video" onClose={() => setOpen(false)} onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
        <div className="demo-frame">
          <button type="button" className="demo-close" onClick={() => setOpen(false)} aria-label="Close the video">
            ×
          </button>
          {/* preload="none": the video only downloads when someone presses play. */}
          <video src={src} poster={poster} controls preload="none" playsInline />
        </div>
      </dialog>
    </>
  );
}
