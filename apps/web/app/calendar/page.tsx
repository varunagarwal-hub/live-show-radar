import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { loadMonth, type ShowCard } from "@/lib/data";
import { cityCode } from "@/lib/format";

export const dynamic = "force-dynamic";

const monthName = new Intl.DateTimeFormat("en-IN", { month: "long", timeZone: "UTC" });
const dow = new Intl.DateTimeFormat("en-IN", { weekday: "short", timeZone: "UTC" });

function shift(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

function Act({ s }: { s: ShowCard }) {
  return (
    <span className="act">
      <span className="act-name">{s.artistName}</span>
      <span className={`city-code ${s.isHome ? "home" : "away"}`}>{cityCode(s.city)}</span>
      {s.decision === "going" && <span className="act-tag going">Going</span>}
      {s.decision === "maybe" && <span className="act-tag">Maybe</span>}
      {s.urgency === "urgent" && s.decision === null && <span className="act-tag">Tier {s.priorityTier}</span>}
    </span>
  );
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  await requireUser();
  const { m } = await searchParams;
  const todayIst = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const month = m && /^\d{4}-\d{2}$/.test(m) ? m : todayIst.slice(0, 7);
  const shows = await loadMonth(month);
  const byDay = new Map<string, ShowCard[]>();
  for (const s of shows) if (s.date) byDay.set(s.date, [...(byDay.get(s.date) ?? []), s]);

  const first = new Date(`${month}-01T00:00:00Z`);
  const daysInMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const cells = Array.from({ length: Math.ceil((lead + daysInMonth) / 7) * 7 }, (_, i) => {
    const day = i - lead + 1;
    return day >= 1 && day <= daysInMonth ? `${month}-${String(day).padStart(2, "0")}` : null;
  });

  return (
    <>
      <div className="flyer-head">
        <h1 className="flyer-month">
          {monthName.format(first)} <span>{first.getUTCFullYear()}</span>
        </h1>
        <div className="flyer-nav">
          <Link className="btn" href={`/calendar?m=${shift(month, -1)}`} aria-label="Previous month">
            Prev
          </Link>
          <Link className="btn" href={`/calendar?m=${shift(month, 1)}`} aria-label="Next month">
            Next
          </Link>
        </div>
      </div>
      <p className="lede">
        <span className="city-code home">BLR</span> blue ink is Bengaluru · <span className="city-code away">AWAY</span> dotted ink is elsewhere
      </p>

      {byDay.size === 0 && <p className="empty">No shows this month yet. The radar checks every 30 minutes.</p>}

      <ol className="listing calendar-list" aria-label="Shows this month">
        {[...byDay.entries()].map(([date, list]) => {
          const d = new Date(`${date}T00:00:00Z`);
          return (
            <li key={date}>
              <div className="day">
                {dow.format(d)}
                <b>{d.getUTCDate()}</b>
              </div>
              <div className="acts">
                {list.map((s) => (
                  <Act key={s.id} s={s} />
                ))}
              </div>
            </li>
          );
        })}
      </ol>

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
