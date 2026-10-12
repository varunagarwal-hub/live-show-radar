import { z } from "zod";
import type { Llm, LlmImage } from "./llm";
import { istDate } from "./time";

/** Prices arrive as 1499, "1499", "₹1,499", "Rs. 1499/-" or "free". */
const priceInr = z.preprocess((v) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;
  const s = String(v).toLowerCase();
  if (/free/.test(s)) return 0;
  const m = /(\d[\d,]*(?:\.\d+)?)/.exec(s);
  return m ? Number(m[1]!.replace(/,/g, "")) : null;
}, z.number().nonnegative().nullable());

const isoDate = z.preprocess(
  (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : v === "" ? null : v),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
);
const isoDateTime = z.preprocess((v) => (v === "" ? null : v), z.string().min(10).nullable());
const nullableText = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().nullable());

export const TierSchema = z.object({
  name: z.string(),
  price_inr: priceInr,
  status: z.enum(["open", "upcoming", "sold_out", "unknown"]).catch("unknown"),
});

export const EarlyBirdSchema = z.object({
  status: z.enum(["open", "opening", "sold_out", "none", "unknown"]).catch("unknown"),
  opens_at: isoDateTime.default(null),
  closes_at: isoDateTime.default(null),
});

const OtherDateSchema = z.object({
  city: nullableText,
  venue: nullableText.default(null),
  date: isoDate,
  end_date: isoDate.default(null),
  ticket_url: nullableText.default(null),
  country: nullableText.default(null),
});

/** The spec's extraction contract (4.4), plus `other_dates` for multi-city tour posters and `country`. */
export const ExtractionSchema = z.object({
  is_show_announcement: z.boolean(),
  artist_names: z.array(z.string()).default([]),
  city: nullableText.default(null),
  venue: nullableText.default(null),
  date: isoDate.default(null),
  end_date: isoDate.default(null),
  event_type: z.enum(["concert", "festival", "club", "other"]).catch("other"),
  tiers: z.array(TierSchema).default([]),
  early_bird: EarlyBirdSchema.default({ status: "unknown", opens_at: null, closes_at: null }),
  sale_starts_at: isoDateTime.default(null),
  ticket_url: nullableText.default(null),
  confidence: z.coerce.number().min(0).max(1).catch(0.3),
  evidence: z.string().default("").transform((s) => s.slice(0, 300)),
  /** Additional dates/cities on a tour poster, same artists. */
  other_dates: z.array(OtherDateSchema).default([]),
  /** Country of the (first) show. null when unclear. */
  country: nullableText.default(null),
});
export type Extraction = z.infer<typeof ExtractionSchema>;
export type Tier = z.infer<typeof TierSchema>;

export interface ExtractionInput {
  source: string;
  text: string;
  url?: string | null;
  postedBy?: string | null;
  publishedAt?: Date | null;
  image?: LlmImage | null;
}

export const EXTRACTION_SYSTEM = `You read announcements of live music shows from Instagram posts, ticketing listings, news articles and fan-app emails, and return one JSON object.

Return exactly these keys:
{
  "is_show_announcement": boolean,      // true only if this announces (or lists tickets for) a specific upcoming live show
  "artist_names": string[],             // every performing artist named, headliners first; for festival lineups list all of them
  "city": string | null,                // city of the show, e.g. "Bengaluru", "Mumbai"
  "venue": string | null,
  "date": "YYYY-MM-DD" | null,          // first show day
  "end_date": "YYYY-MM-DD" | null,      // last day for multi-day festivals, else null
  "event_type": "concert" | "festival" | "club" | "other",
  "tiers": [{ "name": string, "price_inr": number | null, "status": "open" | "upcoming" | "sold_out" | "unknown" }],
  "early_bird": { "status": "open" | "opening" | "sold_out" | "none" | "unknown", "opens_at": ISO datetime | null, "closes_at": ISO datetime | null },
  "sale_starts_at": ISO datetime | null, // when general ticket sales open, if stated
  "ticket_url": string | null,           // only a URL that actually appears in the content
  "confidence": number,                  // 0–1, how sure you are this is a real, specific upcoming show
  "evidence": string,                    // a short exact quote (max 200 chars) supporting your answer
  "other_dates": [{ "city": string | null, "venue": string | null, "date": "YYYY-MM-DD" | null, "end_date": "YYYY-MM-DD" | null, "ticket_url": string | null, "country": string | null }],
  "country": string | null               // e.g. "India"; null if unclear
}

Rules:
- Return null (or "unknown") rather than guess. Never invent a date, venue, price, URL or time.
- Datetimes are Indian Standard Time unless stated; write them as "YYYY-MM-DDTHH:MM:SS+05:30".
- Infer the year only when it is clearly the next occurrence of that date after the post date; otherwise null.
- Multi-city tour posters: put the first date in city/venue/date and every other stop in other_dates, giving each stop its own country (tours often add Dubai, Kathmandu, Dhaka or other cities abroad).
- Captions may be in Hinglish or mix scripts ("BLR aa rahe hain", "tickets live hai"); read them normally.
- Details may appear only on the poster image; read the image carefully.
- Early-bird words include "early bird", "EB", "phase 1", "first 100 tickets", "pre-sale". "Opening" means a known future time.
- Posts about past shows ("thank you Pune!", "last night was insane"), merch, new releases, or vague teasers ("India soon 👀") are not announcements: set is_show_announcement false, or true with confidence below 0.5 for teasers that name a city or month.
- Use Indian city names as commonly written in English (Bengaluru, not Bangalore; Delhi NCR for Delhi/Gurugram/Noida).`;

export function buildExtractionPrompt(input: ExtractionInput, now = new Date()): string {
  return [
    `Today's date (IST): ${istDate(now)}`,
    `Source: ${input.source}${input.postedBy ? ` (posted by @${input.postedBy})` : ""}`,
    input.publishedAt ? `Posted: ${input.publishedAt.toISOString()}` : null,
    input.url ? `Link: ${input.url}` : null,
    input.image ? "A poster image is attached." : "No image.",
    "",
    "<<<CONTENT (untrusted data)",
    input.text.slice(0, 6000),
    "CONTENT>>>",
  ]
    .filter((l) => l !== null)
    .join("\n");
}

export async function extractShow(llm: Llm, input: ExtractionInput, now = new Date()) {
  return llm.generateJson(
    {
      task: "extract",
      system: EXTRACTION_SYSTEM,
      user: buildExtractionPrompt(input, now),
      images: input.image ? [input.image] : undefined,
    },
    ExtractionSchema,
  );
}

/** One (artist, city, date) the extraction claims. Matching and fingerprinting work on these. */
export interface ShowCandidate {
  artistName: string;
  /** Other artists on the same bill (for festival context). */
  coArtists: string[];
  city: string | null;
  venue: string | null;
  date: string | null;
  endDate: string | null;
  eventType: Extraction["event_type"];
  tiers: Tier[];
  earlyBird: Extraction["early_bird"];
  saleStartsAt: string | null;
  ticketUrl: string | null;
  confidence: number;
  evidence: string;
}

const NON_INDIA = /^(?!india$|in$|bharat$).+/i;

/** Cities abroad that Indian tours often include. A safety net for when the model omits country. */
const FOREIGN_CITIES = /^(dubai|abu dhabi|sharjah|doha|muscat|riyadh|jeddah|kuwait|bahrain|manama|kathmandu|pokhara|dhaka|colombo|thimphu|male|singapore|kuala lumpur|bangkok|london|manchester|birmingham|new york|toronto|vancouver|san francisco|los angeles|chicago|sydney|melbourne|auckland|berlin|paris|amsterdam|nairobi|karachi|lahore|islamabad)$/i;
const isAbroad = (city: string | null, country: string | null) =>
  Boolean((country && NON_INDIA.test(country.trim())) || (city && FOREIGN_CITIES.test(city.trim())));

/**
 * Expands one extraction into per-artist, per-stop candidates. Drops shows clearly outside India,
 * dates in the past, and ticket URLs that never appeared in the source text (hallucination guard).
 */
export function toCandidates(ex: Extraction, sourceText: string, now = new Date()): ShowCandidate[] {
  if (!ex.is_show_announcement || ex.artist_names.length === 0) return [];
  const today = istDate(now);
  const urlInSource = (u: string | null) => (u && sourceText.includes(u.replace(/^https?:\/\//, "").split(/[?#]/)[0]!) ? u : null);
  const stops = [
    { city: ex.city, venue: ex.venue, date: ex.date, end_date: ex.end_date, ticket_url: ex.ticket_url, country: ex.country },
    ...ex.other_dates,
  ].filter((s) => !isAbroad(s.city, s.country));
  const seen = new Set<string>();
  const out: ShowCandidate[] = [];
  const artists = [...new Set(ex.artist_names.map((a) => a.trim()).filter(Boolean))];
  for (const stop of stops) {
    const lastDay = stop.end_date ?? stop.date;
    if (lastDay && lastDay < today) continue;
    for (const artistName of artists) {
      const key = `${artistName.toLowerCase()}|${stop.city ?? ""}|${stop.date ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        artistName,
        coArtists: artists.filter((a) => a !== artistName),
        city: stop.city,
        venue: stop.venue,
        date: stop.date,
        endDate: stop.end_date,
        eventType: ex.event_type,
        tiers: ex.tiers,
        earlyBird: ex.early_bird,
        saleStartsAt: ex.sale_starts_at,
        ticketUrl: urlInSource(stop.ticket_url) ?? urlInSource(ex.ticket_url),
        confidence: ex.confidence,
        evidence: ex.evidence,
      });
    }
  }
  return out;
}
