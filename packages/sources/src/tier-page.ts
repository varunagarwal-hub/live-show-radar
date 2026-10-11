import * as cheerio from "cheerio";
import type { TierState } from "@radar/core";
import { extractLdEvents, ldOffers, offerPrice, offerStatus } from "./jsonld";
import { EARLY_BIRD_RE } from "./ticketing";

const FAST = /\b(fast[\s-]?filling|filling fast|selling fast|high demand|in demand)\b/i;
const FEW = /\b(few (tickets |seats )?left|last few|almost sold[\s-]?out|limited (tickets|seats|availability)|only \d+ (tickets|seats) left)\b/i;
const SOLD = /\b(sold[\s-]?out|house ?full)\b/i;

/** Visible text of a page, minus scripts, styles and FAQ boilerplate. */
export function visibleText(html: string): string {
  // Space out tags so adjacent blocks don't fuse into one word ("LiveFast filling").
  const $ = cheerio.load(html.replace(/></g, "> <"));
  $("script, style, noscript, svg, footer, [itemtype*='FAQPage']").remove();
  return $("body").text().replace(/\s+/g, " ").trim();
}

/**
 * Reads the ticket state from an event page using structured data first. Returns
 * `parseable: false` when the page has no offers we can read, so the tier watcher can fall back
 * to the LLM on the visible text.
 */
export function parseTierPage(html: string, now = new Date()): TierState & { parseable: boolean; pageText: string } {
  const pageText = visibleText(html).slice(0, 12_000);
  const events = extractLdEvents(html);
  const offers = events.flatMap(ldOffers);
  const availability = FEW.test(pageText) ? "few_left" : FAST.test(pageText) ? "fast_filling" : null;
  if (!offers.length) {
    return { tiers: [], earlyBirdStatus: "unknown", availability, method: "html", parseable: false, pageText };
  }
  const tiers = offers.slice(0, 20).map((o) => ({ name: (o.name ?? "General").trim(), price_inr: offerPrice(o), status: offerStatus(o, now) }));
  const eb = tiers.filter((t) => EARLY_BIRD_RE.test(t.name));
  const earlyBirdStatus: TierState["earlyBirdStatus"] = eb.length
    ? eb.some((t) => t.status === "open")
      ? "open"
      : eb.some((t) => t.status === "upcoming")
        ? "opening"
        : eb.every((t) => t.status === "sold_out")
          ? "sold_out"
          : "unknown"
    : "none";
  const allSold = tiers.every((t) => t.status === "sold_out") || (SOLD.test(pageText) && !tiers.some((t) => t.status === "open" || t.status === "upcoming"));
  return { tiers, earlyBirdStatus, availability: allSold ? null : availability, method: "html", parseable: true, pageText };
}
