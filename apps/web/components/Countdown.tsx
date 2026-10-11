"use client";

import { useEffect, useState } from "react";
import { shortCountdown } from "@/lib/format";

/** Live countdown with tabular figures; re-renders every 30 s. */
export function Countdown({ to, className }: { to: string; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className={className} suppressHydrationWarning>
      {shortCountdown(to, now)}
    </span>
  );
}
