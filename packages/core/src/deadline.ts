import type { TierJson } from "./db/schema";
import { salesStarted } from "./rules";
import { istInstant } from "./time";

export interface DeadlineInput {
  date: string | null;
  earlyBirdStatus: "open" | "opening" | "sold_out" | "none" | "unknown";
  earlyBirdOpensAt: Date | null;
  earlyBirdClosesAt: Date | null;
  saleStartsAt: Date | null;
  tiers: TierJson[];
}

export type DeadlineKind = "early_bird_closes" | "early_bird_opens" | "sale_starts";

export interface Deadline {
  at: Date;
  kind: DeadlineKind;
}

/**
 * The decide-by deadline for a Maybe show (spec 4.13): the early-bird close time while early-bird
 * is available, otherwise the moment tickets go on sale if they aren't live yet (early-bird opening
 * counts as going on sale). Null when nothing is pending: the show is simply on sale.
 */
export function decideByDeadline(e: DeadlineInput, now = new Date()): Deadline | null {
  const future = (d: Date | null): d is Date => d !== null && d.getTime() > now.getTime();
  if (e.date && istInstant(e.date, "23:59").getTime() < now.getTime()) return null;

  if ((e.earlyBirdStatus === "open" || e.earlyBirdStatus === "unknown") && future(e.earlyBirdClosesAt)) {
    return { at: e.earlyBirdClosesAt, kind: "early_bird_closes" };
  }
  if (!salesStarted(e, now) || e.earlyBirdStatus === "opening") {
    const options: Deadline[] = [];
    if (future(e.earlyBirdOpensAt) && e.earlyBirdStatus !== "sold_out" && e.earlyBirdStatus !== "none") {
      options.push({ at: e.earlyBirdOpensAt, kind: "early_bird_opens" });
    }
    if (future(e.saleStartsAt)) options.push({ at: e.saleStartsAt, kind: "sale_starts" });
    options.sort((a, b) => a.at.getTime() - b.at.getTime());
    if (options[0]) return options[0];
  }
  return null;
}

export const DEADLINE_LABEL: Record<DeadlineKind, string> = {
  early_bird_closes: "Early-bird ends",
  early_bird_opens: "Early-bird opens",
  sale_starts: "Tickets go on sale",
};
