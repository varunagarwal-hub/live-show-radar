# Live Show Radar

A personal live-music alert system for one person in Bengaluru. It watches every show announced in India by artists you listen to (Instagram, District, BookMyShow, SkillBox, Google News, Bandsintown and Songkick emails). It messages you on Telegram within one 30-minute cycle, with the artist, venue, city, date, early-bird status and deadline, and a buy link.

It never buys tickets, never enters payment details, and never gets around a site's bot protection. It gets you to the checkout page in time; you buy.

- **Telegram:** loud alerts for shows that matter, early-bird and sale reminders, tier-change alerts, the Sunday digest, and questions like *"anything in Bengaluru in December under ₹2,000?"*
- **Dashboard ("the gig wall"):** every show as a ticket stub. Includes a gig-flyer calendar, a Decide-by list with deadlines, clash detection against your Google Calendar, the artist watchlist, and source health.
- **Calendar feed:** Going and Maybe shows plus decide-by reminders, in any calendar app.
- **Pre-show playlist:** tap Going and a private Spotify playlist of what the artist has been playing live appears.

Everything runs on free tiers: GitHub Actions (public repo), Vercel Hobby, Neon Free, Gemini and Groq free tiers, and the Telegram Bot API.

See [ARCHITECTURE.md](ARCHITECTURE.md) for how the pieces fit ([components map](docs/components-map.png)), and [docs/DESIGN.md](docs/DESIGN.md) for the dashboard's design.

---

## Contents

1. [Before you start](#1-before-you-start)
2. [Neon (database)](#2-neon-database)
3. [Telegram bot and chat IDs](#3-telegram-bot-and-chat-ids)
4. [Gemini and Groq keys](#4-gemini-and-groq-keys)
5. [Spotify app and the one-time refresh token](#5-spotify)
6. [Instagram: creator account, Facebook page, Graph API token](#6-instagram)
7. [setlist.fm key and MusicBrainz contact](#7-setlistfm-and-musicbrainz)
8. [Fan-app emails: Bandsintown, Songkick, Gmail label and the Apps Script](#8-fan-app-emails)
9. [Google Calendar secret address (clash detection)](#9-google-calendar-clash-detection)
10. [Google sign-in for the dashboard](#10-google-sign-in-for-the-dashboard)
11. [Deploy the dashboard on Vercel](#11-deploy-on-vercel)
12. [GitHub: secrets, variables, and turning on the jobs](#12-github-secrets-and-jobs)
13. [Point Telegram at the webhook](#13-point-telegram-at-the-webhook)
14. [Dry run, then go live](#14-dry-run-then-go-live)
15. [Subscribe to the calendar feed](#15-subscribe-to-the-calendar-feed)
16. [Where every secret goes](#where-every-secret-goes)
17. [How the Instagram token refresh works](#how-the-instagram-token-refresh-works)
18. [Keepalive: why there's a monthly commit](#keepalive)
19. [Free-tier budget](#free-tier-budget)
20. [Configuration and feature flags](#configuration-and-feature-flags)
21. [Development](#development)
22. [Known limitations](#known-limitations)

---

## 1. Before you start

You'll need about an hour and a half, and accounts with GitHub, Vercel, Neon, Google (Gmail, AI Studio, Cloud console), Telegram, Spotify **Premium**, Meta (Facebook and Instagram), Groq and setlist.fm.

On your computer: [Node.js 22.12+](https://nodejs.org) (24 recommended) and pnpm (`npm install -g pnpm@9`).

```bash
git clone https://github.com/<you>/live-show-radar.git
```

```bash
cd live-show-radar && pnpm install && cp .env.example .env
```

Fill `.env` as you go; the local scripts read it, and it's git-ignored. Make the GitHub repository **public**: public repos get unlimited Actions minutes. The 15-minute tier watcher alone would use up a private repo's free minutes. Nothing personal is in the repo: all state lives in Neon and all secrets in GitHub and Vercel settings.

Generate the random secrets you'll need now. Run this four times, once each for `TELEGRAM_WEBHOOK_SECRET`, `CALENDAR_FEED_TOKEN`, `INGEST_EMAIL_SECRET` and `NEXTAUTH_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## 2. Neon (database)

1. Sign up at [neon.com](https://neon.com) and create a project. Choose region **AWS Asia Pacific (Singapore)**, the closest to India.
2. In the project's compute settings, set autoscaling to **0.25 CU min and max**. This stretches the free 100 CU-hours a month.
3. Click **Connect**, choose the **pooled** connection string, and put it in `.env` as `DATABASE_URL`.
4. Create the tables, then add sample data so the dashboard isn't empty:

   ```bash
   pnpm db:migrate
   ```

   ```bash
   pnpm seed
   ```

   You can remove the samples later with `pnpm seed --clear`. It only deletes what the seed added.

## 3. Telegram bot and chat IDs

1. In Telegram, message **@BotFather** → `/newbot` → pick a name and username. Copy the token into `TELEGRAM_BOT_TOKEN`.
2. Open a chat with your new bot and send it "hi".
3. Open `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser. Find `"chat":{"id":123456789,...}`. That number is your chat ID. Put it in both `TELEGRAM_ALLOWED_CHAT_IDS` and `TELEGRAM_ALERT_CHAT_ID`.
4. **Test chat for dry runs:**
   1. Create a Telegram group with just you and the bot.
   2. Send a message in it.
   3. Run `getUpdates` again. Group IDs are negative, like `-100…`.
   4. Put that ID in `TELEGRAM_TEST_CHAT_ID`, and add it to `TELEGRAM_ALLOWED_CHAT_IDS` (comma separated).

The bot ignores every chat not on that list.

## 4. Gemini and Groq keys

- **Gemini:** [aistudio.google.com](https://aistudio.google.com) → *Get API key* → create one → `GEMINI_API_KEY`. The default model is `gemini-3.8-flash`. If Google renames its Flash models, set `GEMINI_MODEL` to a current one from the [models page](https://ai.google.dev/gemini-api/docs/models).
- **Groq** (fallback when Gemini is down or out of quota): [console.groq.com](https://console.groq.com) → *API Keys* → `GROQ_API_KEY`.

## 5. Spotify

Spotify's Development Mode requires the app owner to have **Spotify Premium**, and allows at most 5 users. You only need one.

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) → *Create app*.
   - Redirect URI: `http://127.0.0.1:8888/callback` (Spotify needs the IP address, not "localhost").
   - API: **Web API**.
2. Copy the Client ID and secret into `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`.
3. Run the one-time authorisation:

   ```bash
   pnpm spotify:auth
   ```

   Open the link it prints, sign in **as Karan**, and approve. The scopes are `user-follow-read`, `user-top-read`, `user-read-recently-played` and `playlist-modify-private`. The terminal prints a refresh token: put it in `SPOTIFY_REFRESH_TOKEN`.

> Since 2026, Spotify refresh tokens **expire six months after you authorise**, however often they're used. When that happens, the radar sends a Telegram message. Run `pnpm spotify:auth` again and update the secret in GitHub and Vercel.

## 6. Instagram

Instagram is the earliest source, because announcements land there first. The radar uses the Instagram Graph API's **Business Discovery**, which reads public posts of business and creator accounts *through your own* creator account.

1. **Switch Karan's Instagram to a creator account:** Instagram app → Settings → *Account type and tools* → *Switch to professional account* → **Creator**. It's free and reversible.
2. **Link a Facebook Page:** create a Page if you don't have one (any name, it can stay empty). In Instagram, go to *Settings → Accounts Center → Accounts* and connect the Instagram account to that Page.
3. **Create a Meta app:**
   1. Go to [developers.facebook.com](https://developers.facebook.com) → *My Apps* → *Create app* → use case *Other* → type **Business**.
   2. Add the product **Instagram** (*API setup with Facebook login*).
   3. Copy *App settings → Basic* App ID and App secret into `FACEBOOK_APP_ID` and `FACEBOOK_APP_SECRET`.
   4. You can leave the app in Development mode: as its admin, your own account can use these permissions without App Review.
4. **Get a user token:**
   1. Open the [Graph API Explorer](https://developers.facebook.com/tools/explorer/) and select your app.
   2. Add the permissions `instagram_basic`, `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement` and `business_management`. Business Discovery needs `instagram_manage_insights` even though it reads other accounts. If your Page role came through Business Manager, also add `ads_read`.
   3. Click *Generate Access Token* and approve for your Page and Instagram account.
5. **Make it long-lived (~60 days).** Run this server-side, because it contains the app secret:

   ```bash
   curl "https://graph.facebook.com/v25.0/oauth/access_token?grant_type=fb_exchange_token&client_id=$FACEBOOK_APP_ID&client_secret=$FACEBOOK_APP_SECRET&fb_exchange_token=<SHORT_LIVED_TOKEN>"
   ```

   Put the `access_token` from the response in `INSTAGRAM_ACCESS_TOKEN`.
6. **Find your Instagram user ID.** In the Graph API Explorer, query `me/accounts?fields=instagram_business_account{id,username}`. The `instagram_business_account.id` goes in `INSTAGRAM_USER_ID`.

After that, the radar refreshes the token by itself; see [How the Instagram token refresh works](#how-the-instagram-token-refresh-works).

**Promoter and venue accounts** to watch are in [`config/watched-accounts.ts`](config/watched-accounts.ts). Add or remove handles there; the daily job syncs them. You can also add any account the Sunday self-check suggests with one tap. Accounts must be business or creator accounts: the Health page lists any Business Discovery can't read.

## 7. setlist.fm and MusicBrainz

- **setlist.fm:** sign in at [setlist.fm](https://www.setlist.fm) → *API* (footer) → apply for a key. Personal, non-commercial use is free. Put it in `SETLISTFM_API_KEY`.
- **MusicBrainz** needs no key, but its terms require a User-Agent with contact details. Put an email address or URL in `MUSICBRAINZ_CONTACT`. The radar stays under MusicBrainz's 1 request per second.

## 8. Fan-app emails

Bandsintown and Songkick email you when tracked artists announce shows near you. A small Google Apps Script inside your own Gmail forwards those emails to the radar.

> **Why not the Gmail API?** A personal Google Cloud app in "Testing" status gets refresh tokens that expire after 7 days, so that source would silently break. The Apps Script runs as you inside Gmail, with nothing to expire.

1. **Install the apps.** Install Bandsintown and Songkick on your phone and sign up with the Gmail address you'll use below.
2. **Connect Spotify in both:**
   - Bandsintown: *Settings → Connected services → Spotify*.
   - Songkick: *Settings → Import artists → Spotify*.

   Set your location to Bengaluru and add the other cities you'd travel to.
3. **Turn on email notifications:**
   - Bandsintown: *Settings → Notifications → Email*, with new shows announced near you on.
   - Songkick: *Settings → Notifications*, with email alerts for tracked artists on.
4. **Create the Gmail label and filter:**
   1. In Gmail, create a label called **`radar-feeds`**.
   2. Create a filter: *From* `bandsintown.com OR songkick.com` → *Apply the label* `radar-feeds` (optionally *Skip the Inbox*).
5. **Install the script:**
   1. Go to [script.google.com](https://script.google.com) → *New project* and paste [`apps-script/gmail-forwarder.gs`](apps-script/gmail-forwarder.gs).
   2. *Project Settings → Script properties*: add `RADAR_INGEST_URL` = `https://<your-app>.vercel.app/api/ingest/email` (after step 11) and `RADAR_INGEST_SECRET` = your `INGEST_EMAIL_SECRET`.
   3. Select `forwardRadarFeeds` → *Run* once, and approve the Gmail permission.
   4. *Triggers* (clock icon) → *Add trigger* → `forwardRadarFeeds`, *Time-driven*, *Minutes timer*, *Every 10 minutes*.

Forwarded emails are stored and extracted on the next poll. That's within the hour, or within a couple of minutes if you set `GITHUB_DISPATCH_TOKEN`; see `.env.example`.

## 9. Google Calendar (clash detection)

Google Calendar → ⚙ *Settings* → under *Settings for my calendars*, pick your calendar → *Integrate calendar* → copy **Secret address in iCal format**. Put it in `GOOGLE_CALENDAR_ICS_URL` (Vercel only).

It's a private, read-only URL with no OAuth, so nothing expires. Treat it like a password: anyone with it can read your calendar. If it leaks, use *Reset* on the same page.

## 10. Google sign-in for the dashboard

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → create a project → *APIs & Services → OAuth consent screen*. Choose *External*, fill in the app name and your email, and add your Google account as a test user.
2. *Credentials → Create credentials → OAuth client ID → Web application*.
   - Authorised redirect URI: `https://<your-app>.vercel.app/api/auth/callback/google` (add `http://localhost:3000/api/auth/callback/google` too for local use).
3. Copy the client ID and secret into `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`. Set `ALLOWED_EMAIL` to Karan's Gmail address: only that account can sign in.

Sign-in uses only basic scopes (openid, email, profile), so the 7-day "Testing" token expiry doesn't affect it.

## 11. Deploy on Vercel

1. [vercel.com](https://vercel.com) → *Add New → Project* → import your GitHub repo.
2. Set **Root Directory** to `apps/web`. Vercel detects Next.js and the pnpm workspace. Leave "Include files outside the root directory" on.
3. Add the environment variables marked **Vercel** in [the table below](#where-every-secret-goes). Set `NEXTAUTH_URL` and `PUBLIC_BASE_URL` to your production URL.
4. Deploy. The app's functions run in Singapore (`sin1`, set in `apps/web/vercel.json`), next to the database.
5. From then on, every push to `main` deploys the dashboard automatically. A pull request gets its own preview deployment.

## 12. GitHub secrets and jobs

In your repo: *Settings → Secrets and variables → Actions*.

- **Secrets:** everything marked **GitHub** in [the table](#where-every-secret-goes).
- **Variables** (not secret): `RADAR_DRY_RUN` (`1` to start), and optionally `GEMINI_MODEL`, `GROQ_MODEL`, `GROQ_VISION_MODEL`, `GRAPH_API_VERSION`.

Then open the *Actions* tab and enable workflows. Run **watchlist** once by hand (*Run workflow*): it pulls your artists from Spotify and proposes Instagram handles. Then run **poll**.

| Workflow | Schedule (UTC → IST) | What it does |
|---|---|---|
| `poll.yml` | :07 and :37 every hour | all sources → dedup → extract → match → store → alert |
| `tiers.yml` | every 15 min | tier watcher, sale-start and decide-by reminders |
| `watchlist.yml` | every 6 h from 06:10 IST | Spotify sync, tiers, MusicBrainz IDs, handle proposals, Instagram token refresh |
| `sunday.yml` | Sun 03:30 → 09:00 IST | missed-show self-check, playlist refresh, digest |
| `keepalive.yml` | 1st of each month | keeps scheduled workflows from being disabled |
| `ci.yml` | on push and PR | typecheck, tests, dry-run cycle |

All of them can also be run by hand (*Run workflow*). Runs of the same job never overlap (`concurrency`), and every run is recorded in `job_runs`.

## 13. Point Telegram at the webhook

With `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` and `PUBLIC_BASE_URL` in `.env`:

```bash
pnpm telegram:webhook
```

Telegram will now send button taps and messages to `/api/telegram`, with your secret in a header the app checks.

## 14. Dry run, then go live

With `RADAR_DRY_RUN=1` (GitHub variable and Vercel), every message goes to the test chat. Alerts are recorded as dry-run, so they'll still be sent for real later.

Watch the test chat for a day:
- Confirm or reject the proposed Instagram handles (buttons).
- Check the Health page.
- Ask the bot a question.

Then clear `RADAR_DRY_RUN` in both places. You can rehearse a whole cycle on your computer against fixtures, with no network and no secrets:

```bash
pnpm test:e2e-dry
```

## 15. Subscribe to the calendar feed

Your feed URL is `https://<your-app>.vercel.app/api/calendar/<CALENDAR_FEED_TOKEN>.ics`.

In Google Calendar: *Other calendars* → **+** → *From URL* → paste it. You'll see:
- Going shows as all-day events, with venue, ticket link and source links.
- Maybe shows as tentative events.
- Decide-by deadlines as short reminders with an alert.

Entries keep stable IDs, so changes update them instead of duplicating. Google refreshes subscribed calendars every few hours. That's Google's schedule, not ours.

---

## Where every secret goes

| Variable | GitHub | Vercel | Where to get it |
|---|:-:|:-:|---|
| `DATABASE_URL` | ✔ | ✔ | Neon → Connect (pooled) |
| `GEMINI_API_KEY` | ✔ | ✔ | Google AI Studio |
| `GROQ_API_KEY` | ✔ | ✔ | Groq console |
| `TELEGRAM_BOT_TOKEN` | ✔ | ✔ | @BotFather |
| `TELEGRAM_ALERT_CHAT_ID` | ✔ | ✔ | `getUpdates` (step 3) |
| `TELEGRAM_TEST_CHAT_ID` | ✔ | ✔ | `getUpdates` in your test group |
| `TELEGRAM_ALLOWED_CHAT_IDS` | | ✔ | your chat ID(s), comma separated |
| `TELEGRAM_WEBHOOK_SECRET` | | ✔ | random (step 1) |
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | ✔ | ✔ | Spotify dashboard |
| `SPOTIFY_REFRESH_TOKEN` | ✔ | ✔ | `pnpm spotify:auth` |
| `FACEBOOK_APP_ID` | ✔ | | Meta app → Basic |
| `FACEBOOK_APP_SECRET` | ✔ | | Meta app → Basic |
| `INSTAGRAM_USER_ID`, `INSTAGRAM_ACCESS_TOKEN` | ✔ | | step 6 |
| `SETLISTFM_API_KEY` | ✔ | ✔ | setlist.fm API page |
| `MUSICBRAINZ_CONTACT` | ✔ | ✔ | your email |
| `GOOGLE_CALENDAR_ICS_URL` | | ✔ | Google Calendar settings |
| `CALENDAR_FEED_TOKEN` | | ✔ | random |
| `INGEST_EMAIL_SECRET` | | ✔ | random (also in the Apps Script) |
| `ALLOWED_EMAIL` | | ✔ | Karan's Gmail |
| `NEXTAUTH_SECRET` | | ✔ | random |
| `NEXTAUTH_URL`, `PUBLIC_BASE_URL` | | ✔ | your Vercel URL |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | | ✔ | Google Cloud OAuth client |
| `RADAR_DRY_RUN` | variable | ✔ | `1` or empty |
| `GITHUB_DISPATCH_TOKEN`, `GITHUB_REPOSITORY` | | optional | fine-grained token, Actions read/write on this repo |

Secrets are never logged. Errors name a missing variable, never its value, and email bodies are never logged.

## How the Instagram token refresh works

Long-lived Instagram (Facebook Login) user tokens last about 60 days.

1. Every day the **watchlist** job asks Meta when the current token expires (`debug_token`).
2. With fewer than 10 days left, it exchanges the token for a fresh ~60-day one (`fb_exchange_token`).
3. It stores the result in Neon (`kv.instagram_token`).
4. The poll job keeps an encrypted copy in its Actions cache (AES-GCM, key derived from `FACEBOOK_APP_SECRET`), so it doesn't need the database to read it.
5. If the refresh fails, or Meta says the token is invalid, you get a Telegram warning with the number of days left. Then repeat steps 4–5 of [Instagram setup](#6-instagram) and update `INSTAGRAM_ACCESS_TOKEN`. A new value in the secret automatically takes priority over the stored one.

To avoid refreshes entirely, create a **system user token** in Meta Business Settings (*Users → System users*, assign the app and your Page, generate a token with the same permissions). It doesn't expire. Put it in `INSTAGRAM_ACCESS_TOKEN`; the job sees it has no expiry and leaves it alone.

## Keepalive

GitHub disables scheduled workflows in a public repository after **60 days without repository activity**. Once a month, `keepalive.yml`:
1. Commits a one-line timestamp to `.github/keepalive`, which counts as activity.
2. Re-enables the four scheduled workflows in case any were already disabled.

It needs only the built-in `GITHUB_TOKEN` (contents and actions write). If you ever see the workflows disabled anyway, open the Actions tab and click *Enable workflow*, or run keepalive by hand.

## Free-tier budget

| Service | Free tier | How the radar stays inside it |
|---|---|---|
| GitHub Actions | unlimited minutes for public repos | Runs take seconds to a couple of minutes; timeouts cap the rest. |
| Neon | 100 CU-hours/month, 0.5 GB | 0.25 CU compute. Quiet runs don't connect at all, and logs are flushed at most hourly, so the database sleeps between runs. My estimate is roughly 30–50 CU-hours a month; check *Usage* in the Neon console after the first week. |
| Gemini | Flash free tier (limits shown in AI Studio) | Seen items never reach the LLM. District and BookMyShow listings with structured data skip it. Tier pages use HTML first. At most 40 extractions per run, and queued items wait for quota. |
| Groq | free tier | Fallback only. |
| Instagram Graph API | ~200 calls per user per hour | 150 per hour budgeted. Handles are polled by tier (A every 30 min, B hourly, C every 2 h), and polling stops early if `X-App-Usage` passes 85%. |
| Vercel Hobby | functions, bandwidth | The dashboard is for one person; the webhook runs a few calls a day. |

## Configuration and feature flags

[`config/radar.config.ts`](config/radar.config.ts) (validated with zod) holds:
- cities, with Bengaluru as home, plus aliases, ticketing slugs and airports
- polling intervals and the Instagram budget
- the confidence threshold (0.6)
- urgency rule parameters and reminder windows
- health thresholds
- the feature flags: `instagram`, `ticketing.district`, `ticketing.bookmyshow`, `ticketing.skillbox`, `news`, `fanEmails`, `tierWatcher`, `askAnything`, `selfCheck`, `playlists`, `clashDetection`, `dashboard`

Turning a flag off skips that feature entirely. A disabled source is never constructed, and the email route answers "switched off".

Dry-run mode is the `RADAR_DRY_RUN` environment variable, so you can flip it without a commit.

## Development

| Command | What it does |
|---|---|
| `pnpm test` | unit tests (Vitest): extraction fixtures, matching, fingerprinting and merging, urgency rules, decide-by, ask filters → SQL, `.ics`, ticketing parsers, tier diffs, reminders, self-check, digest, clashes |
| `pnpm test:e2e-dry` | full poll, tier-watcher and playlist cycles in dry-run mode against fixtures and in-process Postgres (PGlite) |
| `pnpm typecheck` | strict TypeScript across the workspace |
| `pnpm dev` | dashboard on http://localhost:3000. Put `DATABASE_URL`, `ALLOWED_EMAIL` and `DEV_AUTH_BYPASS=1` in `apps/web/.env.local` to skip Google sign-in locally; the bypass only works under `next dev`. |
| `pnpm job:poll` (and `:tiers`, `:watchlist`, `:sunday`) | run a job locally with `.env` |
| `pnpm db:generate` / `pnpm db:migrate` | new Drizzle migration / apply migrations |
| `pnpm seed` / `pnpm seed --clear` | add or remove sample data |
| `pnpm screenshots` | refresh `docs/screenshots/` from a running dev server |

## Known limitations

Where the spec and the current APIs disagreed, I followed the APIs. Each item below is also marked with a `// NOTE:` in the code.

**Ticketing sources**
- **BookMyShow is blocked.** Its `/explore` pages are allowed by robots.txt, but automated requests currently get a Cloudflare "Just a moment…" challenge. The radar never tries to get past it. The adapter reports *Blocked by bot protection* on the Health page and in the digest, It is **switched off by default** (`ticketing.bookmyshow: false`); turn it back on to retry. Shows ticketed only on BookMyShow are still caught via the artist's Instagram, `@bookmyshowlive`, Google News and fan-app emails, but the tier watcher can't read BookMyShow ticket pages. The `music-shows-<city>` slug is inferred from BookMyShow's sitemap and unconfirmed.
- **SkillBox only gives URL slugs.** Its pages are rendered in the browser and carry no event data. Rather than use an undocumented internal API, the adapter reads SkillBox's public event sitemap and only sees the event's URL words. Those finds usually arrive as quiet "possible show" messages with the link, and the tier watcher can't read SkillBox pages.
- **District blocks GitHub Actions.** Since October 2026 District answers requests from GitHub's data-centre addresses with "403 Forbidden", although the same pages load from a home connection. That is bot protection, so the radar reports District as *Blocked* on the Health page and doesn't try to get around it. District shows still reach you through Instagram (@districtupdates and the artists themselves), news and fan-app emails, and the adapter starts working by itself if District lifts the block.
- **District listings only show ~12 events per city.** The adapter also reads District's event sitemap and opens pages whose URL names a watched artist, so smaller shows aren't missed.
- **Google News robots.txt** disallows `/rss` for crawlers. The feeds are published for feed readers and the spec asks for them, so the radar reads them like a feed reader, at low frequency (each artist every 1–4 hours). Turn off `news` to stop.

**Spotify (Development Mode since February 2026)**
- `GET /artists/{id}/top-tracks` was removed, so a playlist with no setlists falls back to the artist's latest releases.
- Search returns at most 10 results.
- Playlists are created with `POST /me/playlists` and filled with `PUT /playlists/{id}/items`, the post-2026 endpoints.
- If top artists or recently played ever stop working, tiers fall back to followed artists: everything becomes tier C, and the job's stats say so.
- Refresh tokens expire after six months: see step 5.

**Instagram**
- Meta documents no server-side refresh for long-lived user tokens. Re-exchanging the token before expiry is the closest working approach. A system-user token avoids the problem: see above.
- Business Discovery can't read personal or age-gated accounts.
- The platform's hourly rate limit means tier C artists are polled every 2 hours, not every 30 minutes.

**Other APIs and services**
- **Gemini models:** model names change. Set `GEMINI_MODEL` if the default is retired. Google publishes free-tier limits only inside AI Studio.
- **Google Flights links** use the `?q=` search URL. Google documents no deep-link format, so treat it as a best-effort prefill.
- **setlist.fm** doesn't publish its rate limits; the radar spaces calls 600 ms apart.
- **Neon** doesn't let free-plan projects change the 5-minute suspend delay.

**Deviations from the spec**
- **Auth.js:** v5 is still a beta on npm, so the dashboard uses `next-auth@4.24` (the stable Auth.js line) with Google sign-in.
- **Fonts:** Google merged *Big Shoulders Display* into a single *Big Shoulders* family with an optical-size axis. The app uses that, at the display optical size.
- **Extraction schema additions:** `other_dates` holds the extra stops on multi-city tour posters, and `country` filters out shows outside India. All the spec's fields are unchanged.
- **The "not on your watchlist" section isn't built.** It's optional in the spec; the `discoverySection` flag is reserved for it and is off. Nothing alerts on artists outside the watchlist.

**Timing**
- **GitHub cron runs late** under load, sometimes by 10+ minutes. Reminders use windows, so a late run still sends them in time. Detection is "within about one poll cycle", not to the minute.
- **Fan-app emails** wait for the next hourly database heartbeat unless you set `GITHUB_DISPATCH_TOKEN`.
