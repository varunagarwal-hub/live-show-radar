import type { WatchArtist, LlmImage } from "@radar/core";

/** One item fetched from a source, before dedup and extraction. */
export interface RawItem {
  source: SourceName;
  /** Stable ID within the source (post ID, event URL, article GUID, email message ID). */
  externalId: string;
  url: string | null;
  /** Everything the extractor should read, already flattened to text. */
  text: string;
  imageUrl?: string | null;
  /** Downloaded during the same run (Instagram CDN URLs expire). */
  image?: LlmImage | null;
  publishedAt?: Date | null;
  meta: Record<string, unknown>;
}

export type SourceName = "instagram" | "district" | "bookmyshow" | "skillbox" | "news" | "email";

export interface WatchedAccountRef {
  handle: string;
  kind: "promoter" | "venue";
  city: string | null;
}

export interface SourceContext {
  now: Date;
  watchlist: WatchArtist[];
  accounts: WatchedAccountRef[];
  /** Per-source polling cursors persisted between runs (e.g. "instagram:prateekkuhad" → ISO time). */
  cursors: Record<string, string>;
  /** Keys already known to the job (dedup keys and "url:" markers), to skip refetching detail pages. */
  seen: Set<string>;
  log: (msg: string) => void;
}

export interface SourceHealth {
  ok: boolean;
  itemCount: number;
  error: string | null;
  /** Bot protection answered instead of the page. We report it and never try to get around it. */
  blocked?: boolean;
  /** Extra detail for the Health page, e.g. handles Business Discovery couldn't resolve. */
  notes?: string[];
}

/** Spec 4.2: every source implements fetchNewItems plus a health status. */
export interface Source {
  name: SourceName;
  fetchNewItems(ctx: SourceContext): Promise<RawItem[]>;
  health(): SourceHealth;
}

export class BlockedError extends Error {
  constructor(readonly url: string) {
    super(`Blocked by bot protection at ${new URL(url).host}`);
  }
}

export class RobotsDisallowedError extends Error {
  constructor(readonly url: string) {
    super(`robots.txt disallows ${new URL(url).pathname}`);
  }
}
