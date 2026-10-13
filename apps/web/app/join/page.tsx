import { redirect } from "next/navigation";
import { Crowd } from "@/components/Poster";
import { getViewer, sessionIdentity } from "@/lib/auth";
import { redeemInviteAction } from "@/lib/people-actions";
import { BackstagePass } from "../signin/BackstagePass";
import { SignInButton } from "../signin/SignInButton";

export const dynamic = "force-dynamic";

/**
 * The door for invited people. Signed out: sign in with Google first (coming back here with the
 * code). Signed in without an account: enter the code to get in.
 */
export default async function JoinPage({ searchParams }: { searchParams: Promise<{ code?: string; error?: string }> }) {
  const p = await searchParams;
  if (await getViewer()) redirect("/");
  const who = await sessionIdentity();
  const code = (p.code ?? "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 32);
  return (
    <section className="signin stage">
      <div className="spot spot-l si-spot-l" aria-hidden="true" />
      <div className="spot spot-r si-spot-r" aria-hidden="true" />
      <div className="si-copy">
        <p className="si-rise stage-kicker">
          <span className="si-door">Door 2</span> Invite only
        </p>
        <h1 className="poster-artist si-title">
          {["Got", "an", "invite?"].map((w, i) => (
            <span key={i}>
              {i > 0 && " "}
              <span className="pa-clip">
                <span className="si-word pa-word">{w}</span>
              </span>
            </span>
          ))}
        </h1>
        {who ? (
          <>
            <p className="poster-meta si-rise">
              Signed in as {who.email}. Enter the code from your invite and you&apos;re through the barricade.
            </p>
            {p.error && (
              <p role="alert" className="si-rise si-error">
                That code doesn&apos;t work: it may be used up, expired or mistyped. Ask whoever invited you for a fresh one.
              </p>
            )}
            <form action={redeemInviteAction} className="si-rise join-form">
              <label className="small" htmlFor="code">
                Invite code
              </label>
              <input id="code" name="code" className="field join-code" defaultValue={code} placeholder="e.g. K7Q2XM" autoComplete="off" autoCapitalize="characters" required />
              <button type="submit" className="act ticket-btn si-btn">
                <span className="tb-main">Get in</span>
                <span className="tb-sub">Use code</span>
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="poster-meta si-rise">Early Access tracks Indian shows by the artists you love and tells you before the early-birds are gone. First, sign in with Google.</p>
            <div className="si-rise">
              <SignInButton callbackUrl={`/join${code ? `?code=${code}` : ""}`} />
            </div>
          </>
        )}
      </div>
      <BackstagePass />
      <Crowd />
    </section>
  );
}
