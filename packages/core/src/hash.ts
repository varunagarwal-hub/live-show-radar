import { createHash } from "node:crypto";

export const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

/** Content hash ignores whitespace and case noise so trivial re-renders don't look new. */
export function contentHash(text: string): string {
  return sha256(text.replace(/\s+/g, " ").trim().toLowerCase()).slice(0, 32);
}

/** Spec 4.3: hash(source + external ID + content hash). */
export function dedupKey(source: string, externalId: string, text: string): string {
  return sha256(`${source}\u0000${externalId}\u0000${contentHash(text)}`).slice(0, 40);
}
