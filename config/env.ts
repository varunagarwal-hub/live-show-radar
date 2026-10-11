import { z } from "zod";

/**
 * Every environment variable the system reads. Each consumer asks only for the keys it needs
 * (`requireEnv(["DATABASE_URL"])`), so a job never fails over a secret it doesn't use.
 */
export const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  GEMINI_API_KEY: z.string().min(10),
  GEMINI_MODEL: z.string().default("gemini-3.8-flash"),
  GROQ_API_KEY: z.string().min(10),
  GROQ_MODEL: z.string().default("llama-3.3-70b-versatile"),
  GROQ_VISION_MODEL: z.string().default("qwen/qwen3.8-27b"),
  TELEGRAM_BOT_TOKEN: z.string().min(20),
  TELEGRAM_ALLOWED_CHAT_IDS: z.string().min(1),
  TELEGRAM_ALERT_CHAT_ID: z.string().min(1),
  TELEGRAM_TEST_CHAT_ID: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().regex(/^[A-Za-z0-9_-]{16,256}$/),
  SPOTIFY_CLIENT_ID: z.string().min(10),
  SPOTIFY_CLIENT_SECRET: z.string().min(10),
  SPOTIFY_REFRESH_TOKEN: z.string().min(10),
  INSTAGRAM_USER_ID: z.string().min(5),
  INSTAGRAM_ACCESS_TOKEN: z.string().min(20),
  FACEBOOK_APP_ID: z.string().min(5),
  FACEBOOK_APP_SECRET: z.string().min(10),
  GRAPH_API_VERSION: z.string().default("v25.0"),
  SETLISTFM_API_KEY: z.string().min(10),
  MUSICBRAINZ_CONTACT: z.string().min(3),
  GOOGLE_CALENDAR_ICS_URL: z.string().url().optional(),
  CALENDAR_FEED_TOKEN: z.string().min(32),
  INGEST_EMAIL_SECRET: z.string().min(24),
  ALLOWED_EMAIL: z.string().email(),
  NEXTAUTH_SECRET: z.string().min(16),
  AUTH_GOOGLE_ID: z.string().min(10),
  AUTH_GOOGLE_SECRET: z.string().min(10),
  PUBLIC_BASE_URL: z.string().url(),
  RADAR_DRY_RUN: z.string().optional(),
  RADAR_STATE_DIR: z.string().default(".radar-state"),
});

export type Env = z.infer<typeof EnvSchema>;
export type EnvKey = keyof Env;

export function requireEnv<K extends EnvKey>(keys: readonly K[], source: NodeJS.ProcessEnv = process.env): Pick<Env, K> {
  const mask = Object.fromEntries(keys.map((k) => [k, true])) as Partial<Record<EnvKey, true>>;
  // Unset GitHub Actions variables arrive as "", which must not defeat the defaults.
  const cleaned = Object.fromEntries(keys.map((k) => [k, source[k] === "" ? undefined : source[k]]));
  const result = (EnvSchema.pick(mask as Record<EnvKey, true>) as z.ZodType).safeParse(cleaned);
  if (!result.success) {
    // Name the missing keys, never their values.
    const names = [...new Set(result.error.issues.map((i) => String(i.path[0])))].join(", ");
    throw new Error(`Missing or invalid environment variables: ${names}`);
  }
  return result.data as unknown as Pick<Env, K>;
}

export function optionalEnv<K extends EnvKey>(key: K, source: NodeJS.ProcessEnv = process.env): Env[K] | undefined {
  const v = source[key];
  if (v === undefined || v === "") return undefined;
  const r = EnvSchema.shape[key].safeParse(v);
  return r.success ? (r.data as Env[K]) : undefined;
}
