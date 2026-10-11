import type { Extraction } from "@radar/core";
import { cityFromAddress, cityInText, normalizeName, istDate, type WatchArtist } from "@radar/core";
import { extractLdEvents, ldCity, ldEventText, ldOffers, ldVenue, offerPrice, offerStatus, type LdEvent } from "./jsonld";
import type { RawItem, SourceContext, SourceHealth, SourceName } from "./types";
import { BlockedError } from "./types";

export const EARLY_BIRD_RE = /\b(early[\s-]?bird|eb|phase[\s-]?(1|i|one)|pre[\s-]?sale|first\s+\d+\s+tickets?)\b/i;

/** Which watched artist's name (or alias) appears in a listing title. */
export function artistInTitle(title: string, watchlist: WatchArtist[]): WatchArtist | null {
  const t = ` ${normalizeName(title)} `;
  for (const a of watchlist) {
    if (a.muted) continue;
    if ([a.name, ...a.aliases].some((n) => { const nn = normalizeName(n); return nn.length >= 3 && t.includes(` ${nn} `); })) return a;
  }
  return null;
}

/**
 * Builds the extraction straight from schema.org data, so structured listings that name a
 * watched artist don't spend an LLM call. Anything not in the data stays null/unknown.
 */
/** Event city: title first ("Live in Bengaluru"), then the listing page's city, then the address. */
export function ldEventCity(e: LdEvent, listingCity?: string | null): string | null {
  const fromTitle = cityInText(e.name);
  if (fromTitle) return fromTitle;
  if (listingCity) return listingCity;
  const raw = ldCity(e);
  return raw ? cityFromAddress(raw) : null;
}

export function structuredExtraction(e: LdEvent, artistName: string, now = new Date(), listingCity?: string | null): Extraction {
  const offers = ldOffers(e);
  const tiers = offers.slice(0, 12).map((o) => ({ name: o.name ?? "General", price_inr: offerPrice(o), status: offerStatus(o, now) }));
  const eb = offers.filter((o) => EARLY_BIRD_RE.test(o.name ?? ""));
  let ebStatus: Extraction["early_bird"]["status"] = "unknown";
  if (eb.length) {
    const st = eb.map((o) => offerStatus(o, now));
    ebStatus = st.includes("open") ? "open" : st.includes("upcoming") ? "opening" : st.every((s) => s === "sold_out") ? "sold_out" : "unknown";
  } else if (offers.length > 1) {
    // Only a full tier list (event detail page) can say there is no early-bird. Listing pages carry
    // one summary offer, which says nothing either way.
    ebStatus = "none";
  }
  const ebOffer = eb[0];
  const futureStarts = offers.map((o) => o.availabilityStarts ?? o.validFrom).filter((s): s is string => !!s && Date.parse(s) > now.getTime()).sort();
  const start = e.startDate ? new Date(e.startDate) : null;
  const end = e.endDate ? new Date(e.endDate) : null;
  const date = start && !Number.isNaN(start.getTime()) ? istDate(start) : null;
  const endDate = end && !Number.isNaN(end.getTime()) && date && istDate(end) !== date ? istDate(end) : null;
  return {
    is_show_announcement: !/cancel|postpone/i.test(e.eventStatus ?? ""),
    artist_names: [artistName],
    city: ldEventCity(e, listingCity),
    venue: ldVenue(e),
    date,
    end_date: endDate,
    event_type: /fest/i.test(e.name) ? "festival" : "concert",
    tiers,
    early_bird: {
      status: ebStatus,
      opens_at: ebStatus === "opening" ? (ebOffer?.availabilityStarts ?? ebOffer?.validFrom ?? null) : null,
      closes_at: ebOffer?.availabilityEnds && ebStatus === "open" && (!end || Date.parse(ebOffer.availabilityEnds) < end.getTime()) ? ebOffer.availabilityEnds : null,
    },
    sale_starts_at: futureStarts[0] ?? null,
    ticket_url: e.url ?? null,
    confidence: 0.95,
    evidence: e.name.slice(0, 200),
    other_dates: [],
    country: "India",
  };
}

/** Converts JSON-LD events on a page into raw items, attaching structured extractions where possible. */
export function ldEventsToItems(html: string, source: SourceName, site: string, watchlist: WatchArtist[], meta: Record<string, unknown>, now = new Date()): RawItem[] {
  return extractLdEvents(html)
    .filter((e) => e.url || e.name)
    .map((e) => {
      const artist = artistInTitle(e.name, watchlist);
      return {
        source,
        externalId: e.url ?? `${site}:${e.name}:${e.startDate ?? ""}`,
        url: e.url ?? null,
        text: ldEventText(e, site, now),
        imageUrl: Array.isArray(e.image) ? (e.image[0] ?? null) : (e.image ?? null),
        publishedAt: null,
        meta: { ...meta, title: e.name, ...(artist ? { structured: structuredExtraction(e, artist.name, now, (meta.city as string | undefined) ?? null), artistId: artist.id } : {}) },
      };
    });
}

/** Shared bookkeeping for listing adapters: poll interval, health, blocked detection. */
export abstract class ListingSource {
  abstract readonly name: SourceName;
  protected last: SourceHealth = { ok: true, itemCount: 0, error: null };
  protected skipped = false;

  constructor(protected readonly intervalMinutes: number) {}

  health(): SourceHealth & { skipped?: boolean } {
    return { ...this.last, skipped: this.skipped };
  }

  /** Returns false when the adapter ran recently enough to skip this poll. */
  protected due(ctx: SourceContext): boolean {
    const last = ctx.cursors[`${this.name}:last`];
    if (last && ctx.now.getTime() - Date.parse(last) < (this.intervalMinutes - 5) * 60_000) {
      this.skipped = true;
      return false;
    }
    ctx.cursors[`${this.name}:last`] = ctx.now.toISOString();
    return true;
  }

  protected record(items: RawItem[], errors: unknown[], notes: string[] = []): void {
    const blocked = errors.some((e) => e instanceof BlockedError);
    const msg = errors.map((e) => (e as Error).message).slice(0, 3).join("; ") || null;
    // Partial failures still count as a run with output; total failure counts against health.
    this.last = { ok: items.length > 0 || errors.length === 0, itemCount: items.length, error: msg, blocked, notes };
  }
}
