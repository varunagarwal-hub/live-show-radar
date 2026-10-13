import Link from "next/link";
import { SignOutButton } from "@/components/Chrome";
import { moreFor } from "@/lib/nav";
import { requireUser } from "@/lib/auth";

export default async function MorePage() {
  const v = await requireUser();
  const items = moreFor(v.isOwner);
  return (
    <section className="section">
      <h1 className="section-title">More</h1>
      <ul className="listing">
        {items.map((m, i) => (
          <li key={m.href}>
            <div className="day">{String(i + 1).padStart(2, "0")}</div>
            <div>
              <Link href={m.href} className="act-name">
                {m.label}
              </Link>
              <p className="lede" style={{ margin: "4px 0 0" }}>
                {m.note}
              </p>
            </div>
          </li>
        ))}
        <li>
          <div className="day">{String(items.length + 1).padStart(2, "0")}</div>
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
