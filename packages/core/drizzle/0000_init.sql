CREATE TYPE "public"."account_kind" AS ENUM('promoter', 'venue');--> statement-breakpoint
CREATE TYPE "public"."decision_status" AS ENUM('going', 'maybe', 'pass', 'not_interested');--> statement-breakpoint
CREATE TYPE "public"."early_bird_status" AS ENUM('open', 'opening', 'sold_out', 'none', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('announced', 'possible', 'cancelled', 'past');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('concert', 'festival', 'club', 'other');--> statement-breakpoint
CREATE TYPE "public"."handle_status" AS ENUM('none', 'unconfirmed', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."priority_tier" AS ENUM('A', 'B', 'C');--> statement-breakpoint
CREATE TYPE "public"."urgency" AS ENUM('urgent', 'normal', 'possible');--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer,
	"kind" text NOT NULL,
	"dedup_key" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"telegram_message_id" integer,
	"dry_run" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artists" (
	"id" serial PRIMARY KEY NOT NULL,
	"spotify_id" text,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"instagram_handle" text,
	"handle_status" "handle_status" DEFAULT 'none' NOT NULL,
	"musicbrainz_id" text,
	"priority_tier" "priority_tier" DEFAULT 'C' NOT NULL,
	"listened_not_followed" boolean DEFAULT false NOT NULL,
	"followed" boolean DEFAULT false NOT NULL,
	"muted" boolean DEFAULT false NOT NULL,
	"image_url" text,
	"match_weight" real DEFAULT 1 NOT NULL,
	"handle_proposed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artists_spotifyId_unique" UNIQUE("spotify_id")
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"event_id" integer PRIMARY KEY NOT NULL,
	"status" "decision_status" NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"via" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"raw_item_id" bigint,
	"source" text NOT NULL,
	"url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"artist_id" integer NOT NULL,
	"title" text,
	"city" text NOT NULL,
	"venue" text,
	"date" date,
	"end_date" date,
	"event_type" "event_type" DEFAULT 'concert' NOT NULL,
	"ticket_url" text,
	"sale_starts_at" timestamp with time zone,
	"early_bird_status" "early_bird_status" DEFAULT 'unknown' NOT NULL,
	"early_bird_opens_at" timestamp with time zone,
	"early_bird_closes_at" timestamp with time zone,
	"tiers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"urgency" "urgency" DEFAULT 'normal' NOT NULL,
	"confidence" real NOT NULL,
	"status" "event_status" DEFAULT 'announced' NOT NULL,
	"evidence" text,
	"handle_unconfirmed" boolean DEFAULT false NOT NULL,
	"field_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_fingerprint_unique" UNIQUE("fingerprint")
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer,
	"artist_id" integer,
	"kind" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"stats_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "kv" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "misses" (
	"id" serial PRIMARY KEY NOT NULL,
	"artist_id" integer NOT NULL,
	"city" text NOT NULL,
	"date" date NOT NULL,
	"evidence_url" text,
	"likely_cause" text NOT NULL,
	"suggested_handle" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playlists" (
	"event_id" integer PRIMARY KEY NOT NULL,
	"spotify_playlist_id" text NOT NULL,
	"url" text NOT NULL,
	"basis" text NOT NULL,
	"track_count" integer DEFAULT 0 NOT NULL,
	"refreshed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"content_hash" text NOT NULL,
	"dedup_key" text NOT NULL,
	"url" text,
	"text" text NOT NULL,
	"image_url" text,
	"image_data" "bytea",
	"image_mime" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed" boolean DEFAULT false NOT NULL,
	"processed_at" timestamp with time zone,
	"process_attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	CONSTRAINT "raw_items_dedupKey_unique" UNIQUE("dedup_key")
);
--> statement-breakpoint
CREATE TABLE "source_health" (
	"source" text PRIMARY KEY NOT NULL,
	"last_ok_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_item_count" integer DEFAULT 0 NOT NULL,
	"last_nonzero_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"healthy" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tier_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tiers_json" jsonb NOT NULL,
	"early_bird_status" "early_bird_status" NOT NULL,
	"availability" text,
	"state_hash" text NOT NULL,
	"method" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watched_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"kind" "account_kind" NOT NULL,
	"city" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watched_accounts_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_sources" ADD CONSTRAINT "event_sources_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_sources" ADD CONSTRAINT "event_sources_raw_item_id_raw_items_id_fk" FOREIGN KEY ("raw_item_id") REFERENCES "public"."raw_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "misses" ADD CONSTRAINT "misses_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlists" ADD CONSTRAINT "playlists_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tier_snapshots" ADD CONSTRAINT "tier_snapshots_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_dedup_idx" ON "alerts" USING btree ("dedup_key","dry_run");--> statement-breakpoint
CREATE INDEX "artists_name_idx" ON "artists" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "artists_handle_idx" ON "artists" USING btree ("instagram_handle");--> statement-breakpoint
CREATE UNIQUE INDEX "event_sources_event_url_idx" ON "event_sources" USING btree ("event_id","source","url");--> statement-breakpoint
CREATE INDEX "events_date_idx" ON "events" USING btree ("date");--> statement-breakpoint
CREATE INDEX "events_artist_idx" ON "events" USING btree ("artist_id");--> statement-breakpoint
CREATE INDEX "job_runs_job_idx" ON "job_runs" USING btree ("job","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "misses_unique_idx" ON "misses" USING btree ("artist_id","city","date");--> statement-breakpoint
CREATE INDEX "raw_items_unprocessed_idx" ON "raw_items" USING btree ("processed","fetched_at");--> statement-breakpoint
CREATE INDEX "tier_snapshots_event_idx" ON "tier_snapshots" USING btree ("event_id","captured_at");