import Link from "next/link";
import { radarConfig } from "@radar/config";
import { BookStrip } from "@/components/BookStrip";
import { DealIn } from "@/components/DealIn";
import { Marquee } from "@/components/Marquee";
import { StageCarousel } from "@/components/StageCarousel";
import { ScrollStrip } from "@/components/ScrollStrip";
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
  const v = await requireUser();
  if (!radarConfig.features.dashboard) return <p className="empty">The dashboard is switched off. Telegram alerts still work.</p>;
  const { goingNext, closingSoon, decide, recent, total } = await loadHome(v);
  const toBook = goingNext.filter((s) => !s.ticketsBooked);

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

      {/* Only when something actually closes in the next 72 hours. */}
      {closingSoon.length > 0 && (
        <section className="section" aria-labelledby="closing">
          <h2 id="closing" className="section-title">
            Closing soon <span className="count">next 72 hours</span>
          </h2>
          <ScrollStrip label="closing shows">
            {closingSoon.map((s) => (
              <Stub key={s.id} show={s} mini emphasis="closing" />
            ))}
          </ScrollStrip>
        </section>
      )}

      {/* What needs doing: tickets still to buy for Going shows, then any Maybes with a
          deadline. Hidden when there's nothing to act on, instead of an empty box. */}
      {(toBook.length > 0 || decide.length > 0) && (
        <section className="section" aria-labelledby="todo">
          <h2 id="todo" className="section-title">
            {toBook.length ? "Still to book" : "Decide by"}{" "}
            <Link href="/decide" className="count">
              {toBook.length ? `${toBook.length} without tickets · see all` : "see all"}
            </Link>
          </h2>
          <BookStrip shows={[...toBook.slice(0, 8), ...decide.slice(0, 4)]} />
        </section>
      )}

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
