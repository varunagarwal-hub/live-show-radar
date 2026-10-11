import "server-only";
import { connectNeon, type DbHandle } from "@radar/core/db";

let handle: Promise<DbHandle> | null = null;

/** One Neon HTTP handle per server instance; the first call warms a suspended compute. */
export function getDb(): Promise<DbHandle> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  handle ??= connectNeon(url).catch((err) => {
    handle = null;
    throw err;
  });
  return handle;
}
