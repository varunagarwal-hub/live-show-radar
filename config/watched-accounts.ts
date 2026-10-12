import { z } from "zod";

/**
 * Promoter and venue Instagram accounts polled alongside artists' own handles.
 * The watchlist job upserts these into `watched_accounts`. Accounts added from Telegram
 * (the self-check "Track this account" button) live only in the database.
 *
 * Each handle was checked against Business Discovery (exists, is a business or creator account,
 * posted recently). The Health page lists any that stop resolving; switch them off there.
 */
export const WatchedAccountSchema = z.object({
  handle: z.string().regex(/^[a-z0-9._]{1,30}$/),
  kind: z.enum(["promoter", "venue"]),
  city: z.string().nullable(),
});
export type WatchedAccountSeed = z.infer<typeof WatchedAccountSchema>;

export const watchedAccounts: WatchedAccountSeed[] = z.array(WatchedAccountSchema).parse([
  // Ticketing and festivals (verified with Business Discovery, Oct 2026)
  { handle: "bookmyshow.live", kind: "promoter", city: null },
  { handle: "districtupdates", kind: "promoter", city: null },
  { handle: "skillboxofficial", kind: "promoter", city: null },
  { handle: "lollaindia", kind: "promoter", city: null },
  { handle: "nh7dotin", kind: "promoter", city: null },
  { handle: "onlymuchlouder", kind: "promoter", city: null },
  { handle: "live.at.social", kind: "promoter", city: null },
  // National gig aggregators
  { handle: "concertislove", kind: "promoter", city: null },
  { handle: "showsofindia", kind: "promoter", city: null },
  { handle: "concertupdatesindia", kind: "promoter", city: null },
  { handle: "raver.india", kind: "promoter", city: null },
  { handle: "thewildcity", kind: "promoter", city: null },
  // Festivals outside the big cities
  { handle: "magneticfieldsfestival", kind: "promoter", city: null },
  { handle: "zirofestival", kind: "promoter", city: null },
  { handle: "kittysuindia", kind: "venue", city: null },
  // Bengaluru
  { handle: "bandland.in", kind: "promoter", city: "Bengaluru" },
  { handle: "sofarbangalore", kind: "promoter", city: "Bengaluru" },
  { handle: "the_hummingtree", kind: "venue", city: "Bengaluru" },
  { handle: "windmills.bangalore", kind: "venue", city: "Bengaluru" },
  { handle: "bangaloreconcerts", kind: "promoter", city: "Bengaluru" },
  // Mumbai
  { handle: "antisocialoffline", kind: "venue", city: "Mumbai" },
  { handle: "domeindia", kind: "venue", city: "Mumbai" },
  { handle: "mumbaiopera", kind: "venue", city: "Mumbai" },
  { handle: "islandcitystage", kind: "venue", city: "Mumbai" },
  { handle: "somegoodgigs", kind: "promoter", city: "Mumbai" },
  // Delhi NCR
  { handle: "depot48", kind: "venue", city: "Delhi NCR" },
  { handle: "tpmcafes", kind: "venue", city: "Delhi NCR" },
  { handle: "tpm.del", kind: "venue", city: "Delhi NCR" },
  { handle: "tpm.ggn", kind: "venue", city: "Delhi NCR" },
  { handle: "nightvibe_", kind: "promoter", city: "Delhi NCR" },
]);
