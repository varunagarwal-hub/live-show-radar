import { BookList } from "@/components/BookList";
import { DealIn } from "@/components/DealIn";
import { Stub } from "@/components/Stub";
import { TriageDeck } from "@/components/TriageDeck";
import { requireUser } from "@/lib/auth";
import { loadShows, sortByDeadline } from "@/lib/data";

export const dynamic = "force-dynamic";

/**
 * Decide: the to-do list for shows. Tickets to book for Going shows, new shows to sort, and the
 * Maybes ranked by their decide-by deadline.
 */
export default async function DecidePage() {
  const v = await requireUser();
  const shows = await loadShows(v, { decisions: ["going", "maybe", "undecided"] });
  const going = sortByDeadline(shows.filter((s) => s.decision === "going")).sort((a, b) => Number(a.ticketsBooked) - Number(b.ticketsBooked));
  const fresh = shows.filter((s) => s.decision === null).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const maybe = sortByDeadline(shows.filter((s) => s.decision === "maybe"));
  const toBook = going.filter((s) => !s.ticketsBooked).length;

  return (
    <>
      <section className="section">
        <p className="tour-kicker">Your to-do list for shows</p>
        <h1 className="section-title">Decide</h1>
        <p className="lede">
          {toBook ? `${toBook} show${toBook === 1 ? "" : "s"} to book` : "Tickets sorted"} · {fresh.length} new to sort · {maybe.length} maybe
        </p>
      </section>

      <section className="section" aria-labelledby="new">
        <h2 id="new" className="section-title">
          New for you <span className="count">not decided yet</span>
        </h2>
        <TriageDeck shows={fresh} />
      </section>

      <section className="section" aria-labelledby="book">
        <h2 id="book" className="section-title">
          Book your tickets <span className="count">Going, soonest deadline first</span>
        </h2>
        {going.length ? <BookList shows={going} /> : <p className="empty">Tap Going on a show and it lands here until you&apos;ve got tickets.</p>}
      </section>

      <section className="section" aria-labelledby="maybe">
        <h2 id="maybe" className="section-title">
          Maybe <span className="count">earliest deadline first</span>
        </h2>
        {maybe.length ? (
          <DealIn className="stubs">
            {maybe.map((s) => (
              <Stub key={s.id} show={s} emphasis="decide" />
            ))}
          </DealIn>
        ) : (
          <p className="empty">No maybes. When you&apos;re unsure about a show, tap Maybe and it waits here with its early-bird or sale deadline.</p>
        )}
      </section>
    </>
  );
}
