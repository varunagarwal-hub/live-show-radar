import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import * as schema from "./schema";
import { withRetry } from "../retry";

export { schema };
export type Schema = typeof schema;
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

/**
 * One database handle per run. `readOnly` runs a pre-built parameterized statement inside a
 * READ ONLY transaction; it is the only path the ask-it-anything feature may use.
 */
export interface DbHandle {
  db: Db;
  kind: "neon" | "pglite";
  readOnly<T = Record<string, unknown>>(text: string, params: unknown[]): Promise<T[]>;
  /** Run several write statements in one round trip (Neon HTTP batch) or sequentially (PGlite). */
  batch(queries: readonly PromiseLike<unknown>[]): Promise<void>;
}

/**
 * Neon's free tier suspends compute when idle, so the first query can take ~1s or fail
 * transiently while the endpoint wakes. Warm it with retries before handing out the handle.
 */
export async function connectNeon(databaseUrl: string): Promise<DbHandle> {
  const sql: NeonQueryFunction<false, false> = neon(databaseUrl);
  const db = drizzleNeon({ client: sql, schema, casing: "snake_case" }) as unknown as Db;
  await withRetry(() => sql`select 1`, { attempts: 4, baseMs: 750, label: "neon-wake" });
  return {
    db,
    kind: "neon",
    async readOnly<T>(text: string, params: unknown[]) {
      const [rows] = await sql.transaction([sql.query(text, params)], { readOnly: true });
      return rows as T[];
    },
    async batch(queries) {
      if (queries.length === 0) return;
      const nb = db as unknown as { batch(q: readonly unknown[]): Promise<unknown> };
      await nb.batch(queries);
    },
  };
}

let cached: Promise<DbHandle> | null = null;

/** Lazily connects on first use, so a run with nothing new never wakes the database. */
export function lazyDb(databaseUrl: string): () => Promise<DbHandle> {
  return () => (cached ??= connectNeon(databaseUrl));
}

export function wasDbOpened(): boolean {
  return cached !== null;
}
