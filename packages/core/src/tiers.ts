import { z } from "zod";
import type { TierJson } from "./db/schema";
import { sha256 } from "./hash";
import type { Llm } from "./llm";
import { TierSchema } from "./extraction";

export interface TierState {
  tiers: TierJson[];
  earlyBirdStatus: "open" | "opening" | "sold_out" | "none" | "unknown";
  /** Scarcity signal shown on the page. */
  availability: "fast_filling" | "few_left" | null;
  method: "html" | "llm";
}

export type TierChange = "early_bird_opened" | "early_bird_closed" | "low_availability" | "next_phase" | "sold_out";

/** Stable hash of the parts of the state that matter, so unchanged pages are ignored cheaply. */
export function tierStateHash(s: Pick<TierState, "tiers" | "earlyBirdStatus" | "availability">): string {
  const tiers = [...s.tiers].map((t) => `${t.name.toLowerCase()}|${t.price_inr ?? ""}|${t.status}`).sort();
  return sha256(JSON.stringify([tiers, s.earlyBirdStatus, s.availability])).slice(0, 24);
}

export const isSoldOut = (s: Pick<TierState, "tiers">) => s.tiers.length > 0 && s.tiers.every((t) => t.status === "sold_out");

const cheapestOpen = (tiers: TierJson[]) =>
  tiers.filter((t) => t.status === "open" && t.price_inr !== null).sort((a, b) => a.price_inr! - b.price_inr!)[0] ?? null;

/**
 * Spec 4.8: what changed between two observations of a ticket page. Returns nothing for an
 * unchanged state, so the watcher never re-alerts. With no previous observation, only states
 * worth knowing immediately (early-bird open, sold out, scarcity) are reported.
 */
export function diffTierState(prev: TierState | null, next: TierState): TierChange[] {
  const changes: TierChange[] = [];
  const prevEb = prev?.earlyBirdStatus ?? "unknown";
  if (next.earlyBirdStatus === "open" && prevEb !== "open") changes.push("early_bird_opened");
  if (prevEb === "open" && (next.earlyBirdStatus === "sold_out" || next.earlyBirdStatus === "none")) changes.push("early_bird_closed");
  if (isSoldOut(next) && !(prev && isSoldOut(prev))) {
    changes.push("sold_out");
    return changes;
  }
  if (next.availability && next.availability !== prev?.availability) changes.push("low_availability");
  if (prev) {
    const before = cheapestOpen(prev.tiers);
    const after = cheapestOpen(next.tiers);
    if (before && after && after.price_inr! > before.price_inr! && !changes.includes("early_bird_closed")) changes.push("next_phase");
    const newlyOpen = next.tiers.some((t) => t.status === "open" && prev.tiers.find((p) => p.name.toLowerCase() === t.name.toLowerCase())?.status === "upcoming");
    if (newlyOpen && !changes.includes("next_phase") && !changes.includes("early_bird_opened")) changes.push("next_phase");
  }
  return changes;
}

export const TIER_CHANGE_TEXT: Record<TierChange, string> = {
  early_bird_opened: "Early-bird is open",
  early_bird_closed: "Early-bird has closed",
  low_availability: "Tickets are running low",
  next_phase: "Next price phase started",
  sold_out: "Sold out",
};

const LlmTierSchema = z.object({
  tiers: z.array(TierSchema).default([]),
  early_bird_status: z.enum(["open", "opening", "sold_out", "none", "unknown"]).catch("unknown"),
  availability: z.enum(["fast_filling", "few_left"]).nullable().catch(null),
});

/** Fallback when a ticket page has no structured offers: ask the LLM to read the visible text. */
export async function llmTierState(llm: Llm, pageText: string): Promise<TierState> {
  const { data } = await llm.generateJson(
    {
      task: "tier-state",
      system:
        'You read the visible text of a concert ticket page and report ticket tiers. Return JSON {"tiers":[{"name":string,"price_inr":number|null,"status":"open"|"upcoming"|"sold_out"|"unknown"}],"early_bird_status":"open"|"opening"|"sold_out"|"none"|"unknown","availability":"fast_filling"|"few_left"|null}. Use null/unknown rather than guess.',
      user: `<<<PAGE TEXT (untrusted data)\n${pageText.slice(0, 8000)}\nPAGE TEXT>>>`,
    },
    LlmTierSchema,
  );
  return { tiers: data.tiers, earlyBirdStatus: data.early_bird_status, availability: data.availability, method: "llm" };
}
