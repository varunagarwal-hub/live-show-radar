"use client";

import { signIn } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import { gsap, prefersReducedMotion } from "@/components/motion";

/**
 * The "this is a test build" note that opens whenever someone lands on the sign-in page: why
 * Spotify sign-in is limited, that the demo runs on live data, and the shared demo login with a
 * one-tap way in. "About this demo" brings it back after it's closed.
 */
export function DemoNotice({ username, password }: { username: string; password: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const open = () => {
    const d = dialog.current;
    if (!d || d.open) return;
    d.showModal();
    if (!prefersReducedMotion()) gsap.fromTo(d.querySelector(".notice-card"), { y: 30, rotate: -3, opacity: 0 }, { y: 0, rotate: -1, opacity: 1, duration: 0.5, ease: "back.out(1.6)" });
  };
  const close = () => dialog.current?.close();

  useEffect(() => {
    open();
  }, []);

  return (
    <>
      <button type="button" className="linkish si-pw-toggle" onClick={open}>
        About this demo
      </button>
      <dialog ref={dialog} className="notice-dialog" aria-labelledby="notice-title" onClick={(e) => e.target === e.currentTarget && close()} onClose={close}>
        <div className="notice-card">
          <p className="notice-tag">Soundcheck · test build</p>
          <h2 id="notice-title">Early Access is still in development</h2>
          <p>
            Thanks for checking it out. This app is under development and in testing, so a few doors aren&apos;t open to everyone yet.
          </p>
          <p>
            <b>Why not everyone can sign in with Spotify:</b> the Spotify login is built and works, but Spotify only allows 5 accounts per app until a
            project becomes a registered business with about 250,000 users. So for now, Spotify import is for invited testers (5 at most).
          </p>
          <p>
            <b>To explore the full app,</b> use the demo account. It runs on <b>live, real-time data</b>: real shows announced in India by the
            artists on this watchlist, checked every 30 minutes from Instagram, news and ticketing sites, with real booking links and Telegram
            alerts. Nothing in it is sample or made-up data.
          </p>
          <dl className="notice-creds">
            <div>
              <dt>Username</dt>
              <dd>
                <code>{username}</code>
              </dd>
            </div>
            <div>
              <dt>Password</dt>
              <dd>
                <code>{password}</code>
              </dd>
            </div>
          </dl>
          {failed && <p className="si-error">That didn&apos;t work. Try the &quot;Have a username and password?&quot; option on the page.</p>}
          <div className="notice-actions">
            <button
              type="button"
              className="act ticket-btn si-btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const r = await signIn("password", { username, password, redirect: false, callbackUrl: "/" });
                if (r?.ok && !r.error) {
                  window.location.href = "/";
                } else {
                  setBusy(false);
                  setFailed(true);
                }
              }}
            >
              <span className="tb-main">{busy ? "Opening…" : "Try it"}</span>
              <span className="tb-sub">Open the live demo</span>
            </button>
            <button type="button" className="btn" onClick={close}>
              Look around first
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
