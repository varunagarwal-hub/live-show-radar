import { SignInButton } from "./SignInButton";

export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <section className="signin">
      <h1 className="poster-artist" style={{ fontSize: "clamp(3rem, 14vw, 6rem)" }}>
        Who&rsquo;s on the list?
      </h1>
      <p className="poster-meta">This radar belongs to one person. Sign in with the Google account it was set up for.</p>
      {error && (
        <p role="alert" className="empty">
          That account isn&rsquo;t on the list. Only the email in ALLOWED_EMAIL can get in.
        </p>
      )}
      <div>
        <SignInButton />
      </div>
    </section>
  );
}
