CREATE TABLE "lobbies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid,
	"pack_id" text NOT NULL,
	"code_index" text NOT NULL,
	"code_encrypted" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"report_count" integer DEFAULT 0 NOT NULL,
	"hidden_at" timestamp with time zone,
	CONSTRAINT "lobbies_expires_after_created" CHECK ("lobbies"."expires_at" > "lobbies"."created_at"),
	CONSTRAINT "lobbies_report_count_min" CHECK ("lobbies"."report_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "lobby_puzzles" (
	"puzzle_id" text PRIMARY KEY NOT NULL,
	"lobby_id" uuid NOT NULL,
	"answers_encrypted" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lobby_reports" (
	"lobby_id" uuid NOT NULL,
	"reporter_index" text NOT NULL,
	"ip_index" text NOT NULL,
	"signed_in" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lobby_reports_lobby_id_reporter_index_pk" PRIMARY KEY("lobby_id","reporter_index")
);
--> statement-breakpoint
CREATE TABLE "lobby_uploads" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"bytes" "bytea" NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lobby_uploads_id_format" CHECK ("lobby_uploads"."id" ~ '^[0-9a-f]{32}$'),
	CONSTRAINT "lobby_uploads_bytes_max" CHECK (octet_length("lobby_uploads"."bytes") <= 3145757)
);
--> statement-breakpoint
ALTER TABLE "lobbies" ADD CONSTRAINT "lobbies_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lobbies" ADD CONSTRAINT "lobbies_pack_id_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lobby_puzzles" ADD CONSTRAINT "lobby_puzzles_puzzle_id_puzzles_id_fk" FOREIGN KEY ("puzzle_id") REFERENCES "public"."puzzles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lobby_puzzles" ADD CONSTRAINT "lobby_puzzles_lobby_id_lobbies_id_fk" FOREIGN KEY ("lobby_id") REFERENCES "public"."lobbies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lobby_reports" ADD CONSTRAINT "lobby_reports_lobby_id_lobbies_id_fk" FOREIGN KEY ("lobby_id") REFERENCES "public"."lobbies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lobby_uploads" ADD CONSTRAINT "lobby_uploads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lobbies_code_index_key" ON "lobbies" USING btree ("code_index");--> statement-breakpoint
CREATE UNIQUE INDEX "lobbies_pack_id_key" ON "lobbies" USING btree ("pack_id");--> statement-breakpoint
CREATE INDEX "lobbies_owner_user_id_idx" ON "lobbies" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "lobbies_expires_at_idx" ON "lobbies" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "lobby_puzzles_lobby_id_idx" ON "lobby_puzzles" USING btree ("lobby_id");--> statement-breakpoint
CREATE INDEX "lobby_uploads_user_id_idx" ON "lobby_uploads" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "lobby_uploads_created_at_idx" ON "lobby_uploads" USING btree ("created_at");