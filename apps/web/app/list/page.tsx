import Link from "next/link";
import { radarConfig } from "@radar/config";
import { Stub } from "@/components/Stub";
import { requireUser } from "@/lib/auth";
import { loadShows } from "@/lib/data";

export const dynamic = "force-dynamic";

type Params = { city?: string; tier?: string; status?: string; from?: string; to?: string };
const STATUSES = [
  ["undecided", "Not decided"],
  ["going", "Going"],
  ["maybe", "Maybe"],
  ["pass", "Passed"],
] as const;

function href(p: Params, change: Partial<Params>) {
  const next = { ...p, ...change };
  const q = new URLSearchParams(Object.entries(next).filter(([, v]) => v) as [string, string][]);
  return `/list${q.size ? `?${q}` : ""}`;
}

export default async function ListPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireUser();
  const p = await searchParams;
  const city = radarConfig.cities.find((c) => c.name === p.city)?.name;
  const tier = (["A", "B", "C"] as const).find((t) => t === p.tier);
  const status = STATUSES.find(([k]) => k === p.status)?.[0];
  const date = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
  const shows = await loadShows({ cities: city ? [city] : undefined, tiers: tier ? [tier] : undefined, decisions: status ? [status] : undefined, from: date(p.from), to: date(p.to) });
  const visible = status === "pass" ? shows : shows.filter((s) => s.decision !== "pass" && s.decision !== "not_interested");

  return (
    <section className="section">
      <h1 className="section-title">
        Every show <span className="count">{visible.length}</span>
      </h1>
      <div className="chips" role="group" aria-label="City">
        <Link className="chip" aria-current={!city ? "true" : undefined} href={href(p, { city: undefined })}>
          All cities
        </Link>
        {radarConfig.cities.map((c) => (
          <Link key={c.name} className="chip" aria-current={city === c.name ? "true" : undefined} href={href(p, { city: c.name })}>
            {c.name}
          </Link>
        ))}
      </div>
      <div className="chips" role="group" aria-label="Priority tier" style={{ marginTop: 10 }}>
        {(["A", "B", "C"] as const).map((t) => (
          <Link key={t} className="chip" aria-current={tier === t ? "true" : undefined} href={href(p, { tier: tier === t ? undefined : t })}>
            Tier {t}
          </Link>
        ))}
        {STATUSES.map(([k, label]) => (
          <Link key={k} className="chip" aria-current={status === k ? "true" : undefined} href={href(p, { status: status === k ? undefined : k })}>
            {label}
          </Link>
        ))}
      </div>
      <form className="chips" action="/list" style={{ marginTop: 10, alignItems: "flex-end" }}>
        {city && <input type="hidden" name="city" value={city} />}
        {tier && <input type="hidden" name="tier" value={tier} />}
        {status && <input type="hidden" name="status" value={status} />}
        <div>
          <label className="small" htmlFor="from">
            From
          </label>
          <input className="field" id="from" name="from" type="date" defaultValue={date(p.from)} />
        </div>
        <div>
          <label className="small" htmlFor="to">
            To
          </label>
          <input className="field" id="to" name="to" type="date" defaultValue={date(p.to)} />
        </div>
        <button className="btn" type="submit">
          Show dates
        </button>
      </form>

      <div className="stubs" style={{ marginTop: 20 }}>
        {visible.map((s) => (
          <Stub key={s.id} show={s} />
        ))}
      </div>
      {!visible.length && <p className="empty">No shows match those filters. Try fewer of them.</p>}
    </section>
  );
}
