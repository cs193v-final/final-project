-- #84: usernames are stored encrypted, with a keyed hash (HMAC) for lookups.
-- Existing usernames can't be encrypted in SQL (the key is only in the app),
-- and no tier has real accounts yet (#53 isn't deployed). So refuse to run on
-- a table with users rather than invent values; delete test users first.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "users") THEN
    RAISE EXCEPTION 'users has rows: delete test users (DELETE FROM users;) before this migration, then recreate them with npm run db:test-user (#84)';
  END IF;
END $$;--> statement-breakpoint
-- Rate-limit keys held plain lowercased usernames and unkeyed IP hashes. They're
-- only short-lived counters, so start them over with the new keyed hashes.
DELETE FROM "rate_limits";--> statement-breakpoint
DROP INDEX "users_username_lower_key";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "username_encrypted" text NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "username_index" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_index_key" ON "users" USING btree ("username_index");--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "username";