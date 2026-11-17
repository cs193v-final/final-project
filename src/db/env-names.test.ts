// No database variable may have a `NEXT_PUBLIC_` prefix (#60, AGENTS.md →
// Secrets): Next.js copies every NEXT_PUBLIC_ variable into the JavaScript it
// sends to browsers. This scans the source, config and env example files for
// such names. It never reads .env.local (real values) or node_modules.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const thisFile = fileURLToPath(import.meta.url);

/** Every file under `dir`, skipping node_modules and build output. */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return ["node_modules", ".next"].includes(entry.name) ? [] : filesUnder(path);
    }
    return [path];
  });
}

/** The files to scan: src/, .github/, root *.config.* files and .env.example. Nothing else at the root. */
function scannedFiles(): string[] {
  const rootFiles = readdirSync(repoRoot, { withFileTypes: true })
    .filter((e) => e.isFile() && (/\.config\.[cm]?[jt]s$/.test(e.name) || e.name === ".env.example"))
    .map((e) => join(repoRoot, e.name));
  return [...filesUnder(join(repoRoot, "src")), ...filesUnder(join(repoRoot, ".github")), ...rootFiles].filter(
    (f) => f !== thisFile && !/\.(png|jpe?g|webp|gif|ico|avif)$/i.test(f),
  );
}

/**
 * `NEXT_PUBLIC_` names that look like database settings: any part containing
 * DATABASE, POSTGRES or NEON, or a part starting with PG (PGHOST, PG_URL...).
 * "PG" only at the start of a part, so names like ..._UPGRADE don't match.
 */
function publicDatabaseNames(text: string): string[] {
  const names = text.match(/NEXT_PUBLIC_[A-Za-z0-9_]+/g) ?? [];
  return names.filter((name) =>
    name
      .slice("NEXT_PUBLIC_".length)
      .toUpperCase()
      .split("_")
      .some((part) => /DATABASE|POSTGRES|NEON/.test(part) || part.startsWith("PG")),
  );
}

describe("public environment variables", () => {
  it("recognizes database-like NEXT_PUBLIC_ names", () => {
    const prefix = "NEXT_" + "PUBLIC_"; // split so this file never contains one
    expect(publicDatabaseNames(`${prefix}DATABASE_URL=x`)).toEqual([`${prefix}DATABASE_URL`]);
    expect(publicDatabaseNames(`process.env.${prefix}DATABASE_URL_UNPOOLED`)).toEqual([
      `${prefix}DATABASE_URL_UNPOOLED`,
    ]);
    expect(publicDatabaseNames(`${prefix}PGPASSWORD ${prefix}PG_HOST ${prefix}POSTGRES_URL`)).toHaveLength(3);
    expect(publicDatabaseNames(`${prefix}NEON_PROJECT_ID ${prefix}MY_NEONDB`)).toHaveLength(2);
    expect(publicDatabaseNames(`${prefix}SITE_URL ${prefix}IMG_UPGRADE DATABASE_URL`)).toEqual([]);
  });

  it("scans the source, CI config, root config files and .env.example, never .env.local", () => {
    const files = scannedFiles().map((f) => relative(repoRoot, f));
    expect(files).toEqual(
      expect.arrayContaining([".env.example", "drizzle.config.ts", "next.config.ts", "src/db/index.ts"]),
    );
    expect(files.some((f) => f.startsWith(".github/"))).toBe(true);
    expect(files.filter((f) => /(^|\/)\.env\.local$|node_modules/.test(f))).toEqual([]);
  });

  it("no database variable has a NEXT_PUBLIC_ prefix", () => {
    const offenders = scannedFiles().flatMap((file) =>
      publicDatabaseNames(readFileSync(file, "utf8")).map((name) => `${relative(repoRoot, file)}: ${name}`),
    );
    expect(offenders).toEqual([]);
  });
});
