"use client";

import { signIn } from "next-auth/react";

/** Styled as the gig ticket from the stage: tear here to get in. */
export function SignInButton({ callbackUrl = "/" }: { callbackUrl?: string }) {
  return (
    <button type="button" className="act ticket-btn si-btn" onClick={() => signIn("google", { callbackUrl })}>
      <span className="tb-main">Get in</span>
      <span className="tb-sub">Sign in with Google</span>
    </button>
  );
}
