"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";

/** "Have a username and password?": the reviewer's way in, folded away under the Google button. */
export function PasswordLogin() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" className="linkish si-pw-toggle" onClick={() => setOpen(true)}>
        Have a username and password?
      </button>
    );
  }
  return (
    <form
      className="si-pw"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setError(null);
        const r = await signIn("password", { username: String(f.get("username") ?? ""), password: String(f.get("password") ?? ""), redirect: false, callbackUrl: "/" });
        setBusy(false);
        if (r?.ok && !r.error) window.location.href = "/";
        else setError("That username and password don't match. After a few wrong tries, sign-in pauses for 15 minutes.");
      }}
    >
      <label className="small" htmlFor="pw-user">
        Username
      </label>
      <input id="pw-user" name="username" className="field" autoComplete="username" required autoFocus />
      <label className="small" htmlFor="pw-pass">
        Password
      </label>
      <input id="pw-pass" name="password" type="password" className="field" autoComplete="current-password" required />
      {error && (
        <p role="alert" className="si-error">
          {error}
        </p>
      )}
      <button type="submit" className="act ticket-btn si-btn" disabled={busy}>
        <span className="tb-main">{busy ? "Checking…" : "Get in"}</span>
        <span className="tb-sub">Username</span>
      </button>
    </form>
  );
}
