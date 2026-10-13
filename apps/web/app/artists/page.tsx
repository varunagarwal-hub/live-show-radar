import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { confirmHandleAction, saveArtistAction, setMutedAction } from "@/lib/actions";
import { loadArtists } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function ArtistsPage() {
  const v = await requireUser();
  const list = await loadArtists(v);
  const unconfirmed = v.isOwner ? list.filter((a) => a.handleStatus === "unconfirmed" && !a.muted) : [];
  return (
    <section className="section">
      <h1 className="section-title">
        Artists <span className="count">{list.length} watched</span>
      </h1>
      <p className="lede">
        Tier A: in your last four weeks of listening. Tier B: the last six months, or on repeat lately. Tier C: followed, rarely played. Tier A shows in any city alert loudly; you
        can change any tier here. <Link href="/you">Add more artists</Link>.
      </p>
      {unconfirmed.length > 0 && (
        <p className="empty">
          <span className="highlight">{unconfirmed.length} Instagram handles</span> are guesses. They're polled already, but alerts say so until you confirm them.
        </p>
      )}
      {list.length === 0 && (
        <p className="empty">
          No artists yet. <Link href="/you">Add some by search, or connect Spotify</Link>.
        </p>
      )}
      {list.map((a) => (
        <div key={a.id} className="artist-card" style={a.muted ? { opacity: 0.6 } : undefined}>
          <h3>
            {a.name}
            <span className={a.priorityTier === "A" ? "tier-a" : "count"} style={{ fontFamily: "var(--body)", fontSize: "0.9rem" }}>
              tier {a.priorityTier}
              {v.isOwner && a.listenedNotFollowed ? " · listened, not followed" : ""}
              {a.muted ? " · muted" : ""}
            </span>
          </h3>
          <form action={saveArtistAction} className="artist-form">
            <input type="hidden" name="id" value={a.id} />
            {v.isOwner && (
              <>
                <div>
                  <label className="small" htmlFor={`h${a.id}`}>
                    Instagram {a.handleStatus === "unconfirmed" ? <span className="highlight">unconfirmed</span> : a.handleStatus === "confirmed" ? "confirmed" : ""}
                  </label>
                  <input className="field" id={`h${a.id}`} name="instagramHandle" defaultValue={a.instagramHandle ?? ""} placeholder="handle" autoComplete="off" />
                </div>
                <div>
                  <label className="small" htmlFor={`al${a.id}`}>
                    Aliases (comma separated)
                  </label>
                  <input className="field" id={`al${a.id}`} name="aliases" defaultValue={a.aliases.join(", ")} autoComplete="off" />
                </div>
              </>
            )}
            <div>
              <label className="small" htmlFor={`t${a.id}`}>
                Tier
              </label>
              <select className="field" id={`t${a.id}`} name="priorityTier" defaultValue={a.priorityTier}>
                <option>A</option>
                <option>B</option>
                <option>C</option>
              </select>
            </div>
            <div className="chips">
              <button className="btn" type="submit">
                Save
              </button>
              {v.isOwner && a.handleStatus === "unconfirmed" && (
                <button className="btn" formAction={confirmHandleAction.bind(null, a.id)}>
                  Confirm handle
                </button>
              )}
              <button className="btn link" formAction={setMutedAction.bind(null, a.id, !a.muted)}>
                {a.muted ? "Unmute" : "Mute"}
              </button>
            </div>
          </form>
        </div>
      ))}
    </section>
  );
}
