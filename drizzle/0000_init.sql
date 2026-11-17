CREATE TYPE "public"."pack_kind" AS ENUM('practice', 'daily', 'stanford', 'lobby');--> statement-breakpoint
CREATE TYPE "public"."round_outcome" AS ENUM('correct', 'skipped');--> statement-breakpoint
CREATE TABLE "daily_schedule" (
	"date" date PRIMARY KEY NOT NULL,
	"pack_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_rounds" (
	"game_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"puzzle_id" text NOT NULL,
	"outcome" "round_outcome" NOT NULL,
	"reveal_level_reached" integer NOT NULL,
	"wrong_guesses" integer NOT NULL,
	"points" integer NOT NULL,
	"base_points" integer NOT NULL,
	"reveal_penalty" integer NOT NULL,
	"wrong_guess_penalty" integer NOT NULL,
	"finished_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_rounds_game_id_position_pk" PRIMARY KEY("game_id","position"),
	CONSTRAINT "game_rounds_position_min" CHECK ("game_rounds"."position" >= 1),
	CONSTRAINT "game_rounds_reveal_level_min" CHECK ("game_rounds"."reveal_level_reached" >= 0),
	CONSTRAINT "game_rounds_wrong_guesses_min" CHECK ("game_rounds"."wrong_guesses" >= 0)
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pack_id" text NOT NULL,
	"user_id" uuid,
	"anon_owner_hash" text,
	"state" jsonb NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "games_single_owner" CHECK ("games"."user_id" IS NULL OR "games"."anon_owner_hash" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "pack_puzzles" (
	"pack_id" text NOT NULL,
	"puzzle_id" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "pack_puzzles_pack_id_position_pk" PRIMARY KEY("pack_id","position"),
	CONSTRAINT "pack_puzzles_pack_puzzle_key" UNIQUE("pack_id","puzzle_id"),
	CONSTRAINT "pack_puzzles_position_min" CHECK ("pack_puzzles"."position" >= 1)
);
--> statement-breakpoint
CREATE TABLE "packs" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"kind" "pack_kind" NOT NULL,
	"title" text NOT NULL,
	"theme" text NOT NULL,
	"scoring" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "puzzle_images" (
	"puzzle_id" text NOT NULL,
	"level" integer NOT NULL,
	"src" text NOT NULL,
	"width" integer,
	"height" integer,
	CONSTRAINT "puzzle_images_puzzle_id_level_pk" PRIMARY KEY("puzzle_id","level"),
	CONSTRAINT "puzzle_images_level_min" CHECK ("puzzle_images"."level" >= 0)
);
--> statement-breakpoint
CREATE TABLE "puzzles" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"answer" text NOT NULL,
	"accepted_answers" text[] DEFAULT '{}'::text[] NOT NULL,
	"image_url" text NOT NULL,
	"focus_x" double precision NOT NULL,
	"focus_y" double precision NOT NULL,
	"zoom_levels" double precision[] NOT NULL,
	"credit_source" text NOT NULL,
	"credit_license" text NOT NULL,
	"credit_url" text,
	"ai_solved_level" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "puzzles_focus_x_range" CHECK ("puzzles"."focus_x" BETWEEN 0 AND 1),
	CONSTRAINT "puzzles_focus_y_range" CHECK ("puzzles"."focus_y" BETWEEN 0 AND 1),
	CONSTRAINT "puzzles_zoom_levels_not_empty" CHECK (cardinality("puzzles"."zoom_levels") > 0),
	CONSTRAINT "puzzles_ai_solved_level_range" CHECK ("puzzles"."ai_solved_level" IS NULL OR ("puzzles"."ai_solved_level" >= 0 AND "puzzles"."ai_solved_level" < cardinality("puzzles"."zoom_levels")))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_schedule" ADD CONSTRAINT "daily_schedule_pack_id_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."packs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_rounds" ADD CONSTRAINT "game_rounds_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_rounds" ADD CONSTRAINT "game_rounds_puzzle_id_puzzles_id_fk" FOREIGN KEY ("puzzle_id") REFERENCES "public"."puzzles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_pack_id_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."packs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_puzzles" ADD CONSTRAINT "pack_puzzles_pack_id_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_puzzles" ADD CONSTRAINT "pack_puzzles_puzzle_id_puzzles_id_fk" FOREIGN KEY ("puzzle_id") REFERENCES "public"."puzzles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "puzzle_images" ADD CONSTRAINT "puzzle_images_puzzle_id_puzzles_id_fk" FOREIGN KEY ("puzzle_id") REFERENCES "public"."puzzles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "daily_schedule_pack_id_idx" ON "daily_schedule" USING btree ("pack_id");--> statement-breakpoint
CREATE INDEX "game_rounds_puzzle_id_idx" ON "game_rounds" USING btree ("puzzle_id");--> statement-breakpoint
CREATE INDEX "games_user_id_created_at_idx" ON "games" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "games_anon_owner_hash_idx" ON "games" USING btree ("anon_owner_hash");--> statement-breakpoint
CREATE INDEX "games_finished_pack_id_total_idx" ON "games" USING btree ("pack_id","total") WHERE "games"."finished_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "pack_puzzles_puzzle_id_idx" ON "pack_puzzles" USING btree ("puzzle_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_lower_key" ON "users" USING btree (lower("username"));