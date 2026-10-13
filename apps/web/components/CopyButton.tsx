"use client";

import { useState } from "react";

/** Copies a value (calendar address, invite link) and says so for a moment. */
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        } catch {
          window.prompt("Copy this:", value);
        }
      }}
    >
      {done ? "Copied ✓" : label}
    </button>
  );
}
