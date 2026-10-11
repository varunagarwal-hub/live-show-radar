import { z } from "zod";
import { HttpError, fetchWithRetry, redactUrl, type LlmImage, type WatchArtist } from "@radar/core";
import type { RawItem, Source, SourceContext, SourceHealth, WatchedAccountRef } from "./types";

const Media = z.object({
  id: z.string(),
  caption: z.string().optional(),
  media_type: z.string().optional(),
  media_url: z.string().optional(),
  thumbnail_url: z.string().optional(),
  permalink: z.string().optional(),
  timestamp: z.string().optional(),
  children: z.object({ data: z.array(z.object({ media_url: z.string().optional(), media_type: z.string().optional() })) }).optional(),
});
export type IgMedia = z.infer<typeof Media>;

const BusinessDiscovery = z.object({
  business_discovery: z.object({
    username: z.string(),
    media: z.object({ data: z.array(Media) }).optional(),
  }),
});

const GraphError = z.object({ error: z.object({ message: z.string(), code: z.number().optional(), error_subcode: z.number().optional() }) });

export interface InstagramConfig {
  userId: string;
  accessToken: string;
  version: string;
  callsPerHour: number;
  postsPerCall: number;
  pollMinutes: number;
  intervals: { A: number; B: number; C: number; account: number };
  /** Ignore posts older than this. */
  maxPostAgeDays?: number;
}

export class InstagramTokenError extends Error {}
export class HandleNotFoundError extends Error {}

const MEDIA_FIELDS = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,children{media_url,media_type}";

/** Business Discovery URL without the token (safe to log). */
export function businessDiscoveryUrl(cfg: Pick<InstagramConfig, "userId" | "version" | "postsPerCall">, handle: string): string {
  const fields = `business_discovery.username(${handle}){username,media.limit(${cfg.postsPerCall}){${MEDIA_FIELDS}}}`;
  return `https://graph.facebook.com/${cfg.version}/${cfg.userId}?fields=${encodeURIComponent(fields)}`;
}

export function withToken(url: string, token: string): string {
  return `${url}&access_token=${encodeURIComponent(token)}`;
}

/** X-App-Usage: {"call_count": 12, "total_time": 3, "total_cputime": 2} (percent of the hourly limit). */
export function appUsagePercent(header: string | null): number {
  if (!header) return 0;
  try {
    const u = JSON.parse(header) as Record<string, number>;
    return Math.max(u.call_count ?? 0, u.total_time ?? 0, u.total_cputime ?? 0);
  } catch {
    return 0;
  }
}

export interface PollTarget {
  handle: string;
  kind: "artist" | "promoter" | "venue";
  artist?: WatchArtist;
  account?: WatchedAccountRef;
  intervalMin: number;
}

/** Which handles to poll this run: most overdue first, within the hourly call budget. */
export function planTargets(cfg: InstagramConfig, ctx: Pick<SourceContext, "watchlist" | "accounts" | "cursors" | "now">): PollTarget[] {
  const targets: PollTarget[] = [];
  const seen = new Set<string>();
  for (const a of ctx.watchlist) {
    if (a.muted || !a.instagramHandle) continue;
    const h = a.instagramHandle.toLowerCase();
    if (seen.has(h)) continue;
    seen.add(h);
    targets.push({ handle: h, kind: "artist", artist: a, intervalMin: cfg.intervals[a.priorityTier] });
  }
  for (const acc of ctx.accounts) {
    const h = acc.handle.toLowerCase();
    if (seen.has(h)) continue;
    seen.add(h);
    targets.push({ handle: h, kind: acc.kind, account: acc, intervalMin: cfg.intervals.account });
  }
  const budget = Math.max(1, Math.floor((cfg.callsPerHour * cfg.pollMinutes) / 60));
  const slack = cfg.pollMinutes / 2; // cron runs late; poll a little early rather than skip a cycle
  return targets
    .map((t) => {
      const last = ctx.cursors[`ig:${t.handle}`];
      const overdue = last ? (ctx.now.getTime() - Date.parse(last)) / 60_000 - t.intervalMin : Infinity;
      return { t, overdue };
    })
    .filter((x) => x.overdue >= -slack)
    .sort((x, y) => y.overdue - x.overdue)
    .slice(0, budget)
    .map((x) => x.t);
}

export async function downloadImage(url: string, maxBytes = 6_000_000): Promise<LlmImage | null> {
  try {
    const res = await fetchWithRetry(url, { attempts: 2, timeoutMs: 20_000 });
    const mime = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0]!;
    if (!mime.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.byteLength <= maxBytes ? { mime, data: buf } : null;
  } catch {
    return null;
  }
}

export function posterUrl(m: IgMedia): string | null {
  if (m.media_type === "CAROUSEL_ALBUM") return m.children?.data.find((c) => c.media_type !== "VIDEO")?.media_url ?? m.media_url ?? null;
  if (m.media_type === "VIDEO") return m.thumbnail_url ?? null;
  return m.media_url ?? null;
}

/**
 * Instagram Graph API Business Discovery: reads public posts of business/creator accounts via
 * Karan's own linked creator account. Calls count against the platform rate limit
 * (~200/user/hour), so polling is budgeted per run and stops early when X-App-Usage runs high.
 */
export class InstagramSource implements Source {
  readonly name = "instagram" as const;
  private last: SourceHealth = { ok: true, itemCount: 0, error: null };

  constructor(
    private readonly cfg: InstagramConfig,
    private readonly fetchImage: (url: string) => Promise<LlmImage | null> = downloadImage,
    private readonly http: typeof fetchWithRetry = fetchWithRetry,
  ) {}

  health(): SourceHealth {
    return this.last;
  }

  /** One Business Discovery call. Exposed for the weekly self-check. */
  async fetchPosts(handle: string): Promise<{ media: IgMedia[]; usage: number }> {
    const url = businessDiscoveryUrl(this.cfg, handle);
    let res: Response;
    try {
      res = await this.http(withToken(url, this.cfg.accessToken), { attempts: 2, timeoutMs: 20_000 });
    } catch (err) {
      if (err instanceof HttpError) {
        const parsed = GraphError.safeParse(safeJson(err.body));
        const e = parsed.success ? parsed.data.error : null;
        if (e?.code === 190) throw new InstagramTokenError(`Instagram token rejected: ${e.message}`);
        if (e?.code === 110 || e?.error_subcode === 2207013 || /cannot find user|invalid user/i.test(e?.message ?? "")) throw new HandleNotFoundError(handle);
        if (e?.code === 4 || e?.code === 32 || err.status === 429) throw new Error(`Instagram rate limit reached (${redactUrl(url)})`);
        throw new Error(`Instagram ${handle}: ${e?.message ?? `HTTP ${err.status}`}`);
      }
      throw err;
    }
    const usage = appUsagePercent(res.headers.get("x-app-usage"));
    const body = BusinessDiscovery.parse(await res.json());
    return { media: body.business_discovery.media?.data ?? [], usage };
  }

  async fetchNewItems(ctx: SourceContext): Promise<RawItem[]> {
    const targets = planTargets(this.cfg, ctx);
    const items: RawItem[] = [];
    const notFound: string[] = [];
    let errors = 0;
    let lastError: string | null = null;
    const maxAge = (this.cfg.maxPostAgeDays ?? 14) * 86_400_000;

    for (const t of targets) {
      try {
        const { media, usage } = await this.fetchPosts(t.handle);
        ctx.cursors[`ig:${t.handle}`] = ctx.now.toISOString();
        const newestSeen = ctx.cursors[`igpost:${t.handle}`];
        for (const m of media) {
          const ts = m.timestamp ? new Date(m.timestamp) : null;
          if (ts && ctx.now.getTime() - ts.getTime() > maxAge) continue;
          // Skip posts at or before the newest one already handled, unless the caption changed
          // (the dedup key includes the caption hash, so edits still get re-read).
          if (newestSeen && ts && ts.toISOString() < newestSeen && ctx.seen.has(`igmedia:${m.id}`)) continue;
          const imgUrl = posterUrl(m);
          items.push({
            source: "instagram",
            externalId: m.id,
            url: m.permalink ?? null,
            text: `Instagram post by @${t.handle}${t.kind !== "artist" ? ` (${t.kind}${t.account?.city ? `, ${t.account.city}` : ""})` : ""}:\n${m.caption ?? "(no caption)"}`,
            imageUrl: imgUrl,
            image: null, // downloaded below, only for items that survive dedup
            publishedAt: ts,
            meta: { handle: t.handle, kind: t.kind, artistId: t.artist?.id ?? null, mediaId: m.id, mediaType: m.media_type ?? null },
          });
          if (ts && (!ctx.cursors[`igpost:${t.handle}`] || ts.toISOString() > ctx.cursors[`igpost:${t.handle}`]!)) ctx.cursors[`igpost:${t.handle}`] = ts.toISOString();
        }
        if (usage >= 85) {
          ctx.log(`instagram: app usage at ${usage}%, stopping early this run`);
          break;
        }
      } catch (err) {
        if (err instanceof InstagramTokenError) {
          this.last = { ok: false, itemCount: items.length, error: err.message };
          throw err;
        }
        if (err instanceof HandleNotFoundError) {
          notFound.push(t.handle);
          ctx.cursors[`ig:${t.handle}`] = ctx.now.toISOString();
          continue;
        }
        errors++;
        lastError = (err as Error).message;
        if (/rate limit/i.test(lastError)) break;
      }
    }
    this.last = {
      ok: targets.length === 0 || errors < targets.length,
      itemCount: items.length,
      error: lastError,
      notes: notFound.length ? [`Business Discovery can't find: ${notFound.map((h) => `@${h}`).join(", ")} (not a business/creator account, renamed, or age-gated)`] : [],
    };
    return items;
  }

  /** Downloads poster bytes for the items that will actually be extracted (same run: CDN URLs expire). */
  async attachImages(items: RawItem[]): Promise<void> {
    for (const it of items) {
      if (it.source === "instagram" && it.imageUrl && !it.image) it.image = await this.fetchImage(it.imageUrl);
    }
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
