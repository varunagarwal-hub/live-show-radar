import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

/** Constant-time comparison of a presented secret against the expected one. */
export function secretMatches(presented: string | null | undefined, expected: string | undefined): boolean {
  if (!presented || !expected) return false;
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
