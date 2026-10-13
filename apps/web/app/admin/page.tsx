import { asc, count, desc, eq, sql } from "drizzle-orm";
import { follows, invites, users } from "@radar/core/db/schema";
import { CopyButton } from "@/components/CopyButton";
import { requireOwner, signupsOpen } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { createInviteAction, revokeInviteAction, setSignupsOpenAction } from "@/lib/people-actions";

export const dynamic = "force-dynamic";

const day = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });

/** The owner's door list: invite codes, open sign-ups, and who's joined. */
export default async function AdminPage() {
  await requireOwner();
  const { db } = await getDb();
  const [codes, people, open] = await Promise.all([
    db.select().from(invites).orderBy(desc(invites.createdAt)).limit(100),
    db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        createdAt: users.createdAt,
        invite: users.inviteCode,
        telegram: sql<boolean>`${users.telegramChatId} is not null`,
        spotify: sql<boolean>`${users.spotifyRefreshEnc} is not null`,
        artists: count(follows.artistId),
      })
      .from(users)
      .leftJoin(follows, eq(follows.userId, users.id))
      .groupBy(users.id)
      .orderBy(asc(users.id)),
    signupsOpen(),
  ]);
  const base = process.env.PUBLIC_BASE_URL ?? "";
  const now = Date.now();
  const state = (c: (typeof codes)[number]) =>
    c.revokedAt ? "revoked" : c.expiresAt && c.expiresAt.getTime() < now ? "expired" : c.uses >= c.maxUses ? "used up" : "active";

  return (
    <>
      <section className="section">
        <h1 className="section-title">Door list</h1>
        <p className="lede">
          New people sign in with Google, then enter an invite code (or open an invite link, which fills it in). Each code lets in as many people as you allow, until it expires or
          you revoke it.
        </p>
        <div className="you-card">
          <h3>New invite</h3>
          <form action={createInviteAction} className="invite-form">
            <div>
              <label className="small" htmlFor="note">
                For
              </label>
              <input id="note" name="note" className="field" placeholder="Mentor, class, friends…" maxLength={80} />
            </div>
            <div>
              <label className="small" htmlFor="code">
                Code (optional)
              </label>
              <input id="code" name="code" className="field" placeholder="random" maxLength={32} />
            </div>
            <div>
              <label className="small" htmlFor="maxUses">
                People
              </label>
              <input id="maxUses" name="maxUses" type="number" min={1} max={100} defaultValue={1} className="field" />
            </div>
            <div>
              <label className="small" htmlFor="days">
                Expires in (days, 0 = never)
              </label>
              <input id="days" name="days" type="number" min={0} max={365} defaultValue={14} className="field" />
            </div>
            <button className="act ticket-btn" type="submit">
              <span className="tb-main">Print</span>
              <span className="tb-sub">Invite</span>
            </button>
          </form>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">
          Invites <span className="count">{codes.filter((c) => state(c) === "active").length} active</span>
        </h2>
        {codes.length === 0 ? (
          <p className="empty">No invites yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="plain-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>For</th>
                  <th>Used</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {codes.map((c) => {
                  const s = state(c);
                  return (
                    <tr key={c.code}>
                      <td>
                        <code>{c.code}</code>
                      </td>
                      <td>{c.note ?? "—"}</td>
                      <td>
                        {c.uses} / {c.maxUses}
                      </td>
                      <td>{c.expiresAt ? day.format(c.expiresAt) : "never"}</td>
                      <td>
                        <span className={`status-mark${s === "active" ? "" : " warn"}`}>{s}</span>
                      </td>
                      <td className="chips">
                        {s === "active" && <CopyButton value={`${base}/join/${c.code}`} label="Copy link" />}
                        {s === "active" && (
                          <form action={revokeInviteAction.bind(null, c.code)}>
                            <button className="btn link" type="submit">
                              Revoke
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section">
        <h2 className="section-title">Open sign-ups</h2>
        <div className="you-card">
          <p className="lede">
            {open
              ? "On: anyone who signs in with Google gets in, no code needed."
              : "Off: new people need an invite code. Recommended while you're testing."}
          </p>
          <form action={setSignupsOpenAction.bind(null, !open)}>
            <button className="btn" type="submit">
              {open ? "Turn off (invite only)" : "Turn on (anyone can join)"}
            </button>
          </form>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">
          People <span className="count">{people.length}</span>
        </h2>
        <div className="table-wrap">
          <table className="plain-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Joined</th>
                <th>Invite</th>
                <th>Artists</th>
                <th>Telegram</th>
                <th>Spotify</th>
              </tr>
            </thead>
            <tbody>
              {people.map((u) => (
                <tr key={u.id}>
                  <td>
                    {u.email}
                    {u.role === "owner" ? " (you)" : ""}
                  </td>
                  <td>{day.format(u.createdAt)}</td>
                  <td>{u.invite ?? "—"}</td>
                  <td>{u.artists}</td>
                  <td>{u.role === "owner" || u.telegram ? "✓" : "—"}</td>
                  <td>{u.role === "owner" || u.spotify ? "✓" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small">
          Spotify import works only for accounts on your Spotify app&apos;s User Management list (5 at most, you included): developer.spotify.com → Dashboard → Early Access → User
          Management.
        </p>
      </section>
    </>
  );
}
