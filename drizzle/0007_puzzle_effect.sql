CREATE TYPE "public"."puzzle_effect" AS ENUM('pixelate', 'spotlight', 'thermal', 'swirl', 'zoom', 'tiles');--> statement-breakpoint
ALTER TABLE "puzzles" ADD COLUMN "effect" "puzzle_effect";