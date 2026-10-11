import { Stub } from "@/components/Stub";
import { requireUser } from "@/lib/auth";
import { loadShows, sortByDeadline } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function DecidePage() {
  await requireUser();
  const shows = sortByDeadline(await loadShows({ decisions: ["maybe"] }));
  return (
    <section className="section">
      <h1 className="section-title">
        Decide by <span className="count">{shows.length} maybe</span>
      </h1>
      <p className="lede">Earliest deadline first: when early-bird closes, or when tickets go on sale if they aren't live yet.</p>
      {shows.length ? (
        <div className="stubs">
          {shows.map((s) => (
            <Stub key={s.id} show={s} emphasis="decide" />
          ))}
        </div>
      ) : (
        <p className="empty">Nothing to decide right now. Maybe a show and it'll land here with its deadline.</p>
      )}
    </section>
  );
}
