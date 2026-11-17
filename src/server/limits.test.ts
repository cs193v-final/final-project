// Game rate limits (#85) against an in-memory Postgres (PGlite) with the real
// migrations, with an injected clock. One block per limit: the last allowed
// request, the first one over the limit, and the window resetting.
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PgDb } from "@/db/accounts";
import * as schema from "@/db/schema";
import { RateLimitedError } from "@/game/game-result";
import type { GameOwner } from "@/game/server-game";

import { hashIp } from "./ip-key";
import { checkActionLimits, checkStartLimits, GAME_LIMITS, MAX_UNFINISHED_GAMES_PER_PACK, ownerKey, type LimitName } from "./limits";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

let pg: PGlite;
let db: PgDb;

beforeAll(async () => {
  pg = new PGlite();
  const client = drizzle({ client: pg, schema });
  await migrate(client, { migrationsFolder });
  db = client as unknown as PgDb;
}, 60_000);

afterAll(async () => {
  await pg.close();
});

beforeEach(async () => {
  await pg.exec("DELETE FROM rate_limits;");
});

const KEY = Buffer.alloc(32, 7);
const T0 = new Date("2026-11-17T12:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const anon = (token: string): GameOwner => ({ anonId: createHash("sha256").update(token).digest("hex") });
const IP_A = hashIp("203.0.113.7", KEY);
const IP_B = hashIp("198.51.100.20", KEY);

type Check = typeof checkStartLimits;

/** Runs `check` and returns the limit that refused it, or null if it was allowed. */
async function refusedBy(check: Check, owner: GameOwner, ip: string | null, now: Date): Promise<string | null> {
  try {
    await check(db, owner, ip, now);
    return null;
  } catch (error) {
    if (error instanceof RateLimitedError) return error.limit;
    throw error;
  }
}

/**
 * Each case: which check, which limit, and how to make the requests share
 * only that limit's key (same owner from many IPs, or many owners from one IP).
 */
const CASES: { name: LimitName; check: Check; request: (i: number) => [GameOwner, string] }[] = [
  { name: "startsPerOwner", check: checkStartLimits, request: (i) => [anon("one player"), hashIp(`10.0.${i >> 8}.${i & 255}`, KEY)] },
  { name: "startsPerIp", check: checkStartLimits, request: (i) => [anon(`player ${i}`), IP_A] },
  { name: "actionsPerOwner", check: checkActionLimits, request: (i) => [anon("one player"), hashIp(`10.0.${i >> 8}.${i & 255}`, KEY)] },
  { name: "actionsPerIp", check: checkActionLimits, request: (i) => [anon(`player ${i}`), IP_A] },
];

describe.each(CASES)("$name", ({ name, check, request }) => {
  const { max, windowMs } = GAME_LIMITS[name];

  it(`allows ${max} per window and refuses the next one`, async () => {
    for (let i = 0; i < max; i++) {
      const [owner, ip] = request(i);
      expect(await refusedBy(check, owner, ip, at(i))).toBeNull();
    }
    const [owner, ip] = request(max);
    expect(await refusedBy(check, owner, ip, at(max))).toBe(name);
  });

  it("allows requests again once the window has passed", async () => {
    for (let i = 0; i <= max; i++) {
      const [owner, ip] = request(i);
      await refusedBy(check, owner, ip, T0);
    }
    const [owner, ip] = request(max + 1);
    expect(await refusedBy(check, owner, ip, at(windowMs - 1))).toBe(name);
    expect(await refusedBy(check, owner, ip, at(windowMs))).toBeNull();
  });
});

describe("game rate limit keys", () => {
  it("keeps starts and actions, owners and addresses apart", async () => {
    const owner = anon("one player");
    for (let i = 0; i < GAME_LIMITS.startsPerOwner.max; i++) await checkStartLimits(db, owner, IP_A, T0);
    expect(await refusedBy(checkStartLimits, owner, IP_B, T0)).toBe("startsPerOwner");
    // Actions are counted separately, and so is another player.
    expect(await refusedBy(checkActionLimits, owner, IP_A, T0)).toBeNull();
    expect(await refusedBy(checkStartLimits, anon("someone else"), IP_A, T0)).toBeNull();
  });

  it("counts only the owner when the per-IP limit doesn't apply (no address hash)", async () => {
    const owner = anon("local player");
    for (let i = 0; i < GAME_LIMITS.startsPerOwner.max; i++) expect(await refusedBy(checkStartLimits, owner, null, T0)).toBeNull();
    expect(await refusedBy(checkStartLimits, owner, null, T0)).toBe("startsPerOwner");
    const { rows } = await pg.query<{ key: string }>("SELECT key FROM rate_limits");
    expect(rows.map((r) => r.key)).toEqual([`game:start:owner:${ownerKey(owner)}`]);
  });

  it("stores only the keyed hash of an address and the owner id, never the raw address", async () => {
    const user: GameOwner = { userId: "00000000-0000-4000-8000-000000000001" };
    await checkStartLimits(db, user, hashIp("203.0.113.7", KEY), T0);
    await checkActionLimits(db, anon("x"), hashIp("203.0.113.7", KEY), T0);
    const { rows } = await pg.query<{ key: string }>("SELECT key FROM rate_limits ORDER BY key");
    const keys = rows.map((r) => r.key);
    expect(keys).toEqual(
      [
        `game:action:ip:${IP_A}`,
        `game:action:owner:${ownerKey(anon("x"))}`,
        `game:start:ip:${IP_A}`,
        `game:start:owner:user:${user.userId}`,
      ].sort(),
    );
    expect(keys.join(" ")).not.toContain("203.0.113.7");
    expect(keys.join(" ")).not.toContain(createHash("sha256").update("203.0.113.7").digest("hex"));
  });

  it("doesn't count the owner when the address is already over its limit", async () => {
    for (let i = 0; i <= GAME_LIMITS.startsPerIp.max; i++) await refusedBy(checkStartLimits, anon(`p${i}`), IP_A, T0);
    await pg.exec("DELETE FROM rate_limits WHERE key LIKE 'game:start:owner:%'");
    expect(await refusedBy(checkStartLimits, anon("new"), IP_A, T0)).toBe("startsPerIp");
    const { rows } = await pg.query("SELECT key FROM rate_limits WHERE key LIKE 'game:start:owner:%'");
    expect(rows).toEqual([]);
  });

  it("has limits that leave room for normal play", () => {
    // A game is ~20 actions; a player should get through several a minute.
    expect(GAME_LIMITS.actionsPerOwner.max / (GAME_LIMITS.actionsPerOwner.windowMs / 60_000)).toBeGreaterThanOrEqual(60);
    expect(GAME_LIMITS.startsPerOwner.max).toBeGreaterThanOrEqual(10);
    expect(MAX_UNFINISHED_GAMES_PER_PACK).toBeGreaterThanOrEqual(2);
  });
});
