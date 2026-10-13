import { Crowd } from "@/components/Poster";
import { BackstagePass } from "./BackstagePass";
import { SignInButton } from "./SignInButton";

const HEADLINE = ["Who’s", "on", "the", "list?"];

export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
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
        <p className="poster-meta si-rise">This radar belongs to one person. Show your pass: sign in with the Google account it was set up for.</p>
        {error && (
          <p role="alert" className="si-rise si-error">
            That account isn&rsquo;t on the list. Only the email in ALLOWED_EMAIL can get in.
          </p>
        )}
        <div className="si-rise">
          <SignInButton />
        </div>
        <p className="si-rise si-small">Every show your artists announce in India, before the early-birds are gone.</p>
      </div>
      <BackstagePass />
      <Crowd />
    </section>
  );
}
