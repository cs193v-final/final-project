// drizzle-kit config (#47): `npm run db:generate` writes SQL migrations to
// drizzle/ from src/db/schema.ts; `npm run db:migrate` applies them.
// Who runs migrations against which database, and when: TECHNICAL.md → Database.
import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// Migrations use the direct (unpooled) connection. A value already in the
// environment wins, even an empty one (so an empty prompt fails instead of
// quietly migrating dev). Only when it's unset, fall back to the dev database
// in .env.local. Preview and production URLs are never in a file: the deploy
// owner enters them at a prompt for one command (see TECHNICAL.md).
if (process.env.DATABASE_URL_UNPOOLED === undefined && existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  // `generate` doesn't connect, so it works without a URL; `migrate` fails
  // with a connection error if this is empty.
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED ?? "" },
  strict: true,
  verbose: true,
});
