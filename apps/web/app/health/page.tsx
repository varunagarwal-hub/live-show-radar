import { radarConfig } from "@radar/config";
import { requireUser } from "@/lib/auth";
import { setAccountActiveAction } from "@/lib/actions";
import { loadHealth } from "@/lib/data";

export const dynamic = "force-dynamic";

const when = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const fmt = (d: Date | null) => (d ? when.format(d) : "never");
const NAMES: Record<string, string> = { instagram: "Instagram", district: "District", bookmyshow: "BookMyShow", skillbox: "SkillBox", news: "Google News", email: "Fan-app emails" };

export default async function HealthPage() {
  await requireUser();
  const { health, runs, accounts, lastOk } = await loadHealth();
  const sources = health.filter((h) => !h.source.endsWith(":notes"));
  const notes = new Map(health.filter((h) => h.source.endsWith(":notes")).map((h) => [h.source.replace(/:notes$/, ""), h.lastError]));
  const errors = runs.filter((r) => r.status === "error").slice(0, 10);
  const staleCutoff = Date.now() - radarConfig.health.staleJobHours * 3_600_000;

  return (
    <>
      <section className="section">
        <h1 className="section-title">Sources</h1>
        {sources.length === 0 && <p className="empty">No source has reported yet. The first poll fills this in.</p>}
        <div className="table-wrap">
          <table className="plain-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Status</th>
                <th>Last good run</th>
                <th>Items</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => {
                const blocked = s.lastError?.startsWith("blocked");
                const label = blocked ? "Blocked by bot protection" : s.healthy ? "Healthy" : s.consecutiveFailures >= radarConfig.health.failureRunsBeforeUnhealthy ? `Failing (${s.consecutiveFailures} runs)` : `No listings since ${fmt(s.lastNonzeroAt)}`;
                return (
                  <tr key={s.source}>
                    <td>{NAMES[s.source] ?? s.source}</td>
                    <td>
                      <span className={`status-mark${s.healthy ? "" : blocked ? " warn" : " bad"}`}>{label}</span>
                    </td>
                    <td>{fmt(s.lastOkAt)}</td>
                    <td>{s.lastItemCount}</td>
                    <td>{[s.healthy ? null : s.lastError, notes.get(s.source)].filter(Boolean).join(" · ") || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Jobs</h2>
        <div className="table-wrap">
          <table className="plain-table">
            <thead>
              <tr>
                <th>Job</th>
                <th>Last success</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {["poll", "tiers", "watchlist", "sunday"].map((j) => {
                const ok = lastOk.get(j) ?? null;
                const stale = j !== "sunday" && (!ok || ok.getTime() < staleCutoff);
                return (
                  <tr key={j}>
                    <td>{j}</td>
                    <td>{fmt(ok)}</td>
                    <td>
                      <span className={`status-mark${stale ? " bad" : ""}`}>{stale ? "No success in 24 hours" : "On schedule"}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Recent errors</h2>
        {errors.length ? (
          <ul className="listing">
            {errors.map((r) => (
              <li key={r.id}>
                <div className="day">{r.job}</div>
                <div>
                  <div>{fmt(r.startedAt)}</div>
                  <div className="lede" style={{ margin: 0, overflowWrap: "anywhere" }}>
                    {r.error?.slice(0, 300)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">No job errors recently.</p>
        )}
      </section>

      <section className="section">
        <h2 className="section-title">Watched promoters and venues</h2>
        <div className="table-wrap">
          <table className="plain-table">
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id}>
                  <td>@{a.handle}</td>
                  <td>
                    {a.kind}
                    {a.city ? `, ${a.city}` : ""}
                  </td>
                  <td>
                    <form action={setAccountActiveAction.bind(null, a.id, !a.active)}>
                      <button className="btn link" type="submit">
                        {a.active ? "Stop watching" : "Watch again"}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
