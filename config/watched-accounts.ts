import { z } from "zod";

/**
 * Promoter and venue Instagram accounts polled alongside artists' own handles.
 * The watchlist job upserts these into `watched_accounts`. Accounts added from Telegram
 * (the self-check "Track this account" button) live only in the database.
 *
 * These are starting suggestions. Check each still exists: the Health page lists any handle
 * Business Discovery can't resolve, and you can switch it off there.
 */
export const WatchedAccountSchema = z.object({
  handle: z.string().regex(/^[a-z0-9._]{1,30}$/),
  kind: z.enum(["promoter", "venue"]),
  city: z.string().nullable(),
});
export type WatchedAccountSeed = z.infer<typeof WatchedAccountSchema>;

export const watchedAccounts: WatchedAccountSeed[] = z.array(WatchedAccountSchema).parse([
  // Promoters and ticketing brands
  { handle: "bookmyshowlive", kind: "promoter", city: null },
  { handle: "districtbyzomato", kind: "promoter", city: null },
  { handle: "skillboxes", kind: "promoter", city: null },
  { handle: "nh7weekender", kind: "promoter", city: null },
  { handle: "lollapaloozaindia", kind: "promoter", city: null },
  // Bengaluru venues
  { handle: "fandomatgilly", kind: "venue", city: "Bengaluru" },
  { handle: "thehumminggarden", kind: "venue", city: "Bengaluru" },
  { handle: "windmillscraftworks", kind: "venue", city: "Bengaluru" },
  { handle: "bflatbangalore", kind: "venue", city: "Bengaluru" },
  // Mumbai venues
  { handle: "antisocialmumbai", kind: "venue", city: "Mumbai" },
  { handle: "nscidome", kind: "venue", city: "Mumbai" },
]);
