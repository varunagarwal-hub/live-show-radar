import { z } from "zod";

/**
 * Live Show Radar configuration. Everything here is non-secret and safe to commit.
 * Secrets live in GitHub Actions secrets and Vercel env vars (see .env.example).
 */

const CitySchema = z.object({
  name: z.string(),
  /** Lower-case strings that identify this city in captions, listings and news. */
  aliases: z.array(z.string()),
  /** Slugs each ticketing site uses for this city. */
  slugs: z.object({
    district: z.string().optional(),
    bookmyshow: z.string().optional(),
    skillbox: z.string().optional(),
  }),
  /** IATA code for prefilled Google Flights links. */
  airport: z.string().optional(),
});

export const RadarConfigSchema = z.object({
  homeCity: z.string(),
  cities: z.array(CitySchema).min(1),
  timezone: z.literal("Asia/Kolkata"),
  confidenceThreshold: z.number().min(0).max(1),
  /** Below this, a fuzzy name match is discarded without asking the LLM. */
  fuzzyMatchFloor: z.number().min(0).max(1),
  intervals: z.object({
    pollMinutes: z.number().int().positive(),
    tiersMinutes: z.number().int().positive(),
    /** Ticketing listing pages are polled at most this often. */
    ticketingMinutes: z.number().int().positive(),
    /** How often each Instagram handle is polled, by priority tier ("account" = promoters and venues). */
    instagramMinutesByTier: z.object({ A: z.number(), B: z.number(), C: z.number(), account: z.number() }),
    /** Refresh the cached snapshot from the database at least this often. */
    snapshotMaxAgeMinutes: z.number().int().positive(),
  }),
  instagram: z.object({
    /** Business Discovery calls allowed per hour, kept under the platform limit. */
    callsPerHour: z.number().int().positive(),
    postsPerCall: z.number().int().min(1).max(25),
    /** Refresh the long-lived token when it has fewer than this many days left. */
    refreshWhenDaysLeft: z.number().int().positive(),
  }),
  urgency: z.object({
    /** Artists in these tiers are urgent in any Indian city. */
    urgentTiers: z.array(z.enum(["A", "B", "C"])),
    /** Home-city shows are urgent while early-bird is in one of these states. */
    homeCityEarlyBirdStates: z.array(z.enum(["open", "opening", "unknown"])),
  }),
  reminders: z.object({
    /** Send the sale-start reminder on the first run within this many minutes before sale start. */
    saleStartWindowMinutes: z.number().int().positive(),
    /** Send the decide-by reminder on the first run within this many hours before the deadline. */
    decideByWindowHours: z.number().int().positive(),
  }),
  health: z.object({
    failureRunsBeforeUnhealthy: z.number().int().positive(),
    /** A source returning zero items for longer than this is unhealthy. */
    zeroItemsHours: z.number().int().positive(),
    staleJobHours: z.number().int().positive(),
  }),
  dryRun: z.boolean(),
  features: z.object({
    instagram: z.boolean(),
    ticketing: z.object({ district: z.boolean(), bookmyshow: z.boolean(), skillbox: z.boolean() }),
    news: z.boolean(),
    fanEmails: z.boolean(),
    tierWatcher: z.boolean(),
    askAnything: z.boolean(),
    selfCheck: z.boolean(),
    playlists: z.boolean(),
    clashDetection: z.boolean(),
    dashboard: z.boolean(),
    /** The optional, clearly separated "not on your watchlist" digest section. */
    discoverySection: z.boolean(),
  }),
});

export type RadarConfig = z.infer<typeof RadarConfigSchema>;
export type CityConfig = z.infer<typeof CitySchema>;

const raw: RadarConfig = {
  homeCity: "Bengaluru",
  timezone: "Asia/Kolkata",
  cities: [
    { name: "Bengaluru", aliases: ["bengaluru", "bangalore", "blr", "b'lore", "bengaluru urban"], slugs: { district: "bengaluru", bookmyshow: "bengaluru", skillbox: "bangalore" }, airport: "BLR" },
    { name: "Mumbai", aliases: ["mumbai", "bombay"], slugs: { district: "mumbai", bookmyshow: "mumbai", skillbox: "mumbai" }, airport: "BOM" },
    { name: "Delhi NCR", aliases: ["delhi", "new delhi", "delhi ncr", "ncr", "gurgaon", "gurugram", "noida"], slugs: { district: "new-delhi", bookmyshow: "national-capital-region-ncr", skillbox: "new-delhi" }, airport: "DEL" },
    { name: "Pune", aliases: ["pune", "poona"], slugs: { district: "pune", bookmyshow: "pune", skillbox: "pune" }, airport: "PNQ" },
    { name: "Chennai", aliases: ["chennai", "madras"], slugs: { district: "chennai", bookmyshow: "chennai", skillbox: "chennai" }, airport: "MAA" },
    { name: "Hyderabad", aliases: ["hyderabad", "secunderabad"], slugs: { district: "hyderabad", bookmyshow: "hyderabad", skillbox: "hyderabad" }, airport: "HYD" },
    { name: "Kolkata", aliases: ["kolkata", "calcutta"], slugs: { district: "kolkata", bookmyshow: "kolkata", skillbox: "kolkata" }, airport: "CCU" },
    { name: "Goa", aliases: ["goa", "vagator", "anjuna", "panjim", "panaji", "mapusa"], slugs: { district: "goa", bookmyshow: "goa", skillbox: "goa" }, airport: "GOI" },
  ],
  confidenceThreshold: 0.6,
  fuzzyMatchFloor: 0.82,
  intervals: {
    pollMinutes: 30,
    tiersMinutes: 15,
    ticketingMinutes: 60,
    instagramMinutesByTier: { A: 30, B: 60, C: 120, account: 30 },
    snapshotMaxAgeMinutes: 60,
  },
  instagram: { callsPerHour: 150, postsPerCall: 6, refreshWhenDaysLeft: 10 },
  urgency: { urgentTiers: ["A"], homeCityEarlyBirdStates: ["open", "opening", "unknown"] },
  reminders: { saleStartWindowMinutes: 30, decideByWindowHours: 24 },
  health: { failureRunsBeforeUnhealthy: 3, zeroItemsHours: 72, staleJobHours: 24 },
  dryRun: process.env.RADAR_DRY_RUN === "1" || process.env.RADAR_DRY_RUN === "true",
  features: {
    instagram: true,
    ticketing: { district: true, bookmyshow: true, skillbox: true },
    news: true,
    fanEmails: true,
    tierWatcher: true,
    askAnything: true,
    selfCheck: true,
    playlists: true,
    clashDetection: true,
    dashboard: true,
    discoverySection: false,
  },
};

export const radarConfig: RadarConfig = RadarConfigSchema.parse(raw);
