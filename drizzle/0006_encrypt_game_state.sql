ALTER TABLE "games" ALTER COLUMN "state" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "state_encrypted" text;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_one_state" CHECK (("games"."state" IS NULL) <> ("games"."state_encrypted" IS NULL));