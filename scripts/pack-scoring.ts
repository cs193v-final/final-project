// Show, set or clear a pack's scoring override (#64) without a redeploy.
// See TECHNICAL.md → Database → "Changing a pack's scoring".
//
//   npm run db:scoring -- show  <pack-id>
//   npm run db:scoring -- set   <pack-id> '{"basePoints": 150}'
//   npm run db:scoring -- set   <pack-id> path/to/scoring.json
//   npm run db:scoring -- clear <pack-id>
//
// Connects with DATABASE_URL_UNPOOLED, exactly like drizzle.config.ts: a value
// already in the environment wins (even an empty one, which fails); only when
// it's unset does it fall back to the dev database in .env.local. Preview and
// production URLs are typed at a hidden prompt, never stored in a file. Like
// the app and drizzle.config.ts, it refuses a URL that doesn't require TLS
// (only localhost is exempt; see src/db/tls.ts). The connection is the seed
// script's (`connect` in ./seed-db.ts, #174): Neon's HTTP driver for Neon,
// node-postgres for a Postgres on this machine.
//
// Runs with plain Node (type stripping), so everything it imports uses
// relative paths with `.ts`, not the "@/" alias.
import { existsSync, readFileSync } from "node:fs";

import { PackNotFoundError, readStoredScoring, setPackScoring, type PgDb } from "../src/db/pack-scoring.ts";
import { InsecureDatabaseUrlError } from "../src/db/tls.ts";
import { parseScoringOverride, resolveScoringConfig, ScoringConfigError } from "../src/game/scoring-override.ts";
import { connect } from "./seed-db.ts";

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
 * with `{`, otherwise a path to a JSON file. A file that doesn't exist is a
 * `UsageError` pointing to `clear` (#174), since `set <pack> null` ends up
 * there too. Doesn't validate the scoring values; `setPackScoring` does that
 * before writing.
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
  const json = value.trimStart().startsWith("{") ? value : readJsonFile(value, packId, readFile);
  try {
    return { kind, packId, override: JSON.parse(json) as unknown };
  } catch (error) {
    throw new UsageError(`Not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readJsonFile(path: string, packId: string, readFile: (path: string) => string): string {
  try {
    return readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code !== "ENOENT") throw error;
    throw new UsageError(
      `No file "${path}". "set" takes inline JSON starting with "{", or a path to a JSON file.\n` +
        `To remove the pack's override, use: npm run db:scoring -- clear ${packId}`,
    );
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

function databaseUrl(): string {
  if (process.env.DATABASE_URL_UNPOOLED === undefined && existsSync(".env.local")) {
    process.loadEnvFile(".env.local");
  }
  const url = process.env.DATABASE_URL_UNPOOLED;
  if (!url) {
    throw new UsageError(
      "DATABASE_URL_UNPOOLED is not set. For dev it comes from .env.local; for preview or production, see TECHNICAL.md → Database.",
    );
  }
  return url;
}

async function main(): Promise<void> {
  try {
    const command = parseCommand(process.argv.slice(2));
    // Fail on a bad value before connecting; setPackScoring checks again before writing.
    if (command.kind === "set") parseScoringOverride(command.override);
    const url = databaseUrl();
    // Checks TLS (#60) before loading a driver, then picks the driver by host.
    const { db, close } = await connect(url, "DATABASE_URL_UNPOOLED");
    try {
      // Only the host is printed, never the credentials.
      console.log(`Database host: ${new URL(url).host}`);
      console.log(await runCommand(db, command));
    } finally {
      await close();
    }
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
    // Anything else (network, database): the message instead of a stack trace.
    // Driver errors don't include the connection string. For a failed query,
    // drizzle's message is only the SQL; the driver's own error (connection
    // refused, wrong password) is in `cause`, as in scripts/seed.ts.
    let current: unknown = error;
    for (let depth = 0; current !== undefined && depth < 5; depth++) {
      const message = current instanceof Error ? current.message : String(current);
      console.error(depth === 0 ? `db:scoring failed: ${message}` : `Caused by: ${message}`);
      current = current instanceof Error ? current.cause : undefined;
    }
    process.exitCode = 1;
  }
}

if (import.meta.main) await main();
