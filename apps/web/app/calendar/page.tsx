import Link from "next/link";
import { DealIn } from "@/components/DealIn";
import { requireUser } from "@/lib/auth";
import { loadMonth, type ShowCard } from "@/lib/data";
import { cityCode } from "@/lib/format";

export const dynamic = "force-dynamic";

const monthName = new Intl.DateTimeFormat("en-IN", { month: "long", timeZone: "UTC" });
const dow = new Intl.DateTimeFormat("en-IN", { weekday: "short", timeZone: "UTC" });

function shift(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
}

function Act({ s }: { s: ShowCard }) {
  return (
    <span className="act">
      <span className="act-name">{s.artistName}</span>
      <span className={`city-code ${s.isHome ? "home" : "away"}`}>{cityCode(s.city)}</span>
      {s.decision === "going" && <span className="act-tag going">Going</span>}
      {s.decision === "maybe" && <span className="act-tag">Maybe</span>}
    </span>
  );
}

/**
 * The month as the back of a tour t-shirt: every show stacked as a date and a city in big
 * condensed type, your Going shows printed in reverse and your Maybes highlighted. On desktop the
 * month grid follows underneath, for a quick look at weekends.
 */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  await requireUser();
  const { m } = await searchParams;
  const todayIst = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const month = m && /^\d{4}-\d{2}$/.test(m) ? m : todayIst.slice(0, 7);
  const shows = (await loadMonth(month)).filter((s) => s.date);
  const byDay = new Map<string, ShowCard[]>();
  for (const s of shows) byDay.set(s.date!, [...(byDay.get(s.date!) ?? []), s]);

  const first = new Date(`${month}-01T00:00:00Z`);
  const daysInMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const cells = Array.from({ length: Math.ceil((lead + daysInMonth) / 7) * 7 }, (_, i) => {
    const day = i - lead + 1;
    return day >= 1 && day <= daysInMonth ? `${month}-${String(day).padStart(2, "0")}` : null;
  });

  return (
    <>
      <header className="tour-head">
        <p className="tour-kicker">{tourKicker(shows)}</p>
        <h1 className="tour-title">
          <span>Tour dates</span>
          <span className="tour-month">
            {monthName.format(first)} {first.getUTCFullYear()}
          </span>
        </h1>
        <nav className="flyer-nav" aria-label="Month">
          <Link className="btn" href={`/calendar?m=${shift(month, -1)}`}>
            ← {monthName.format(new Date(`${shift(month, -1)}-01T00:00:00Z`))}
          </Link>
          <Link className="btn" href={`/calendar?m=${shift(month, 1)}`}>
            {monthName.format(new Date(`${shift(month, 1)}-01T00:00:00Z`))} →
          </Link>
        </nav>
        <p className="lede">
          <span className="city-code home">BLR</span> blue ink is Bengaluru · <span className="city-code away">AWAY</span> dotted ink is elsewhere
        </p>
      </header>

      {shows.length === 0 ? (
        <p className="empty">No shows this month yet. The radar checks every 30 minutes.</p>
      ) : (
        <DealIn className="tour-list">
          {shows.map((s) => {
            const d = new Date(`${s.date}T00:00:00Z`);
            return (
              <div key={s.id} className={`tour-row${s.decision === "going" ? " going" : ""}${s.decision === "maybe" ? " maybe" : ""}`}>
                <div className="tour-date">
                  <span>{dow.format(d)}</span>
                  <b>
                    {String(d.getUTCDate()).padStart(2, "0")}.{String(d.getUTCMonth() + 1).padStart(2, "0")}
                  </b>
                </div>
                <div className="tour-where">
                  <span className="tour-city">{s.city}</span>
                  <span className="tour-who">
                    {s.artistName}
                    {s.venue ? ` · ${s.venue}` : ""}
                  </span>
                </div>
                <div className="tour-mark">
                  <span className={`city-code ${s.isHome ? "home" : "away"}`}>{cityCode(s.city)}</span>
                  {s.decision === "going" && <span className="tour-admit">Admitted</span>}
                  {s.decision === "maybe" && <span className="highlight">Maybe</span>}
                  {s.unconfirmed && <span className="tour-unconf">Unconfirmed</span>}
                </div>
              </div>
            );
          })}
        </DealIn>
      )}

      <h2 className="section-title month-grid-title">The month at a glance</h2>
      <div className="month-grid" role="grid" aria-label="Month">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="dow" role="columnheader">
            {d}
          </div>
        ))}
        {cells.map((date, i) => (
          <div key={date ?? `x${i}`} role="gridcell" className={`cell${date ? "" : " out"}${date === todayIst ? " today" : ""}`}>
            {date && <span className="num">{Number(date.slice(8))}</span>}
            {date && byDay.get(date)?.map((s) => <Act key={s.id} s={s} />)}
          </div>
        ))}
      </div>
    </>
  );
}

/** "4 shows · 2 going · 1 maybe": what this month's page holds, in tour-poster caps. */
function tourKicker(shows: { decision: string | null }[]): string {
  if (!shows.length) return "On the road";
  const going = shows.filter((s) => s.decision === "going").length;
  const maybe = shows.filter((s) => s.decision === "maybe").length;
  return [`${shows.length} show${shows.length === 1 ? "" : "s"}`, going ? `${going} going` : null, maybe ? `${maybe} maybe` : null].filter(Boolean).join(" · ");
}
