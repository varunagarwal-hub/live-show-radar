/** Applies Drizzle migrations to Neon: `pnpm db:migrate` (reads DATABASE_URL from env or .env). */
import { join } from "node:path";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { requireEnv } from "@radar/config";
import { withRetry } from "@radar/core";
import "./load-env";

const { DATABASE_URL } = requireEnv(["DATABASE_URL"]);
const sql = neon(DATABASE_URL);
await withRetry(() => sql`select 1`, { attempts: 4, baseMs: 750 });
await migrate(drizzle({ client: sql }), { migrationsFolder: join(import.meta.dirname, "../packages/core/drizzle") });
const tables = await sql`select count(*)::int as n from information_schema.tables where table_schema = 'public'`;
console.log(`Migrations applied. ${tables[0]?.n} tables in public schema.`);
