import Link from "next/link";
import { radarConfig } from "@radar/config";
import { DealIn } from "@/components/DealIn";
import { Marquee } from "@/components/Marquee";
import { StageCarousel } from "@/components/StageCarousel";
import { Stub } from "@/components/Stub";
import { requireUser } from "@/lib/auth";
import { loadHome, type ShowCard } from "@/lib/data";
import { DEADLINE_LABEL, shortCountdown, stubDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/** What scrolls across the marquee: the next gig, then anything closing soon or undecided. */
function marqueeItems(going: ShowCard[], closing: ShowCard[], decide: ShowCard[]): string[] {
  const items: string[] = [];
  going.slice(0, 5).forEach((s, i) => items.push(`${i === 0 ? "Next up" : "Then"}: ${s.artistName} · ${s.city} · ${stubDate(s.date, s.endDate)}`));
  for (const s of closing.slice(0, 4)) items.push(`${s.artistName} · ${DEADLINE_LABEL[s.deadline!.kind].toLowerCase()} in ${shortCountdown(s.deadline!.at)}`);
  for (const s of decide.slice(0, 3)) if (!closing.includes(s)) items.push(`Still deciding: ${s.artistName} · ${s.city}`);
  return items.map((t) => t.toUpperCase());
}

export default async function NextUp() {
  await requireUser();
  if (!radarConfig.features.dashboard) return <p className="empty">The dashboard is switched off. Telegram alerts still work.</p>;
  const { goingNext, closingSoon, decide, recent, total } = await loadHome();

  return (
    <>
      <Marquee items={marqueeItems(goingNext, closingSoon, decide)} />

      {goingNext.length ? (
        <StageCarousel shows={goingNext} />
      ) : (
        <section className="stage empty-stage">
          <div className="stage-inner">
            <h1 className="poster-artist">Nothing booked yet</h1>
            <p className="poster-meta">Tap Going, or tear a stub off, and it'll be up in lights here.</p>
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
          <DealIn className="stubs">
            {decide.slice(0, 4).map((s) => (
              <Stub key={s.id} show={s} emphasis="decide" />
            ))}
          </DealIn>
        ) : (
          <p className="empty">Nothing to decide right now. Maybe a show and it'll land here with its deadline.</p>
        )}
      </section>

      <section className="section" aria-labelledby="recent">
        <h2 id="recent" className="section-title">
          Just announced
        </h2>
        {recent.length ? (
          <DealIn className="stubs">
            {recent.map((s) => (
              <Stub key={s.id} show={s} />
            ))}
          </DealIn>
        ) : (
          <p className="empty">{total ? "You've sorted every announced show." : "No shows announced yet. The radar checks every 30 minutes."}</p>
        )}
      </section>
    </>
  );
}
