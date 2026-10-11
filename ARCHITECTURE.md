# Architecture

Live Show Radar is four scheduled Node jobs (GitHub Actions), one Next.js app (Vercel), and one Postgres database (Neon). Everything is TypeScript in a pnpm workspace.

```
config/            radar.config.ts (cities, intervals, flags), watched-accounts.ts, env.ts (zod)
packages/core/     db schema + queries, llm (Gemini → Groq), extraction, matching, events (fingerprint/merge),
                   rules (urgency), deadline, telegram, bot (webhook logic), ask, ics, tiers, reminders,
                   spotify, setlists (setlist.fm + MusicBrainz), playlist, watchlist, selfcheck, digest, clash
packages/sources/  instagram (+ token), district, bookmyshow, skillbox, news, email, tier-page, polite fetch, robots
jobs/              poll.ts, tiers.ts, watchlist.ts, sunday.ts, lib/ (pipelines, runtime, store)
apps/web/          dashboard, /api/telegram, /api/ingest/email, /api/calendar/[token], Auth.js
apps-script/       gmail-forwarder.gs (fan-app emails → /api/ingest/email)
```

## Detection (`poll`, every 30 min)

```
sources ──► prefilter ──► dedup ──► raw_items ──► extract ──► match ──► fingerprint/merge ──► alert once
```

1. **Snapshot.** The watchlist, watched accounts and upcoming events come from a JSON snapshot in the Actions cache. It's rebuilt from Neon when it's older than 60 minutes or after any write.
2. **Sources** run in isolation; one failing never stops the others. Each reports its own health.
   - Instagram Business Discovery, budgeted per run and polled by tier: A every 30 min, B hourly, C every 2 h, promoters and venues every 30 min.
   - District: city listing JSON-LD, plus event pages from the sitemap whose slug names a watched artist.
   - BookMyShow: reports "blocked" while Cloudflare challenges.
   - SkillBox: event sitemap.
   - Google News RSS: one feed per artist, rotated.
3. **Prefilter.** Listings and news must name a watched artist. Instagram posts and emails always pass.
4. **Dedup** on `sha256(source + external_id + content_hash)`, against the cached seen-set first, then one Neon query for cache misses. Known items never reach the LLM.
5. **Store raw items**, with Instagram poster bytes downloaded in the same run, before extraction. If both LLMs are down, items stay queued for the next run.
6. **Extract.**
   - District/BookMyShow JSON-LD that names a watched artist becomes an extraction directly, with no LLM call.
   - Everything else goes to Gemini (text + poster). The output is zod-validated with one corrective retry, then Groq is the fallback.
   - Ticket URLs that never appeared in the source are dropped.
7. **Match.** Spotify artist link first, then the posting handle (unconfirmed handles are used but flagged), then exact name or alias. Fuzzy matches, name collisions and down-weighted artists are verified by the LLM.
8. **Fingerprint** is `artist_id | city | date` (undated → `tbd`, upgraded when a date arrives). Merging fills nulls freely; overwrites go into `field_history` with their source.
9. **Urgency** (`core/rules.ts`, pure):
   - 🔴 Urgent: a tier A artist, or Bengaluru with early-bird open, opening, or unknown before sales start.
   - 🟠 Normal: everything else.
   - 🟡 Possible: below the confidence threshold. It gets a quiet "please check" note and is upgraded with a real alert if a confident source confirms it.
10. **Alerts** use `sendOnce`: insert into `alerts` with a unique `(dedup_key, dry_run)`, then send, and release the claim if Telegram fails. That's why there's never a duplicate alert, even from overlapping late cron runs.

## Tier watcher and reminders (`tiers`, every 15 min)

- **Reminders.**
  - Sale start or early-bird opening: due from 30 minutes before until the moment itself.
  - Maybe shows: due 24 hours before the decide-by deadline.
  - The first run inside the window sends it. A late GitHub run still sends while the window is open. The `alerts` key includes the target time, so a rescheduled sale gets a new reminder and nothing is sent twice.
- **Ticket pages.**
  - The watcher reads schema.org offers first. Only when a page has none does it send the visible text to the LLM, and only when that text changed.
  - The state hash (tiers, early-bird state, scarcity) lives in the job cache, so an unchanged page costs no database access.
  - When the state changes, it writes a `tier_snapshots` row and diffs against the last snapshot (early-bird opened or closed, low availability, next price phase, sold out). Each change is alerted once per resulting state.

## Ask-it-anything (Telegram)

```
question ──LLM──► AskFilter (zod) ──► drizzle SELECT builder ──► .toSQL() ──► READ ONLY transaction ──► rows ──LLM──► reply
```

- The model never writes SQL. Values only travel as bind parameters.
- The query runs in `BEGIN READ ONLY` (Neon `transaction(..., { readOnly: true })`), so even a bug can't write.
- Deadline windows and sorting are computed in code.
- If the reply model fails, a deterministic list is sent instead. If nothing matches, the bot says so.
- Chat buttons (Going, Maybe, Wrong artist and so on) are the only way chat changes data.

## Weekly self-check and digest (`sunday`, 09:00 IST)

1. Gather shows that actually happened:
   - setlist.fm setlists by MusicBrainz ID from the last 7 days, in India.
   - Instagram posts the poll already stored that sound post-show ("thank you Bengaluru"), classified by the LLM. This costs no extra Instagram calls.
2. Compare against `events` (same artist and city, ±1 day). Each miss gets a likely cause:
   - an untracked @promoter tagged in the post (offered as a one-tap "Track" button),
   - a missing or unconfirmed handle,
   - a failing parser,
   - a show seen only as "possible".
3. Refresh pre-show playlists for Going shows in the next 8 days.
4. Send the digest: next 60 days, the decide-by list, misses, source health, and job failures.

## Pre-show playlist

Going, from Telegram or the dashboard, triggers this after the response is sent (`after()` on Vercel):

1. Resolve the MusicBrainz ID if it's missing.
2. Fetch setlist.fm setlists.
3. Rank songs by play count.
4. Match them via Spotify search (limit ≤ 10, filtered by artist ID).
5. Create the playlist (`POST /me/playlists`), then replace its items (`PUT /playlists/{id}/items`).

With no setlists, it falls back to the artist's latest releases, because top-tracks is gone in Development Mode. One playlist per event, refreshed in place.

## Dashboard and calendar feed

- **Pages.**
  - Next.js App Router pages are dynamic server components that read Neon.
  - The stub is the one client component with interaction: decisions, countdown, and the stamp.
  - Decisions write the same `decisions` row Telegram does, so both stay in sync.
  - Clash detection reads the private Google Calendar iCal URL (cached 10 min) and flags a second Going show on the same weekend.
- **Calendar feed.** `/api/calendar/<token>.ics` lists Going shows (confirmed all-day events), Maybe shows (tentative), and decide-by reminders, with stable UIDs (`show-<id>@liveshowradar`, `decide-<id>@liveshowradar`).
- **Auth.** next-auth v4 (the stable Auth.js line) with Google, restricted to `ALLOWED_EMAIL`.
- **Webhook and ingest.**
  - The Telegram webhook checks `X-Telegram-Bot-Api-Secret-Token` and the chat allow-list.
  - Email ingest checks a bearer secret and never logs bodies.

## Keeping Neon asleep

Neon's free plan gives 100 CU-hours a month and suspends after 5 idle minutes.

- Jobs open the database lazily. A quiet poll or tier run touches only the Actions cache.
- Buffered `job_runs` and `source_health` rows are flushed when the database is awake anyway, or at least hourly (the heartbeat).
- The heartbeat also catches up queued items and fan-app emails, and checks for stale jobs. That warning is sent once per incident.
- The compute is capped at 0.25 CU.
- Cached state is only an optimisation: on a cache miss, everything is rebuilt from Neon.
- The refreshed Instagram token is cached AES-GCM-sealed with a key derived from the Facebook app secret, so it's never in clear text in the cache.
