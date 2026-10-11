import { NextResponse } from "next/server";
import { z } from "zod";
import { radarConfig } from "@radar/config";
import { contentHash, dedupKey } from "@radar/core";
import { rawItems } from "@radar/core/db/schema";
import { emailToRawItem, IngestEmailSchema } from "@radar/sources";
import { getDb } from "@/lib/db";
import { secretMatches } from "@/lib/secrets";

export const dynamic = "force-dynamic";

const Body = z.object({ messages: z.array(IngestEmailSchema).min(1).max(25) });

/**
 * Fan-app emails pushed by apps-script/gmail-forwarder.gs. Authenticated with a shared secret
 * (Authorization: Bearer INGEST_EMAIL_SECRET). Stored as unprocessed raw items; the poll job
 * extracts them. Email bodies are never logged.
 */
export async function POST(req: Request) {
  const auth = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secretMatches(auth, process.env.INGEST_EMAIL_SECRET)) return new NextResponse("unauthorized", { status: 401 });
  if (!radarConfig.features.fanEmails) return NextResponse.json({ stored: 0, note: "fan emails are switched off" });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const items = parsed.data.messages.map(emailToRawItem);
  const { db } = await getDb();
  const stored = await db
    .insert(rawItems)
    .values(
      items.map((it) => ({
        source: it.source,
        externalId: it.externalId,
        contentHash: contentHash(it.text),
        dedupKey: dedupKey(it.source, it.externalId, it.text),
        url: it.url,
        text: it.text,
        meta: it.meta,
        publishedAt: it.publishedAt ?? null,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: rawItems.id });

  // Optional: start a poll run right away instead of waiting for the next cron tick.
  const repo = process.env.GITHUB_REPOSITORY;
  const ghToken = process.env.GITHUB_DISPATCH_TOKEN;
  if (stored.length && repo && ghToken) {
    await fetch(`https://api.github.com/repos/${repo}/actions/workflows/poll.yml/dispatches`, {
      method: "POST",
      headers: { authorization: `Bearer ${ghToken}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
      body: JSON.stringify({ ref: process.env.GITHUB_REF_NAME || "main" }),
    }).catch(() => {});
  }
  return NextResponse.json({ stored: stored.length });
}
