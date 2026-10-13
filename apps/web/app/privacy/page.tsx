import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy · Early Access" };

/** Public privacy policy (Google sign-in requires one to publish the app). Plain and specific. */
export default function PrivacyPage() {
  return (
    <section className="section privacy">
      <h1 className="section-title">Privacy</h1>
      <p className="lede">
        Early Access is a small, free, non-commercial project that tells you when artists you like announce shows in India. This page says what it stores about you and why. Last
        updated 13 October 2026.
      </p>

      <h2 className="section-title">What we store</h2>
      <ul className="coverage">
        <li>
          <b>From Google sign-in:</b> your email address and name. Nothing else from your Google account is read.
        </li>
        <li>
          <b>Your radar:</b> the artists you add, your tiers and mutes, your Going / Maybe / Pass choices, and your home city.
        </li>
        <li>
          <b>If you connect Spotify:</b> the artists you follow, your top artists and your recently played artists, used only to build your artist list. Your Spotify sign-in token
          is stored encrypted, and you can disconnect at any time.
        </li>
        <li>
          <b>If you connect Telegram:</b> your Telegram chat ID, so the bot can send you alerts. The messages you send the bot are answered and not kept.
        </li>
      </ul>

      <h2 className="section-title">What we don&apos;t do</h2>
      <ul className="coverage">
        <li>No selling, sharing or advertising. Your data is used only to run your radar.</li>
        <li>No posting, following or playlist changes on your Spotify. Access is read-only.</li>
        <li>No buying tickets or entering payment details, ever.</li>
      </ul>

      <h2 className="section-title">Where it lives</h2>
      <p className="lede">
        In a Postgres database hosted by Neon, the website on Vercel, and scheduled jobs on GitHub Actions. Questions you ask the Telegram bot are answered with help from Google
        Gemini or Groq, using only show listings, never your account details.
      </p>

      <h2 className="section-title">Leaving</h2>
      <p className="lede">
        Disconnect Spotify or Telegram any time from the You page. To delete your account and everything stored about you, ask the person who invited you (the owner of this
        Early Access), and it will be removed within 7 days.
      </p>
    </section>
  );
}
