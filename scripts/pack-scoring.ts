// Show, set or clear a pack's scoring override (#64) without a redeploy.
// See TECHNICAL.md → Database → "Changing a pack's scoring".
//
//   npm run db:scoring -- show  <pack-id>
//   npm run db:scoring -- set   <pack-id> '{"maxPoints": 12000}'
//   npm run db:scoring -- set   <pack-id> path/to/scoring.json
//   npm run db:scoring -- clear <pack-id>
//
// Connects with DATABASE_URL_UNPOOLED, exactly like drizzle.config.ts: a value
// already in the environment wins (even an empty one, which fails); only when
// it's unset does it fall back to the dev database in .env.local. Preview and
// production URLs are typed at a hidden prompt, never stored in a file. Like
// the app and drizzle.config.ts, it refuses a URL that doesn't require TLS
// (only localhost is exempt; see src/db/tls.ts).
//
// Runs with plain Node (type stripping), so everything it imports uses
// relative paths with `.ts`, not the "@/" alias.
import { existsSync, readFileSync } from "node:fs";

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import { PackNotFoundError, readStoredScoring, setPackScoring, type PgDb } from "../src/db/pack-scoring.ts";
import * as schema from "../src/db/schema.ts";
import { assertDatabaseUrlRequiresTls, InsecureDatabaseUrlError } from "../src/db/tls.ts";
import { parseScoringOverride, resolveScoringConfig, ScoringConfigError } from "../src/game/scoring-override.ts";

export const USAGE = `Usage:
  npm run db:scoring -- show  <pack-id>
  npm run db:scoring -- set   <pack-id> '<json>' | <file.json>
  npm run db:scoring -- clear <pack-id>`;

export type Command =
  | { kind: "show"; packId: string }
  | { kind: "set"; packId: string; override: unknown }
  | { kind: "clear"; packId: string };

export class UsageError extends Error {
  constructor(message: string) {
    super(`${message}\n\n${USAGE}`);
    this.name = "UsageError";
  }
}

/**
 * Parses the command line. For `set`, the value is inline JSON if it starts
 * with `{`, otherwise a path to a JSON file. Doesn't validate the scoring
 * values; `setPackScoring` does that before writing.
 */
export function parseCommand(
  args: readonly string[],
  readFile: (path: string) => string = (path) => readFileSync(path, "utf8"),
): Command {
  const [kind, packId, value, ...extra] = args;
  if (!packId) throw new UsageError("Missing the pack id.");
  if (kind === "show" || kind === "clear") {
    if (value !== undefined) throw new UsageError(`"${kind}" takes only a pack id.`);
    return { kind, packId };
  }
  if (kind !== "set") throw new UsageError(`Unknown command "${kind ?? ""}".`);
  if (value === undefined || extra.length > 0) throw new UsageError('"set" takes a pack id and one JSON value.');
  const json = value.trimStart().startsWith("{") ? value : readFile(value);
  try {
    return { kind, packId, override: JSON.parse(json) as unknown };
  } catch (error) {
    throw new UsageError(`Not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Runs one command against `db` and returns what to print. */
export async function runCommand(db: PgDb, command: Command): Promise<string> {
  switch (command.kind) {
    case "show": {
      const stored = await readStoredScoring(db, command.packId);
      if (stored === null) return `Pack "${command.packId}" has no override; it uses the default:\n${pretty(resolveScoringConfig(null))}`;
      let effective: string;
      try {
        effective = pretty(resolveScoringConfig(stored));
      } catch (error) {
        effective = `INVALID, so games use the default: ${error instanceof Error ? error.message : String(error)}`;
      }
      return `Pack "${command.packId}" stored override:\n${pretty(stored)}\nEffective config:\n${effective}`;
    }
    case "set": {
      const stored = await setPackScoring(db, command.packId, command.override);
      return `Pack "${command.packId}" now uses:\n${pretty(stored)}\nGames already in progress keep the config they started with.`;
    }
    case "clear":
      await setPackScoring(db, command.packId, null);
      return `Pack "${command.packId}" now uses the default scoring.`;
  }
}

const pretty = (value: unknown) => JSON.stringify(value, null, 2);

function connect(): { db: PgDb; host: string } {
  if (process.env.DATABASE_URL_UNPOOLED === undefined && existsSync(".env.local")) {
    process.loadEnvFile(".env.local");
  }
  const url = process.env.DATABASE_URL_UNPOOLED;
  if (!url) {
    throw new UsageError(
      "DATABASE_URL_UNPOOLED is not set. For dev it comes from .env.local; for preview or production, see TECHNICAL.md → Database.",
    );
  }
  assertDatabaseUrlRequiresTls(url, "DATABASE_URL_UNPOOLED");
  // Only the host is printed, never the credentials.
  return { db: drizzle({ client: neon(url), schema }), host: new URL(url).host };
}

async function main(): Promise<void> {
  try {
    const command = parseCommand(process.argv.slice(2));
    // Fail on a bad value before connecting; setPackScoring checks again before writing.
    if (command.kind === "set") parseScoringOverride(command.override);
    const { db, host } = connect();
    console.log(`Database host: ${host}`);
    console.log(await runCommand(db, command));
  } catch (error) {
    if (
      error instanceof UsageError ||
      error instanceof ScoringConfigError || error instanceof PackNotFoundError ||
      error instanceof InsecureDatabaseUrlError
    ) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    // Anything else (network, database): one line instead of a stack trace.
    // Driver errors don't include the connection string.
    console.error(`db:scoring failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (import.meta.main) await main();
