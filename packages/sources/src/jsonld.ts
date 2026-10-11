import { z } from "zod";

/**
 * schema.org Event / Offer data embedded as JSON-LD. District serves it on listing and event
 * pages, and many ticketing sites do the same, so parsers share this instead of scraping markup.
 */
const Place = z
  .object({
    name: z.string().optional(),
    address: z.union([z.string(), z.object({ addressLocality: z.string().optional(), addressRegion: z.string().optional(), addressCountry: z.string().optional() }).passthrough()]).optional(),
  })
  .passthrough();

const Offer = z
  .object({
    name: z.string().optional(),
    price: z.union([z.number(), z.string()]).optional(),
    lowPrice: z.union([z.number(), z.string()]).optional(),
    availability: z.string().optional(),
    validFrom: z.string().optional(),
    availabilityStarts: z.string().optional(),
    availabilityEnds: z.string().optional(),
    url: z.string().optional(),
  })
  .passthrough();

const AggregateOffer = Offer.extend({ offers: z.array(Offer).optional(), highPrice: z.union([z.number(), z.string()]).optional() });

export const LdEvent = z
  .object({
    "@type": z.union([z.string(), z.array(z.string())]),
    name: z.string(),
    url: z.string().optional(),
    description: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    eventStatus: z.string().optional(),
    image: z.union([z.string(), z.array(z.string())]).optional(),
    location: z.union([Place, z.array(Place)]).optional(),
    performer: z.unknown().optional(),
    offers: z.union([AggregateOffer, z.array(Offer)]).optional(),
  })
  .passthrough();
export type LdEvent = z.infer<typeof LdEvent>;
export type LdOffer = z.infer<typeof Offer>;

const isEventType = (t: unknown) => (Array.isArray(t) ? t : [t]).some((x) => typeof x === "string" && /Event$/.test(x));

/** Every schema.org Event in the page's JSON-LD, including ones nested in ItemLists and @graph. */
export function extractLdEvents(html: string): LdEvent[] {
  const out: LdEvent[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    if (isEventType(o["@type"])) {
      const parsed = LdEvent.safeParse(o);
      if (parsed.success) out.push(parsed.data);
      return;
    }
    for (const key of ["@graph", "itemListElement", "item", "mainEntity"]) if (key in o) visit(o[key]);
  };
  for (let m = re.exec(html); m; m = re.exec(html)) {
    try {
      visit(JSON.parse(m[1]!.trim()));
    } catch {
      // A malformed block shouldn't hide the others.
    }
  }
  return out;
}

export function ldCity(e: LdEvent): string | null {
  const loc = Array.isArray(e.location) ? e.location[0] : e.location;
  if (!loc?.address) return null;
  if (typeof loc.address === "string") {
    // "5HFX+WHJ, Yelahanka, Tharahunise, Karnataka 562157, India" → let the city normaliser decide.
    return loc.address;
  }
  return loc.address.addressLocality ?? null;
}

export function ldVenue(e: LdEvent): string | null {
  const loc = Array.isArray(e.location) ? e.location[0] : e.location;
  return loc?.name ?? null;
}

export function ldOffers(e: LdEvent): LdOffer[] {
  if (!e.offers) return [];
  if (Array.isArray(e.offers)) return e.offers;
  return e.offers.offers?.length ? e.offers.offers : [e.offers];
}

const AVAIL: Record<string, "open" | "upcoming" | "sold_out" | "unknown"> = {
  instock: "open",
  limitedavailability: "open",
  onlineonly: "open",
  preorder: "upcoming",
  presale: "upcoming",
  soldout: "sold_out",
  outofstock: "sold_out",
  discontinued: "sold_out",
};

export function offerStatus(o: LdOffer, now = new Date()): "open" | "upcoming" | "sold_out" | "unknown" {
  const key = (o.availability ?? "").split("/").pop()?.toLowerCase() ?? "";
  const s = AVAIL[key] ?? "unknown";
  const starts = o.availabilityStarts ?? o.validFrom;
  if (s === "open" && starts && Date.parse(starts) > now.getTime()) return "upcoming";
  if (s !== "sold_out" && o.availabilityEnds && Date.parse(o.availabilityEnds) < now.getTime()) return "sold_out";
  return s;
}

export const offerPrice = (o: LdOffer): number | null => {
  const v = o.price ?? o.lowPrice;
  const n = typeof v === "number" ? v : v ? Number(String(v).replace(/[^\d.]/g, "")) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Flatten an event into readable text for the extractor and the dedup content hash. */
export function ldEventText(e: LdEvent, site: string, now = new Date()): string {
  const offers = ldOffers(e);
  const lines = [
    `${site} listing: ${e.name}`,
    ldVenue(e) ? `Venue: ${ldVenue(e)}` : null,
    ldCity(e) ? `Location: ${ldCity(e)}` : null,
    e.startDate ? `Starts: ${e.startDate}` : null,
    e.endDate ? `Ends: ${e.endDate}` : null,
    e.eventStatus ? `Status: ${e.eventStatus.split("/").pop()}` : null,
    ...offers.slice(0, 12).map((o) => `Ticket: ${o.name ?? "General"} | ₹${offerPrice(o) ?? "?"} | ${offerStatus(o, now)}${o.validFrom ? ` | sale from ${o.validFrom}` : ""}`),
    e.description ? `About: ${e.description.slice(0, 800)}` : null,
    e.url ? `URL: ${e.url}` : null,
  ];
  return lines.filter(Boolean).join("\n");
}
