ALTER TYPE "public"."round_outcome" ADD VALUE 'timedOut';--> statement-breakpoint
ALTER TABLE "game_rounds" ALTER COLUMN "reveal_level_reached" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "game_rounds" ALTER COLUMN "base_points" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "game_rounds" ALTER COLUMN "reveal_penalty" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "game_rounds" ALTER COLUMN "wrong_guess_penalty" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "game_rounds" ADD COLUMN "seconds" double precision;--> statement-breakpoint
ALTER TABLE "game_rounds" ADD CONSTRAINT "game_rounds_seconds_min" CHECK ("game_rounds"."seconds" >= 0);--> statement-breakpoint
ALTER TABLE "game_rounds" ADD CONSTRAINT "game_rounds_timed_or_old" CHECK (("game_rounds"."seconds" IS NOT NULL AND "game_rounds"."reveal_level_reached" IS NULL AND "game_rounds"."base_points" IS NULL AND "game_rounds"."reveal_penalty" IS NULL AND "game_rounds"."wrong_guess_penalty" IS NULL) OR ("game_rounds"."seconds" IS NULL AND "game_rounds"."reveal_level_reached" IS NOT NULL AND "game_rounds"."base_points" IS NOT NULL AND "game_rounds"."reveal_penalty" IS NOT NULL AND "game_rounds"."wrong_guess_penalty" IS NOT NULL));--> statement-breakpoint
-- Timed rounds (#255): a game stored under the old rules (zoom out and skip)
-- can't be played on. End the unfinished non-daily ones (practice, Stanford),
-- so they don't count toward the unfinished-games cap (#85) or get resumed.
-- Their state stays as it is. Unfinished daily games are left alone: setting
-- finished_at would put a part-played game on that day's leaderboard.
UPDATE "games" SET "finished_at" = now(), "updated_at" = now() WHERE "finished_at" IS NULL AND "daily_date" IS NULL;--> statement-breakpoint
-- A pack scoring override written for the old rules (it has `basePoints`)
-- doesn't fit timed scoring and would be logged as invalid on every start.
-- Drop it, so the pack uses the default timed scoring.
UPDATE "packs" SET "scoring" = NULL WHERE "scoring" ? 'basePoints';
