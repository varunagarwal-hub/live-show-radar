import Link from "next/link";
import { radarConfig } from "@radar/config";
import { Poster } from "@/components/Poster";
import { Stub } from "@/components/Stub";
import { requireUser } from "@/lib/auth";
import { loadHome } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function NextUp() {
  await requireUser();
  if (!radarConfig.features.dashboard) return <p className="empty">The dashboard is switched off. Telegram alerts still work.</p>;
  const { nextUp, closingSoon, decide, recent, total } = await loadHome();

  return (
    <>
      {nextUp ? (
        <Poster show={nextUp} />
      ) : (
        <section className="poster">
          <div>
            <h1 className="poster-artist">Nothing booked yet</h1>
            <p className="poster-meta">Tap Going on a show and it'll be printed here.</p>
          </div>
        </section>
      )}

      <section className="section" aria-labelledby="closing">
        <h2 id="closing" className="section-title">
          Closing soon <span className="count">next 72 hours</span>
        </h2>
        {closingSoon.length ? (
          <div className="strip">
            {closingSoon.map((s) => (
              <Stub key={s.id} show={s} mini emphasis="closing" />
            ))}
          </div>
        ) : (
          <p className="empty">No early-birds or sales closing in the next three days.</p>
        )}
      </section>

      <section className="section" aria-labelledby="decide">
        <h2 id="decide" className="section-title">
          Decide by <Link href="/decide" className="count">see all</Link>
        </h2>
        {decide.length ? (
          <div className="stubs">
            {decide.slice(0, 4).map((s) => (
              <Stub key={s.id} show={s} emphasis="decide" />
            ))}
          </div>
        ) : (
          <p className="empty">Nothing to decide right now. Maybe a show and it'll land here with its deadline.</p>
        )}
      </section>

      <section className="section" aria-labelledby="recent">
        <h2 id="recent" className="section-title">
          Just announced
        </h2>
        {recent.length ? (
          <div className="stubs">
            {recent.map((s) => (
              <Stub key={s.id} show={s} />
            ))}
          </div>
        ) : (
          <p className="empty">{total ? "You've sorted every announced show." : "No shows announced yet. The radar checks every 30 minutes."}</p>
        )}
      </section>
    </>
  );
}
