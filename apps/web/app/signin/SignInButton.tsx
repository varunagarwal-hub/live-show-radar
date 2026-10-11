"use client";

import { signIn } from "next-auth/react";

export function SignInButton() {
  return (
    <button className="btn solid" onClick={() => signIn("google", { callbackUrl: "/" })}>
      Sign in with Google
    </button>
  );
}
