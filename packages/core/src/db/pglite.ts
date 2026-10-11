import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { DbHandle, Db } from "./index";
import * as schema from "./schema";

/**
 * In-process Postgres (PGlite) for tests and the dry-run e2e cycle. Applies the same Drizzle
 * migrations that run against Neon, so tests exercise the real schema.
 */
export async function connectPglite(): Promise<DbHandle> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const client = new PGlite();
  const dir = join(dirname(fileURLToPath(import.meta.url)), "../../drizzle");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const text = readFileSync(join(dir, file), "utf8");
    for (const stmt of text.split("--> statement-breakpoint")) {
      if (stmt.trim()) await client.exec(stmt);
    }
  }
  const db = drizzle({ client, schema, casing: "snake_case" }) as unknown as Db;
  return {
    db,
    kind: "pglite",
    async readOnly<T>(text: string, params: unknown[]) {
      return client.transaction(async (tx) => {
        await tx.exec("SET TRANSACTION READ ONLY");
        const r = await tx.query(text, params);
        return r.rows as T[];
      });
    },
    async batch(queries) {
      for (const q of queries) await q;
    },
  };
}
