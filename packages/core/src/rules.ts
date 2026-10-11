import { radarConfig, type RadarConfig } from "@radar/config";
import type { TierJson } from "./db/schema";
import { isHomeCity } from "./cities";

export type Urgency = "urgent" | "normal" | "possible";

export interface UrgencyInput {
  priorityTier: "A" | "B" | "C";
  city: string | null;
  earlyBirdStatus: "open" | "opening" | "sold_out" | "none" | "unknown";
  saleStartsAt: Date | null;
  tiers: TierJson[];
  confidence: number;
}

/**
 * Ticket sales count as started when the sale start has passed, or any tier is on sale or sold
 * out. With no sale time and no tier info we assume sales haven't started: missing an early-bird
 * costs far more than one extra loud alert.
 */
export function salesStarted(i: Pick<UrgencyInput, "saleStartsAt" | "tiers">, now = new Date()): boolean {
  if (i.saleStartsAt && i.saleStartsAt.getTime() <= now.getTime()) return true;
  return i.tiers.some((t) => t.status === "open" || t.status === "sold_out");
}

/**
 * Spec 4.6.
 * - urgent: tier A artist (any Indian city, any ticket state), OR home city with early-bird open,
 *   opening, or unknown while sales haven't started.
 * - normal: any other matched show in India.
 * - possible: below the confidence threshold → a quiet "please check" message instead.
 */
export function computeUrgency(i: UrgencyInput, now = new Date(), cfg: RadarConfig = radarConfig): Urgency {
  if (i.confidence < cfg.confidenceThreshold) return "possible";
  if (cfg.urgency.urgentTiers.includes(i.priorityTier)) return "urgent";
  if (isHomeCity(i.city)) {
    const eb = i.earlyBirdStatus;
    if (eb === "open" && cfg.urgency.homeCityEarlyBirdStates.includes("open")) return "urgent";
    if (eb === "opening" && cfg.urgency.homeCityEarlyBirdStates.includes("opening")) return "urgent";
    if (eb === "unknown" && cfg.urgency.homeCityEarlyBirdStates.includes("unknown") && !salesStarted(i, now)) return "urgent";
  }
  return "normal";
}

export const URGENCY_EMOJI: Record<Urgency, string> = { urgent: "🔴", normal: "🟠", possible: "🟡" };
