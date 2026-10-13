import Link from "next/link";
import { and, count, eq } from "drizzle-orm";
import { radarConfig } from "@radar/config";
import { artists, follows, users } from "@radar/core/db/schema";
import { ArtistSearch } from "@/components/ArtistSearch";
import { SignOutButton } from "@/components/Chrome";
import { CopyButton } from "@/components/CopyButton";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { disconnectSpotifyAction, disconnectTelegramAction, newCalendarLinkAction, newTelegramLinkAction, setHomeCityAction } from "@/lib/people-actions";
import { botUsername } from "@/lib/telegram-bot";

export const dynamic = "force-dynamic";

const SPOTIFY_NOTE: Record<string, { tone: "ok" | "warn"; text: string }> = {
  connected: { tone: "ok", text: "Spotify connected. Your artists are loading in now; give it a minute." },
  "not-allowed": {
    tone: "warn",
    text: "Spotify said no: while Early Access is in Spotify's test mode, only accounts added to its guest list can connect. Ask the owner to add your Spotify email, or add artists by search below.",
  },
  cancelled: { tone: "warn", text: "Spotify wasn't connected. You can try again, or add artists by search." },
  expired: { tone: "warn", text: "That took too long. Try Connect Spotify again." },
  error: { tone: "warn", text: "Something went wrong talking to Spotify. Try again in a minute." },
};

export default async function YouPage({ searchParams }: { searchParams: Promise<{ welcome?: string; spotify?: string }> }) {
  const v = await requireUser();
  const p = await searchParams;
  const { db } = await getDb();
  const [me] = await db.select().from(users).where(eq(users.id, v.id));
  const [{ n: artistCount } = { n: 0 }] = await db
    .select({ n: count() })
    .from(follows)
    .where(and(eq(follows.userId, v.id), eq(follows.muted, false)));
  const followingIds = (
    await db.select({ sid: artists.spotifyId }).from(follows).innerJoin(artists, eq(artists.id, follows.artistId)).where(eq(follows.userId, v.id))
  )
    .map((r) => r.sid)
    .filter((s): s is string => !!s);
  const base = process.env.PUBLIC_BASE_URL ?? "";
  const calendarToken = v.isOwner && process.env.CALENDAR_FEED_TOKEN ? process.env.CALENDAR_FEED_TOKEN : me!.calendarToken;
  const feed = `${base}/api/calendar/${calendarToken}.ics`;
  const bot = await botUsername();
  const tgConnected = v.isOwner || Boolean(me!.telegramChatId);
  const tgLink = bot && me!.telegramLinkToken ? `https://t.me/${bot}?start=${me!.telegramLinkToken}` : null;
  const note = p.spotify ? SPOTIFY_NOTE[p.spotify] : null;

  return (
    <>
      <section className="section you-head">
        <p className="tour-kicker">{v.email}</p>
        <h1 className="section-title">{p.welcome ? "You're in. Let's set up your radar." : "You"}</h1>
        {p.welcome && <p className="lede">Three steps: add the artists you'd travel for, connect Telegram for alerts, and add your calendar. Everything is optional and can change later.</p>}
      </section>

      <section className="section you-step" aria-labelledby="s-artists">
        <h2 id="s-artists" className="section-title">
          <span className="step-no">1</span> Your artists <span className="count">{artistCount} on your radar</span>
        </h2>
        {!v.isOwner && (
          <div className="you-card">
            <h3>Import from Spotify</h3>
            {note && (
              <p role="status" className={note.tone === "ok" ? "you-ok" : "you-warn"}>
                {note.text}
              </p>
            )}
            {me!.spotifyRefreshEnc ? (
              <>
                <p className="lede">
                  Connected{me!.spotifySyncedAt ? `, last synced ${me!.spotifySyncedAt.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}. Your followed and most-played
                  artists sync once a day.
                </p>
                <form action={disconnectSpotifyAction}>
                  <button className="btn link" type="submit">
                    Disconnect Spotify
                  </button>
                </form>
              </>
            ) : (
              <>
                <p className="lede">
                  Brings in the artists you follow and play most, ranked by how much you listen. Spotify only allows a few test accounts for now, so this works if the owner has added
                  you; otherwise, search below works just as well.
                </p>
                <a className="act ticket-btn" href="/api/spotify/connect">
                  <span className="tb-main">Connect</span>
                  <span className="tb-sub">Spotify</span>
                </a>
              </>
            )}
          </div>
        )}
        <div className="you-card">
          <h3>Add by search</h3>
          <ArtistSearch followingIds={followingIds} />
          <p className="small">
            <Link href="/artists">See and tune your artists</Link> (tiers decide how loudly you're alerted).
          </p>
        </div>
      </section>

      <section className="section you-step" aria-labelledby="s-tg">
        <h2 id="s-tg" className="section-title">
          <span className="step-no">2</span> Alerts on Telegram {tgConnected && <span className="count">connected ✓</span>}
        </h2>
        <div className="you-card">
          {v.isOwner ? (
            <p className="lede">Your alerts go to the chat set up in TELEGRAM_ALERT_CHAT_ID.</p>
          ) : tgConnected ? (
            <>
              <p className="lede">New shows, sale and early-bird reminders, and price changes for shows you&apos;re going to arrive in your chat with the Early Access bot.</p>
              <form action={disconnectTelegramAction}>
                <button className="btn link" type="submit">
                  Disconnect Telegram
                </button>
              </form>
            </>
          ) : tgLink ? (
            <>
              <p className="lede">Open the bot and tap Start. That links this account to your Telegram; the link works once.</p>
              <div className="chips">
                <a className="act insta-btn" href={tgLink} target="_blank" rel="noopener noreferrer">
                  <span className="act-text">
                    <span className="act-kicker">Telegram</span>Connect @{bot}
                  </span>
                </a>
                <form action={newTelegramLinkAction}>
                  <button className="btn link" type="submit">
                    New link
                  </button>
                </form>
              </div>
            </>
          ) : (
            <form action={newTelegramLinkAction}>
              <button className="btn" type="submit">
                Make a Telegram link
              </button>
            </form>
          )}
        </div>
      </section>

      <section className="section you-step" aria-labelledby="s-cal">
        <h2 id="s-cal" className="section-title">
          <span className="step-no">3</span> Your calendar
        </h2>
        <div className="you-card">
          <p className="lede">
            Shows you&apos;re going to (and maybes, as tentative) appear in your calendar and stay up to date. In Google Calendar: <b>Other calendars → + → From URL</b>, paste
            this, Add. Apple and Outlook have &quot;Subscribe&quot; too.
          </p>
          <div className="feed-row">
            <code className="feed-url">{feed}</code>
            <CopyButton value={feed} label="Copy link" />
          </div>
          <p className="small">This link is private: anyone with it can see your Going shows.</p>
          {!v.isOwner && (
            <form action={newCalendarLinkAction}>
              <button className="btn link" type="submit">
                Make a new link (the old one stops working)
              </button>
            </form>
          )}
        </div>
      </section>

      <section className="section you-step" aria-labelledby="s-home">
        <h2 id="s-home" className="section-title">Home city</h2>
        <div className="you-card">
          <form action={setHomeCityAction} className="chips">
            <label className="small" htmlFor="home-city">
              Shows elsewhere get a flight search from here
            </label>
            <select id="home-city" name="city" className="field" defaultValue={v.homeCity}>
              {radarConfig.cities.map((c) => (
                <option key={c.name}>{c.name}</option>
              ))}
            </select>
            <button className="btn" type="submit">
              Save
            </button>
          </form>
        </div>
      </section>

      <section className="section">
        <SignOutButton className="btn" />
      </section>
    </>
  );
}
