import Link from "next/link";
import { SignOutButton } from "@/components/Chrome";
import { requireUser } from "@/lib/auth";

export default async function MorePage() {
  await requireUser();
  return (
    <section className="section">
      <h1 className="section-title">More</h1>
      <ul className="listing">
        <li>
          <div className="day">01</div>
          <div>
            <Link href="/artists" className="act-name">
              Artists
            </Link>
            <p className="lede" style={{ margin: "4px 0 0" }}>
              Your watchlist: priority tiers, Instagram handles, aliases, mute.
            </p>
          </div>
        </li>
        <li>
          <div className="day">02</div>
          <div>
            <Link href="/health" className="act-name">
              Health
            </Link>
            <p className="lede" style={{ margin: "4px 0 0" }}>
              Which sources are working, and when each job last ran.
            </p>
          </div>
        </li>
        <li>
          <div className="day">03</div>
          <div>
            <SignOutButton className="act-name linkish" />
            <p className="lede" style={{ margin: "4px 0 0" }}>
              Sign out of Early Access on this device. Alerts on Telegram keep coming.
            </p>
          </div>
        </li>
      </ul>
    </section>
  );
}
