CREATE TYPE "public"."user_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TABLE "follows" (
	"user_id" integer NOT NULL,
	"artist_id" integer NOT NULL,
	"tier" "priority_tier" DEFAULT 'B' NOT NULL,
	"muted" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'search' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follows_user_id_artist_id_pk" PRIMARY KEY("user_id","artist_id")
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"code" text PRIMARY KEY NOT NULL,
	"note" text,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"role" "user_role" DEFAULT 'member' NOT NULL,
	"home_city" text DEFAULT 'Bengaluru' NOT NULL,
	"telegram_chat_id" text,
	"telegram_link_token" text,
	"calendar_token" text NOT NULL,
	"spotify_refresh_enc" text,
	"spotify_user_id" text,
	"spotify_synced_at" timestamp with time zone,
	"invite_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_telegramChatId_unique" UNIQUE("telegram_chat_id"),
	CONSTRAINT "users_telegramLinkToken_unique" UNIQUE("telegram_link_token"),
	CONSTRAINT "users_calendarToken_unique" UNIQUE("calendar_token")
);
--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "user_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "decisions" DROP CONSTRAINT IF EXISTS "decisions_pkey";--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_user_id_event_id_pk" PRIMARY KEY("user_id","event_id");--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "user_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "follows_artist_idx" ON "follows" USING btree ("artist_id");--> statement-breakpoint
-- The owner (the original single user) is user 1; the app fills in the email from ALLOWED_EMAIL.
INSERT INTO "users" ("id", "email", "role", "calendar_token") VALUES (1, 'owner@pending', 'owner', md5(random()::text) || md5(random()::text)) ON CONFLICT DO NOTHING;--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('users', 'id'), GREATEST((SELECT max("id") FROM "users"), 1));--> statement-breakpoint
-- Every existing artist is the owner's, with their current tier and mute.
INSERT INTO "follows" ("user_id", "artist_id", "tier", "muted", "source") SELECT 1, "id", "priority_tier", "muted", 'owner' FROM "artists" ON CONFLICT DO NOTHING;
