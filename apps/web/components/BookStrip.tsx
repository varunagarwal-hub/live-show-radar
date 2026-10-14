import type { ShowCard } from "@/lib/data";
import { cityCode, DEADLINE_LABEL, shortWhen, stubDate } from "@/lib/format";
import { TicketButton } from "./ActionButtons";
import { ScrollStrip } from "./ScrollStrip";

/** One line on where the tickets stand. */
function status(s: ShowCard): string {
  if (s.soldOut) return "Sold out";
  if (s.saleStartsAt && Date.parse(s.saleStartsAt) > Date.now()) return `On sale ${shortWhen(s.saleStartsAt)}`;
  if (s.deadline) return `${DEADLINE_LABEL[s.deadline.kind]} ${shortWhen(s.deadline.at)}`;
  return s.ticketUrl ? "Booking page ready" : "Finding the booking page";
}

/**
 * Next up → "Still to book": compact cards for Going shows without tickets yet (and Maybes when
 * there are some), each with its booking page. The full list with "Got tickets" lives on Decide.
 */
export function BookStrip({ shows }: { shows: ShowCard[] }) {
  return (
    <ScrollStrip label="shows to book" className="book-strip">
      {shows.map((s) => (
        <div key={s.id} className={`book-card${s.isHome ? " home" : " away"}`}>
          <div className="book-card-top">
            <span className={`city-code ${s.isHome ? "home" : "away"}`}>{cityCode(s.city)}</span>
            <b>{s.date ? stubDate(s.date, s.endDate) : "Date TBA"}</b>
            {s.decision === "maybe" && <span className="highlight">Maybe</span>}
          </div>
          <b className="book-card-artist">{s.artistName}</b>
          <span className="book-card-venue">{[s.venue, s.city].filter(Boolean).join(", ")}</span>
          <span className="book-card-status">{status(s)}</span>
          <TicketButton href={s.ticketUrl ?? s.searchUrl} label="Tickets" sub={s.ticketUrl ? "Book now" : "Search"} />
        </div>
      ))}
    </ScrollStrip>
  );
}
