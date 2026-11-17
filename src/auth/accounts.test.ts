// Register, login, sessions and rate limits (#53) against an in-memory Postgres
// (PGlite) with the real migrations.
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  deleteExpiredRateLimits,
  deleteExpiredSessions,
  deleteSession,
  findSessionUser,
  hitRateLimit,
  type PgDb,
} from "@/db/accounts";
import * as schema from "@/db/schema";

import { limitsAddress, login, loginUserKey, RATE_LIMITS, register, SESSION_DAYS, type AuthResult } from "./accounts";
import { sha256Hex } from "./crypto";

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
  await pg.exec("DELETE FROM sessions; DELETE FROM users; DELETE FROM rate_limits;");
});

const T0 = new Date("2026-11-17T12:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const req = (ip: string | null = "203.0.113.7", now = T0) => ({ ip, now });
const PASSWORD = "correct horse battery";

function expectOk(result: AuthResult) {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result)}`);
  return result;
}

async function rows<T>(query: string): Promise<T[]> {
  return (await pg.query<T>(query)).rows;
}

describe("register", () => {
  it("creates the user, stores only a hash, and starts a session", async () => {
    const result = expectOk(await register(db, { username: "Ethan", password: PASSWORD }, req()));
    expect(result.user).toEqual({ id: expect.any(String), username: "Ethan" });

    const [user] = await rows<{ username: string; password_hash: string }>("SELECT * FROM users");
    expect(user!.username).toBe("Ethan");
    expect(user!.password_hash).toMatch(/^\$argon2id\$/);
    expect(user!.password_hash).not.toContain(PASSWORD);

    const [session] = await rows<{ token_hash: string; expires_at: Date }>("SELECT * FROM sessions");
    expect(session!.token_hash).toBe(sha256Hex(result.session.token));
    expect(session!.token_hash).not.toBe(result.session.token);
    expect(session!.expires_at.getTime()).toBe(at(SESSION_DAYS * 86_400_000).getTime());
  });

  it("returns only the PublicUser fields", async () => {
    const result = expectOk(await register(db, { username: "ethan", password: PASSWORD }, req()));
    expect(Object.keys(result.user).sort()).toEqual(["id", "username"]);
  });

  it("refuses a username that's taken, ignoring case", async () => {
    expectOk(await register(db, { username: "Ethan", password: PASSWORD }, req()));
    expect(await register(db, { username: "ETHAN", password: PASSWORD }, req())).toEqual({
      ok: false,
      reason: "taken",
      errors: { username: "That username is taken." },
    });
    expect(await rows("SELECT * FROM users")).toHaveLength(1);
  });

  it("refuses an email address as a username, and stores nothing", async () => {
    const result = await register(db, { username: "ethan@stanford.edu", password: PASSWORD }, req());
    expect(result).toMatchObject({ ok: false, reason: "invalid", errors: { username: expect.stringMatching(/email/) } });
    expect(await rows("SELECT * FROM users")).toHaveLength(0);
  });

  it("reports both field errors at once", async () => {
    const result = await register(db, { username: "a", password: "short" }, req());
    expect(result).toMatchObject({
      ok: false,
      reason: "invalid",
      errors: { username: expect.any(String), password: expect.any(String) },
    });
  });

  it(`allows ${RATE_LIMITS.registerPerIp.max} sign-ups per address per hour`, async () => {
    for (let i = 0; i < RATE_LIMITS.registerPerIp.max; i++) {
      expectOk(await register(db, { username: `user${i}`, password: PASSWORD }, req()));
    }
    expect(await register(db, { username: "onemore", password: PASSWORD }, req())).toMatchObject({
      ok: false,
      reason: "rate-limited",
    });
    // Another address is unaffected, and the first one recovers after the window.
    expectOk(await register(db, { username: "other", password: PASSWORD }, req("198.51.100.1")));
    expectOk(
      await register(db, { username: "later", password: PASSWORD }, req("203.0.113.7", at(RATE_LIMITS.registerPerIp.windowMs + 1))),
    );
  });

  it("doesn't limit this machine's own address off Vercel, so local and e2e runs don't share one count", async () => {
    for (let i = 0; i <= RATE_LIMITS.registerPerIp.max; i++) {
      expectOk(await register(db, { username: `local${i}`, password: PASSWORD }, req("127.0.0.1")));
    }
    expect(await rows("SELECT key FROM rate_limits")).toEqual([]);
  });

  it("never stores the raw IP address", async () => {
    await register(db, { username: "ethan", password: PASSWORD }, req("203.0.113.7"));
    const keys = (await rows<{ key: string }>("SELECT key FROM rate_limits")).map((r) => r.key);
    expect(keys).toHaveLength(1);
    expect(keys.join()).not.toContain("203.0.113.7");
    expect(keys[0]).toBe(`register:ip:${sha256Hex("203.0.113.7")}`);
  });
});

describe("login", () => {
  beforeEach(async () => {
    expectOk(await register(db, { username: "Ethan", password: PASSWORD }, req("192.0.2.1")));
  });

  it("logs in with the right password, ignoring username case, and starts a new session", async () => {
    const result = expectOk(await login(db, { username: " ethan ", password: PASSWORD }, req()));
    expect(result.user.username).toBe("Ethan");
    expect(await findSessionUser(db, sha256Hex(result.session.token), T0)).toEqual(result.user);
    expect(await rows("SELECT * FROM sessions")).toHaveLength(2);
  });

  it("gives the same answer for a wrong password and an unknown username", async () => {
    const wrongPassword = await login(db, { username: "Ethan", password: "nope nope" }, req());
    const unknownUser = await login(db, { username: "nobody", password: PASSWORD }, req());
    expect(wrongPassword).toEqual({ ok: false, reason: "wrong-credentials", message: expect.any(String) });
    expect(unknownUser).toEqual(wrongPassword);
  });

  it("asks for both fields", async () => {
    expect(await login(db, { username: "", password: "" }, req())).toMatchObject({
      reason: "invalid",
      errors: { username: expect.any(String), password: expect.any(String) },
    });
  });

  it(`locks a username after ${RATE_LIMITS.loginPerUser.max} attempts, even from different addresses and with the right password`, async () => {
    for (let i = 0; i < RATE_LIMITS.loginPerUser.max; i++) {
      const r = await login(db, { username: "Ethan", password: "wrong pass" }, req(`198.51.100.${i}`));
      expect(r).toMatchObject({ reason: "wrong-credentials" });
    }
    expect(await login(db, { username: "ETHAN", password: PASSWORD }, req("198.51.100.200"))).toMatchObject({
      ok: false,
      reason: "rate-limited",
    });
    // After the window, the right password works again.
    expectOk(await login(db, { username: "Ethan", password: PASSWORD }, req("203.0.113.9", at(RATE_LIMITS.loginPerUser.windowMs + 1))));
  });

  it("clears a username's failed attempts after a successful login", async () => {
    for (let i = 0; i < RATE_LIMITS.loginPerUser.max - 1; i++) {
      await login(db, { username: "Ethan", password: "wrong pass" }, req());
    }
    expectOk(await login(db, { username: "Ethan", password: PASSWORD }, req()));
    expect(await login(db, { username: "Ethan", password: "wrong pass" }, req())).toMatchObject({
      reason: "wrong-credentials",
    });
  });

  it(`limits one address to ${RATE_LIMITS.loginPerIp.max} attempts across usernames`, async () => {
    for (let i = 0; i < RATE_LIMITS.loginPerIp.max; i++) {
      await login(db, { username: `guess${i}`, password: "wrong pass" }, req());
    }
    expect(await login(db, { username: "Ethan", password: PASSWORD }, req())).toMatchObject({ reason: "rate-limited" });
    expectOk(await login(db, { username: "Ethan", password: PASSWORD }, req("198.51.100.50")));
  });

  it("an address over its limit can't add to a username's count, so it can't keep an account locked", async () => {
    const attacker = "198.51.100.66";
    for (let i = 0; i < RATE_LIMITS.loginPerIp.max; i++) {
      await login(db, { username: `guess${i}`, password: "wrong pass" }, req(attacker));
    }
    // Blocked: from here on, its attempts on Ethan don't count against Ethan.
    for (let i = 0; i < RATE_LIMITS.loginPerUser.max + 5; i++) {
      expect(await login(db, { username: "Ethan", password: "wrong pass" }, req(attacker))).toMatchObject({
        reason: "rate-limited",
      });
    }
    const [row] = await rows<{ key: string }>(`SELECT key FROM rate_limits WHERE key = '${loginUserKey("Ethan")}'`);
    expect(row).toBeUndefined();
    expectOk(await login(db, { username: "Ethan", password: PASSWORD }, req("192.0.2.80")));
  });

  it("never stores what was typed as the username: an email or a password typed into the wrong box", async () => {
    for (const typed of ["Alice@Example.com", "MySecretPassw0rd!", "MySecretPassw0rd", "Ethan"]) {
      await login(db, { username: typed, password: "wrong pass" }, req());
    }
    const keys = (await rows<{ key: string }>("SELECT key FROM rate_limits")).map((r) => r.key).join("\n").toLowerCase();
    for (const typed of ["alice", "example.com", "mysecretpassw0rd", "ethan"]) expect(keys).not.toContain(typed);
    expect(keys).toContain(loginUserKey("ETHAN"));
  });

  it("refuses a username no account could have, without touching the database", async () => {
    const noDb = () => {
      throw new Error("the database should not be touched");
    };
    for (const username of ["x".repeat(12_000), "alice@example.com", "ab", "o'brien"]) {
      expect(await login(noDb, { username, password: "wrong pass" }, req())).toEqual({
        ok: false,
        reason: "wrong-credentials",
        message: "That username and password don't match.",
      });
    }
  });

  it.each(["Jane Doe", "jane\u200Bdoe", "x ".repeat(6_000)])(
    "says usernames have no spaces for %j, without touching the database (#133)",
    async (username) => {
      const noDb = () => {
        throw new Error("the database should not be touched");
      };
      expect(await login(noDb, { username, password: "wrong pass" }, req())).toEqual({
        ok: false,
        reason: "invalid",
        errors: { username: "Usernames don't have spaces. Check the username you signed up with." },
      });
    },
  );
});

describe("sessions", () => {
  it("find their user until they expire", async () => {
    const { session, user } = expectOk(await register(db, { username: "ethan", password: PASSWORD }, req()));
    const hash = sha256Hex(session.token);
    expect(await findSessionUser(db, hash, at(SESSION_DAYS * 86_400_000 - 1))).toEqual(user);
    expect(await findSessionUser(db, hash, at(SESSION_DAYS * 86_400_000))).toBeNull();
  });

  it("can't be found by the raw token, only by its hash", async () => {
    const { session } = expectOk(await register(db, { username: "ethan", password: PASSWORD }, req()));
    expect(await findSessionUser(db, session.token, T0)).toBeNull();
  });

  it("end on the server at logout, and other sessions of the same user stay", async () => {
    const first = expectOk(await register(db, { username: "ethan", password: PASSWORD }, req()));
    const second = expectOk(await login(db, { username: "ethan", password: PASSWORD }, req()));
    await deleteSession(db, sha256Hex(first.session.token));
    expect(await findSessionUser(db, sha256Hex(first.session.token), T0)).toBeNull();
    expect(await findSessionUser(db, sha256Hex(second.session.token), T0)).toEqual(second.user);
  });

  it("are deleted with their user", async () => {
    expectOk(await register(db, { username: "ethan", password: PASSWORD }, req()));
    await pg.exec("DELETE FROM users");
    expect(await rows("SELECT * FROM sessions")).toHaveLength(0);
  });

  it("are swept once expired", async () => {
    expectOk(await register(db, { username: "ethan", password: PASSWORD }, req()));
    expect(await deleteExpiredSessions(db, T0)).toBe(0);
    expect(await deleteExpiredSessions(db, at(SESSION_DAYS * 86_400_000 + 1))).toBe(1);
  });
});

describe("hitRateLimit", () => {
  it("counts hits in a window and restarts after it", async () => {
    expect(await hitRateLimit(db, "k", 1000, T0)).toBe(1);
    expect(await hitRateLimit(db, "k", 1000, at(500))).toBe(2);
    expect(await hitRateLimit(db, "k", 1000, at(999))).toBe(3);
    expect(await hitRateLimit(db, "k", 1000, at(1000))).toBe(1);
    expect(await hitRateLimit(db, "other", 1000, at(1000))).toBe(1);
  });

  it("counts concurrent hits without losing any", async () => {
    const counts = await Promise.all(Array.from({ length: 10 }, () => hitRateLimit(db, "k", 60_000, T0)));
    expect(counts.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("old windows can be swept", async () => {
    await hitRateLimit(db, "old", 1000, T0);
    await hitRateLimit(db, "new", 1000, at(5000));
    expect(await deleteExpiredRateLimits(db, at(1000))).toBe(1);
    expect((await rows<{ key: string }>("SELECT key FROM rate_limits")).map((r) => r.key)).toEqual(["new"]);
  });
});

describe("input checks", () => {
  const noDb = () => {
    throw new Error("the database should not be touched");
  };

  it("reject a bad sign-up before touching the database", async () => {
    expect(await register(noDb, { username: "a@b.c", password: "x" }, req())).toMatchObject({ reason: "invalid" });
  });

  it("reject an empty login before touching the database", async () => {
    expect(await login(noDb, { username: "", password: "" }, req())).toMatchObject({ reason: "invalid" });
  });
});

describe("limitsAddress", () => {
  it("limits every address on Vercel, even a missing one", () => {
    for (const ip of ["203.0.113.7", "127.0.0.1", "::1", null]) expect(limitsAddress(ip, true), String(ip)).toBe(true);
  });

  it("off Vercel, skips this machine (loopback or no address) and limits everyone else", () => {
    for (const ip of ["127.0.0.1", "127.8.9.10", "::1", "::ffff:127.0.0.1", null]) {
      expect(limitsAddress(ip, false), String(ip)).toBe(false);
    }
    for (const ip of ["203.0.113.7", "10.0.0.1", "192.168.1.20", "2001:db8::1", "::ffff:203.0.113.7"]) {
      expect(limitsAddress(ip, false), ip).toBe(true);
    }
  });
});
