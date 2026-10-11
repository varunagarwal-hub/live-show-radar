import "server-only";
import type { NextAuthOptions } from "next-auth";
import { getServerSession } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { redirect } from "next/navigation";

const allowed = () => (process.env.ALLOWED_EMAIL ?? "").trim().toLowerCase();

/**
 * Google sign-in (openid, email, profile only) restricted to ALLOWED_EMAIL. Uses next-auth v4,
 * the stable Auth.js line; v5 is still published as a beta.
 */
export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.AUTH_GOOGLE_ID ?? "",
      clientSecret: process.env.AUTH_GOOGLE_SECRET ?? "",
      authorization: { params: { scope: "openid email profile", prompt: "select_account" } },
    }),
  ],
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: "/signin", error: "/signin" },
  callbacks: {
    async signIn({ profile, user }) {
      const email = (profile?.email ?? user.email ?? "").toLowerCase();
      const verified = (profile as { email_verified?: boolean } | undefined)?.email_verified !== false;
      return Boolean(allowed()) && email === allowed() && verified;
    },
  },
};

/**
 * Every page and server action calls this. Local screenshots can skip Google sign-in with
 * DEV_AUTH_BYPASS=1, which only works under `next dev` (never in a production build).
 */
export async function requireUser(): Promise<{ email: string }> {
  if (process.env.NODE_ENV === "development" && process.env.DEV_AUTH_BYPASS === "1") return { email: allowed() || "dev@localhost" };
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase();
  if (!email || email !== allowed()) redirect("/signin");
  return { email };
}
