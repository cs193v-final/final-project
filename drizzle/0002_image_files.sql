CREATE TABLE "image_files" (
	"id" text PRIMARY KEY NOT NULL,
	"puzzle_id" text NOT NULL,
	"content_type" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "image_files_id_format" CHECK ("image_files"."id" ~ '^[0-9a-f]{32}$'),
	CONSTRAINT "image_files_content_type" CHECK ("image_files"."content_type" IN ('image/webp'))
);
--> statement-breakpoint
ALTER TABLE "image_files" ADD CONSTRAINT "image_files_puzzle_id_puzzles_id_fk" FOREIGN KEY ("puzzle_id") REFERENCES "public"."puzzles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "image_files_puzzle_id_idx" ON "image_files" USING btree ("puzzle_id");