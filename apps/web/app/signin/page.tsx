import { redirect } from "next/navigation";
import { Crowd } from "@/components/Poster";
import { getViewer, sessionIdentity } from "@/lib/auth";
import { BackstagePass } from "./BackstagePass";
import { SignInButton } from "./SignInButton";
import { DemoVideo } from "./DemoVideo";
import { PasswordLogin } from "./PasswordLogin";
import { DEMO_VIDEO } from "@/lib/demo";
import { passwordLoginEnabled } from "@/lib/password-login";

const HEADLINE = ["Who’s", "on", "the", "list?"];

export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  // Already in: go to the radar. Signed in but not on the list yet: the invite page.
  if (await getViewer()) redirect("/");
  if (await sessionIdentity()) redirect("/join");
  return (
    <section className="signin stage">
      <div className="spot spot-l si-spot-l" aria-hidden="true" />
      <div className="spot spot-r si-spot-r" aria-hidden="true" />
      <div className="si-copy">
        <p className="si-rise stage-kicker">
          <span className="si-door">Door 1</span> Guest list only
        </p>
        <h1 className="poster-artist si-title">
          {HEADLINE.map((w, i) => (
            <span key={i}>
              {i > 0 && " "}
              <span className="pa-clip">
                <span className="si-word pa-word">{w}</span>
              </span>
            </span>
          ))}
        </h1>
        <p className="poster-meta si-rise">The guest list is invite-only, and the bouncer knows your face. Flash your Google pass and head straight for the barricade.</p>
        {error && (
          <p role="alert" className="si-rise si-error">
            Google sign-in didn&rsquo;t go through. Give it another go.
          </p>
        )}
        <div className="si-rise si-actions">
          <SignInButton />
          {DEMO_VIDEO && <DemoVideo src={DEMO_VIDEO.src} poster={DEMO_VIDEO.poster} />}
        </div>
        {passwordLoginEnabled() && (
          <div className="si-rise">
            <PasswordLogin />
          </div>
        )}
        <p className="si-rise si-small">
          Every show your artists announce in India, before the early-birds are gone. Got an invite? Sign in, then enter your code. <a href="/privacy">Privacy</a>
        </p>
      </div>
      <BackstagePass />
      <Crowd />
    </section>
  );
}
