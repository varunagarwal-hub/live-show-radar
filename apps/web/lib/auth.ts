import "server-only";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { NextAuthOptions } from "next-auth";
import { getServerSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { redirect } from "next/navigation";
import { cache } from "react";
import { ensureOwner } from "@radar/core/db/people";
import { kvGet } from "@radar/core/db/queries";
import { OWNER_USER_ID, users, type UserRow } from "@radar/core/db/schema";
import { getDb } from "./db";
import { checkPasswordLogin } from "./password-login";

const ownerEmail = () => (process.env.ALLOWED_EMAIL ?? "").trim().toLowerCase();

/**
 * Google sign-in (openid, email, profile only), open to any verified Google account. Getting in
 * is decided after sign-in: the owner (ALLOWED_EMAIL) always is; anyone else needs an account,
 * which an invite code (or open sign-ups, from the admin page) creates. Uses next-auth v4.
 */
export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.AUTH_GOOGLE_ID ?? "",
      clientSecret: process.env.AUTH_GOOGLE_SECRET ?? "",
      authorization: { params: { scope: "openid email profile", prompt: "select_account" } },
    }),
    // Username + password opens the owner's own dashboard, with full access (for a reviewer who
    // can't use the owner's Google account). Off unless LOGIN_USERNAME / LOGIN_PASSWORD_HASH are set.
    CredentialsProvider({
      id: "password",
      name: "Username and password",
      credentials: { username: { label: "Username", type: "text" }, password: { label: "Password", type: "password" } },
      async authorize(c) {
        if (!c?.username || !c.password || !ownerEmail()) return null;
        if (!(await checkPasswordLogin(c.username, c.password))) return null;
        return { id: "owner-password", email: ownerEmail(), name: "Reviewer" };
      },
    }),
  ],
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: "/signin", error: "/signin" },
  callbacks: {
    async signIn({ profile, user, account }) {
      if (account?.provider === "password") return true; // checked in authorize()
      const email = (profile?.email ?? user.email ?? "").toLowerCase();
      const verified = (profile as { email_verified?: boolean } | undefined)?.email_verified !== false;
      return Boolean(email) && verified;
    },
  },
};

export interface Viewer {
  id: number;
  email: string;
  name: string | null;
  isOwner: boolean;
  homeCity: string;
}

const toViewer = (u: UserRow): Viewer => ({ id: u.id, email: u.email, name: u.name, isOwner: u.id === OWNER_USER_ID, homeCity: u.homeCity });

/** The signed-in Google account, or null. */
export const sessionIdentity = cache(async (): Promise<{ email: string; name: string | null } | null> => {
  if (process.env.NODE_ENV === "development" && process.env.DEV_AUTH_BYPASS === "1") return { email: ownerEmail() || "dev@localhost", name: null };
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase();
  return email ? { email, name: session?.user?.name ?? null } : null;
});

export const newSecret = (bytes = 24) => randomBytes(bytes).toString("base64url");

/** Creates someone's account (invite redeemed, or sign-ups open). */
export async function createUser(email: string, name: string | null, inviteCode: string | null): Promise<UserRow> {
  const { db } = await getDb();
  const [row] = await db
    .insert(users)
    .values({ email, name, role: "member", calendarToken: newSecret(), telegramLinkToken: newSecret(12), inviteCode })
    .onConflictDoUpdate({ target: users.email, set: { name } })
    .returning();
  return row!;
}

export const signupsOpen = async () => (await kvGet<boolean>(await getDb(), "signup_open")) === true;

/** The signed-in person's account, or null when signed out or not let in yet. Never redirects. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const who = await sessionIdentity();
  if (!who) return null;
  const h = await getDb();
  if (who.email === ownerEmail()) {
    await ensureOwner(h, who.email);
    const [u] = await h.db.select().from(users).where(eq(users.id, OWNER_USER_ID));
    return u ? toViewer(u) : null;
  }
  const [u] = await h.db.select().from(users).where(eq(users.email, who.email));
  if (u) return toViewer(u);
  if (await signupsOpen()) return toViewer(await createUser(who.email, who.name, null));
  return null;
});

/**
 * Every page and server action calls this. Signed out → the sign-in page; signed in without an
 * account → the invite page. Local screenshots can skip Google with DEV_AUTH_BYPASS=1, which only
 * works under `next dev` (never in a production build).
 */
export async function requireUser(): Promise<Viewer> {
  const v = await getViewer();
  if (v) return v;
  redirect((await sessionIdentity()) ? "/join" : "/signin");
}

/** The owner's tools: health, invites, matching fixes. */
export async function requireOwner(): Promise<Viewer> {
  const v = await requireUser();
  if (!v.isOwner) redirect("/");
  return v;
}
