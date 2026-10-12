import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Which commit the live dashboard was built from. The deploy safety net
 * (.github/workflows/deploy.yml) polls this after every push. Public on purpose: the repository
 * is public, so the commit id reveals nothing.
 */
export function GET() {
  return NextResponse.json(
    { sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null, env: process.env.VERCEL_ENV ?? "development" },
    { headers: { "cache-control": "no-store" } },
  );
}
