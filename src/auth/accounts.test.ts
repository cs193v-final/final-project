// Register, login, sessions and rate limits (#53) against an in-memory Postgres
// (PGlite) with the real migrations.
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { DecryptionError, Vault } from "@/crypto/vault";
import { deleteExpiredRateLimits, deleteExpiredSessions, deleteSession, findLoginRow, hitRateLimit, type PgDb } from "@/db/accounts";
import * as schema from "@/db/schema";

import {
  accountUserKey,
  changePassword,
  deleteAccount,
  DEVICE_TOKEN_DAYS,
  ipKey,
  isDeviceTokenFor,
  limitsAddress,
  login,
  loginDeviceKey,
  loginUserKey,
  MAX_SESSIONS_PER_USER,
  RATE_LIMITS,
  register,
  sessionUser,
  SESSION_DAYS,
  USERNAME_FIELD,
  usernameIndex,
  type AuthResult,
  type ChangePasswordResult,
} from "./accounts";
import { sha256Hex } from "./crypto";

// register and login read the key from the environment (getVault), like the
// app. Stubbed for this file only (restored in afterAll), so other test files
// in the same worker don't depend on file order.
vi.stubEnv("DATA_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
const vault = Vault.fromEnv();
const findSessionUser = (db: PgDb, tokenHash: string, now: Date) => sessionUser(db, vault, tokenHash, now);

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
  vi.unstubAllEnvs();
  await pg.close();
});

beforeEach(async () => {
  await pg.exec("DELETE FROM games; DELETE FROM sessions; DELETE FROM users; DELETE FROM rate_limits;");
});

const T0 = new Date("2026-11-17T12:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const req = (ip: string | null = "203.0.113.7", now = T0, device: string | null = null) => ({ ip, now, device });
const PASSWORD = "correct horse battery";

function expectOk<R extends AuthResult | ChangePasswordResult>(result: R): Extract<R, { ok: true }> {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result)}`);
  return result as Extract<R, { ok: true }>;
}

async function rows<T>(query: string): Promise<T[]> {
  return (await pg.query<T>(query)).rows;
}

/** Whether the server would trust `token` for `username`'s account as it is now (its current password hash). */
async function trusts(username: string, token: unknown, now = T0): Promise<boolean> {
  const row = await findLoginRow(db, usernameIndex(vault, username));
  return row !== null && isDeviceTokenFor(vault, { username, passwordHash: row.passwordHash }, token, now);
}

describe("register", () => {
  it("creates the user, stores only a hash, and starts a session", async () => {
    const result = expectOk(await register(db, { username: "Ethan", password: PASSWORD }, req()));
    expect(result.user).toEqual({ id: expect.any(String), username: "Ethan" });

    const [user] = await rows<{ id: string; username_encrypted: string; username_index: string; password_hash: string }>(
      "SELECT * FROM users",
    );
    expect(user!.id).toBe(result.user.id);
    expect(user!.password_hash).toMatch(/^\$argon2id\$/);
    expect(user!.password_hash).not.toContain(PASSWORD);

    const [session] = await rows<{ token_hash: string; expires_at: Date }>("SELECT * FROM sessions");
    expect(session!.token_hash).toBe(sha256Hex(result.session.token));
    expect(session!.token_hash).not.toBe(result.session.token);
    expect(session!.expires_at.getTime()).toBe(at(SESSION_DAYS * 86_400_000).getTime());
  });

  it("stores the username only encrypted with the user's key, plus a keyed hash (#84)", async () => {
    const { user } = expectOk(await register(db, { username: "Ethan", password: PASSWORD }, req()));
    const [row] = await rows<Record<string, unknown>>("SELECT * FROM users");
    expect(Object.keys(row!).sort()).toEqual(["created_at", "id", "password_hash", "username_encrypted", "username_index"]);
    expect(JSON.stringify(row).toLowerCase()).not.toContain("ethan");
    expect(vault.decrypt(user.id, USERNAME_FIELD, row!.username_encrypted as string)).toBe("Ethan");
    expect(row!.username_index).toBe(usernameIndex(vault, "ethan"));
    // Not a plain hash anyone could recompute from a list of names.
    expect(row!.username_index).not.toBe(sha256Hex("ethan"));
  });

  it("another key can't read or find the username", async () => {
    const { user } = expectOk(await register(db, { username: "Ethan", password: PASSWORD }, req()));
    const other = new Vault(Buffer.alloc(32, 1));
    const [row] = await rows<{ username_encrypted: string; username_index: string }>("SELECT * FROM users");
    expect(() => other.decrypt(user.id, USERNAME_FIELD, row!.username_encrypted)).toThrow();
    expect(usernameIndex(other, "ethan")).not.toBe(row!.username_index);
    expect(await login(db, { username: "Ethan", password: PASSWORD }, req(), other)).toMatchObject({
      reason: "wrong-credentials",
    });
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
    expect(keys[0]).toBe(ipKey(vault, "register", "203.0.113.7"));
    // A keyed hash: an unkeyed SHA-256 of every IPv4 address would reverse it.
    expect(keys[0]).not.toContain(sha256Hex("203.0.113.7"));
  });

  it("counts every IPv6 address in one /64 as one address (#150)", async () => {
    for (let i = 0; i < RATE_LIMITS.registerPerIp.max; i++) {
      expectOk(await register(db, { username: `six${i}`, password: PASSWORD }, req(`2001:db8:1:2::${(i + 1).toString(16)}`)));
    }
    expect(await register(db, { username: "rotated", password: PASSWORD }, req("2001:DB8:1:2:abcd:ef01:2345:6789"))).toMatchObject({
      reason: "rate-limited",
    });
    // The next /64 over has its own count.
    expectOk(await register(db, { username: "neighbor", password: PASSWORD }, req("2001:db8:1:3::1")));
    const keys = (await rows<{ key: string }>("SELECT key FROM rate_limits")).map((r) => r.key);
    expect(new Set(keys)).toEqual(new Set([ipKey(vault, "register", "2001:db8:1:2::"), ipKey(vault, "register", "2001:db8:1:3::")]));
  });

  it("never stores a username in a rate-limit key (#84)", async () => {
    await login(db, { username: "Ethan", password: "wrong pass" }, req());
    const keys = (await rows<{ key: string }>("SELECT key FROM rate_limits")).map((r) => r.key);
    expect(keys).toContain(loginUserKey(vault, "ETHAN"));
    expect(keys.join().toLowerCase()).not.toContain("ethan");
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

  describe("a browser that logged into the account before (#151)", () => {
    // `register` in the outer beforeEach was this browser's first login.
    let device: string;
    beforeEach(async () => {
      device = expectOk(await login(db, { username: "Ethan", password: PASSWORD }, req("192.0.2.1"))).device;
    });

    async function lockEthan() {
      for (let i = 0; i < RATE_LIMITS.loginPerUser.max + 1; i++) {
        await login(db, { username: "Ethan", password: "wrong pass" }, req(`198.51.100.${i}`));
      }
      expect(await login(db, { username: "Ethan", password: PASSWORD }, req("198.51.100.200"))).toMatchObject({
        reason: "rate-limited",
      });
    }

    it("gets a device token for that username at sign-up and every login", async () => {
      const signup = expectOk(await register(db, { username: "Mallory", password: PASSWORD }, req("192.0.2.2")));
      expect(await trusts("mallory", signup.device, T0)).toBe(true);
      expect(await trusts("ETHAN", device, T0)).toBe(true);
      expect(await trusts("Ethan", signup.device, T0)).toBe(false);
    });

    it(`stops being trusted ${DEVICE_TOKEN_DAYS} days after it was made, whatever the cookie says`, async () => {
      const DAY = 24 * 60 * 60 * 1000;
      expect(await trusts("Ethan", device, at((DEVICE_TOKEN_DAYS - 1) * DAY))).toBe(true);
      expect(await trusts("Ethan", device, at(DEVICE_TOKEN_DAYS * DAY))).toBe(false);
      // Nor before the day it was made (a clock set back).
      expect(await trusts("Ethan", device, at(-DAY))).toBe(false);
    });

    it("keeps its token on later logins, so logging in again doesn't add another guessing budget", async () => {
      expect(expectOk(await login(db, { username: "Ethan", password: PASSWORD }, req("192.0.2.1", T0, device))).device).toBe(device);
      // A browser without one gets a new one.
      const fresh = expectOk(await login(db, { username: "Ethan", password: PASSWORD }, req("192.0.2.1"))).device;
      expect(fresh).not.toBe(device);
      expect(await trusts("Ethan", fresh, T0)).toBe(true);
    });

    it("logging in with it doesn't reset the username's count, so it gives a guesser no new attempts", async () => {
      await lockEthan();
      expectOk(await login(db, { username: "Ethan", password: PASSWORD }, req("203.0.113.50", T0, device)));
      // The guesser, without the token, is still locked out, even with the right password.
      expect(await login(db, { username: "Ethan", password: PASSWORD }, req("198.51.100.201"))).toMatchObject({
        reason: "rate-limited",
      });
    });

    it(`still counts against, and is stopped by, the address's limit of ${RATE_LIMITS.loginPerIp.max}`, async () => {
      const ip = "198.51.100.77";
      for (let i = 0; i < RATE_LIMITS.loginPerIp.max; i++) {
        await login(db, { username: `guess${i}`, password: "wrong pass" }, req(ip));
      }
      expect(await login(db, { username: "Ethan", password: PASSWORD }, req(ip, T0, device))).toMatchObject({
        reason: "rate-limited",
      });
      // Stopped before the device's own count, so a blocked address can't use it up.
      const keys = (await rows<{ key: string }>("SELECT key FROM rate_limits")).map((r) => r.key);
      expect(keys).not.toContain(loginDeviceKey(vault, device));
    });

    it("still logs in with the right password while the username is locked by someone else's guesses", async () => {
      await lockEthan();
      const result = expectOk(await login(db, { username: "Ethan", password: PASSWORD }, req("203.0.113.50", T0, device)));
      expect(result.user.username).toBe("Ethan");
    });

    it(`has its own limit of ${RATE_LIMITS.loginPerDevice.max} attempts, so a stolen token isn't unlimited guessing`, async () => {
      for (let i = 0; i < RATE_LIMITS.loginPerDevice.max; i++) {
        expect(await login(db, { username: "Ethan", password: "wrong pass" }, req(`198.51.100.${i}`, T0, device))).toMatchObject({
          reason: "wrong-credentials",
        });
      }
      expect(await login(db, { username: "Ethan", password: PASSWORD }, req("198.51.100.99", T0, device))).toMatchObject({
        reason: "rate-limited",
      });
      // Its guesses didn't count against the username: a browser without the token isn't locked out.
      expectOk(await login(db, { username: "Ethan", password: PASSWORD }, req("198.51.100.98")));
    });

    it("isn't trusted with another username's token, a forged one or junk", async () => {
      const mallory = expectOk(await register(db, { username: "Mallory", password: PASSWORD }, req("192.0.2.3"))).device;
      await lockEthan();
      const [nonce, day, mac] = device.split(".") as [string, string, string];
      const forged = [
        mallory,
        `${nonce}.${day}.${mac.slice(0, -1)}${mac.endsWith("0") ? "1" : "0"}`,
        `${"A".repeat(nonce.length)}.${day}.${mac}`,
        `${nonce}.${Number(day) - 1}.${mac}`, // an older day, to dodge expiry
        `${nonce}.${mac}`,
        "",
        "junk",
        `${device}.extra`,
        "x".repeat(10_000),
      ];
      for (const token of forged) {
        expect(await login(db, { username: "Ethan", password: PASSWORD }, req("203.0.113.51", T0, token)), token.slice(0, 40)).toMatchObject({
          reason: "rate-limited",
        });
      }
    });

    it("doesn't carry the username, and its limit key doesn't carry the token", async () => {
      expect(device.toLowerCase()).not.toContain("ethan");
      await login(db, { username: "Ethan", password: "wrong pass" }, req("203.0.113.52", T0, device));
      const keys = (await rows<{ key: string }>("SELECT key FROM rate_limits")).map((r) => r.key);
      expect(keys).toContain(loginDeviceKey(vault, device));
      for (const part of device.split(".")) expect(keys.join("\n")).not.toContain(part);
    });
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

  it("limits a client that rotates through addresses in its IPv6 /64 like one address (#150)", async () => {
    const inPrefix = (i: number) => `2001:db8:abcd:12::${(i + 1).toString(16)}:${((i * 7919) & 0xffff).toString(16)}`;
    for (let i = 0; i < RATE_LIMITS.loginPerIp.max; i++) {
      expect(await login(db, { username: `guess${i}`, password: "wrong pass" }, req(inPrefix(i)))).toMatchObject({
        reason: "wrong-credentials",
      });
    }
    expect(await login(db, { username: "Ethan", password: PASSWORD }, req(inPrefix(RATE_LIMITS.loginPerIp.max)))).toMatchObject({
      reason: "rate-limited",
    });
    expect(await login(db, { username: "Ethan", password: PASSWORD }, req("[2001:db8:abcd:12::ffff]"))).toMatchObject({
      reason: "rate-limited",
    });
    // Another /64, and an IPv4 client, are unaffected.
    expectOk(await login(db, { username: "Ethan", password: PASSWORD }, req("2001:db8:abcd:13::1")));
    expectOk(await login(db, { username: "Ethan", password: PASSWORD }, req("198.51.100.50")));
  });

  it("counts an IPv4-mapped address with its plain IPv4 form", async () => {
    for (let i = 0; i < RATE_LIMITS.loginPerIp.max; i++) {
      await login(db, { username: `guess${i}`, password: "wrong pass" }, req(i % 2 ? "203.0.113.7" : "::ffff:203.0.113.7"));
    }
    expect(await login(db, { username: "Ethan", password: PASSWORD }, req("203.0.113.7"))).toMatchObject({ reason: "rate-limited" });
    expect(ipKey(vault, "login", "::ffff:203.0.113.7")).toBe(ipKey(vault, "login", "203.0.113.7"));
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
    const [row] = await rows<{ key: string }>(`SELECT key FROM rate_limits WHERE key = '${loginUserKey(vault, "Ethan")}'`);
    expect(row).toBeUndefined();
    expectOk(await login(db, { username: "Ethan", password: PASSWORD }, req("192.0.2.80")));
  });

  it("never stores what was typed as the username: an email or a password typed into the wrong box", async () => {
    for (const typed of ["Alice@Example.com", "MySecretPassw0rd!", "MySecretPassw0rd", "Ethan"]) {
      await login(db, { username: typed, password: "wrong pass" }, req());
    }
    const keys = (await rows<{ key: string }>("SELECT key FROM rate_limits")).map((r) => r.key).join("\n").toLowerCase();
    for (const typed of ["alice", "example.com", "mysecretpassw0rd", "ethan"]) expect(keys).not.toContain(typed);
    expect(keys).toContain(loginUserKey(vault, "ETHAN"));
  });

  it("decrypts the username before clearing the username's attempts, so a bad key doesn't reset the limit", async () => {
    await pg.exec(`UPDATE users SET username_encrypted = 'v1.${"A".repeat(16)}.${"A".repeat(40)}'`);
    await expect(login(db, { username: "Ethan", password: PASSWORD }, req())).rejects.toThrow(DecryptionError);
    const [row] = await rows<{ count: number }>(`SELECT count FROM rate_limits WHERE key = '${loginUserKey(vault, "Ethan")}'`);
    expect(row?.count).toBe(1);
    expect(await rows("SELECT * FROM sessions")).toHaveLength(1); // only the one from sign-up
  });

  // No account can have such a name, so saying why reveals nothing (#133).
  it.each([
    ["Jane Doe", /don't have spaces/],
    ["jane\u200Bdoe", /don't have spaces/],
    ["o'brien", /don't have “'”/],
    ["jose.garcia", /don't have “\.”/],
    ["alice@example.com", /aren't email addresses/],
    ["ab", /3 to 20 characters/],
    ["x".repeat(12_000), /3 to 20 characters/],
    ["x ".repeat(6_000), /3 to 20 characters/],
  ])("says what's wrong with %j, without touching the database (#133)", async (username, hint) => {
    const noDb = () => {
      throw new Error("the database should not be touched");
    };
    expect(await login(noDb, { username, password: "wrong pass" }, req())).toEqual({
      ok: false,
      reason: "invalid",
      errors: { username: expect.stringMatching(hint) },
    });
  });
});

describe("sessions", () => {
  it("find their user until they expire", async () => {
    const { session, user } = expectOk(await register(db, { username: "ethan", password: PASSWORD }, req()));
    const hash = sha256Hex(session.token);
    expect(await findSessionUser(db, hash, at(SESSION_DAYS * 86_400_000 - 1))).toEqual(user);
    expect(await findSessionUser(db, hash, at(SESSION_DAYS * 86_400_000))).toBeNull();
  });

  it("count as logged out when the username doesn't decrypt (another key), and that session is ended", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { session } = expectOk(await register(db, { username: "ethan", password: PASSWORD }, req()));
    const other = new Vault(Buffer.alloc(32, 1));
    expect(await sessionUser(db, other, sha256Hex(session.token), T0)).toBeNull();
    expect(await rows("SELECT * FROM sessions")).toHaveLength(0);
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/DATA_ENCRYPTION_KEY/));
    expect(JSON.stringify(error.mock.calls)).not.toContain("ethan");
    error.mockRestore();
  });

  it("still throw for a database error", async () => {
    const broken = {
      select: () => {
        throw new Error("Failed query");
      },
    } as unknown as PgDb;
    await expect(sessionUser(broken, vault, "x".repeat(64), T0)).rejects.toThrow("Failed query");
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

  describe(`are capped at ${MAX_SESSIONS_PER_USER} per user (#156)`, () => {
    const logIn = async (username: string, minute: number) =>
      expectOk(await login(db, { username, password: PASSWORD }, req("203.0.113.7", at(minute * 60_000))));
    const countFor = async (userId: string) =>
      (await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM sessions WHERE user_id = $1", [userId])).rows[0]!.n;
    const LAST = at(MAX_SESSIONS_PER_USER * 60_000);

    it("so one more login ends the oldest session, and the newer ones keep working", async () => {
      const first = expectOk(await register(db, { username: "ethan", password: PASSWORD }, req()));
      const later = [];
      for (let i = 1; i < MAX_SESSIONS_PER_USER; i++) later.push(await logIn("ethan", i));
      expect(await countFor(first.user.id)).toBe(MAX_SESSIONS_PER_USER);
      expect(await findSessionUser(db, sha256Hex(first.session.token), LAST)).toEqual(first.user);

      const newest = await logIn("ethan", MAX_SESSIONS_PER_USER);
      expect(await countFor(first.user.id)).toBe(MAX_SESSIONS_PER_USER);
      expect(await findSessionUser(db, sha256Hex(first.session.token), LAST)).toBeNull();
      for (const { session } of [...later, newest]) {
        expect(await findSessionUser(db, sha256Hex(session.token), LAST)).toEqual(first.user);
      }
    });

    it("and the new session always survives, even when the others claim to be newer", async () => {
      const { user } = expectOk(await register(db, { username: "ethan", password: PASSWORD }, req()));
      for (let i = 1; i < MAX_SESSIONS_PER_USER; i++) await logIn("ethan", i);
      // A clock that ran ahead: every existing session says it's from tomorrow.
      await pg.exec("UPDATE sessions SET created_at = now() + interval '1 day'");
      const newest = await logIn("ethan", MAX_SESSIONS_PER_USER);
      expect(await countFor(user.id)).toBe(MAX_SESSIONS_PER_USER);
      expect(await findSessionUser(db, sha256Hex(newest.session.token), LAST)).toEqual(user);
    });

    it("without touching other users' sessions", async () => {
      const other = expectOk(await register(db, { username: "darian", password: PASSWORD }, req()));
      for (let i = 1; i < MAX_SESSIONS_PER_USER; i++) await logIn("darian", i);
      const { user } = expectOk(await register(db, { username: "ethan", password: PASSWORD }, req()));
      for (let i = 1; i <= MAX_SESSIONS_PER_USER + 2; i++) await logIn("ethan", i);
      expect(await countFor(user.id)).toBe(MAX_SESSIONS_PER_USER);
      expect(await countFor(other.user.id)).toBe(MAX_SESSIONS_PER_USER);
      expect(await findSessionUser(db, sha256Hex(other.session.token), LAST)).toEqual(other.user);
    });

    it("and the user's expired sessions are deleted at their next login", async () => {
      const first = expectOk(await register(db, { username: "ethan", password: PASSWORD }, req()));
      const second = await logIn("ethan", 1);
      const third = await logIn("ethan", SESSION_DAYS * 24 * 60 + 0.5); // past the first one's expiry, not the second's
      const hashes = (await rows<{ token_hash: string }>("SELECT token_hash FROM sessions")).map((r) => r.token_hash);
      expect(hashes.sort()).toEqual([sha256Hex(second.session.token), sha256Hex(third.session.token)].sort());
      expect(hashes).not.toContain(sha256Hex(first.session.token));
    });
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

describe("changing the password (#234)", () => {
  const NEW_PASSWORD = "a brand new passphrase";
  let user: { id: string; username: string };
  let session: string;
  let device: string;
  beforeEach(async () => {
    const signup = expectOk(await register(db, { username: "Ethan", password: PASSWORD }, req("192.0.2.1")));
    ({ user, device } = signup);
    session = signup.session.token;
  });
  const change = (current: unknown, password: unknown, r = req()) => changePassword(db, user.id, { current, password }, r);

  it("needs the current password, and then only the new one works", async () => {
    expect(await change("wrong pass", NEW_PASSWORD)).toMatchObject({ ok: false, reason: "wrong-credentials" });
    expectOk(await login(db, { username: "Ethan", password: PASSWORD }, req())); // unchanged

    expectOk(await change(PASSWORD, NEW_PASSWORD));
    expect(await login(db, { username: "Ethan", password: PASSWORD }, req())).toMatchObject({ reason: "wrong-credentials" });
    expectOk(await login(db, { username: "Ethan", password: NEW_PASSWORD }, req()));
  });

  it("ends every session, including other browsers', and starts a new one for this browser", async () => {
    const elsewhere = expectOk(await login(db, { username: "Ethan", password: PASSWORD }, req("198.51.100.3"))).session.token;
    const result = expectOk(await change(PASSWORD, NEW_PASSWORD));
    for (const token of [session, elsewhere]) expect(await findSessionUser(db, sha256Hex(token), T0)).toBeNull();
    expect(await findSessionUser(db, sha256Hex(result.session.token), T0)).toEqual(user);
    expect(await rows("SELECT * FROM sessions")).toHaveLength(1);
  });

  it("stops every old device token being trusted, and gives this browser a new one", async () => {
    expect(await trusts("Ethan", device)).toBe(true);
    const result = expectOk(await change(PASSWORD, NEW_PASSWORD));
    expect(await trusts("Ethan", device)).toBe(false);
    expect(await trusts("Ethan", result.device)).toBe(true);
    // So the old token no longer gets its owner past someone else's guesses.
    for (let i = 0; i < RATE_LIMITS.loginPerUser.max + 1; i++) {
      await login(db, { username: "Ethan", password: "wrong pass" }, req(`198.51.100.${i}`));
    }
    expect(await login(db, { username: "Ethan", password: NEW_PASSWORD }, req("203.0.113.50", T0, device))).toMatchObject({
      reason: "rate-limited",
    });
    expectOk(await login(db, { username: "Ethan", password: NEW_PASSWORD }, req("203.0.113.50", T0, result.device)));
  });

  it("checks the new password with the sign-up rules, and asks for the current one", async () => {
    const before = await rows("SELECT * FROM rate_limits");
    expect(await change("", "short")).toEqual({
      ok: false,
      reason: "invalid",
      errors: { current: expect.any(String), password: expect.any(String) },
    });
    expect(await rows("SELECT * FROM rate_limits")).toEqual(before); // refused before the database
  });

  it(`allows ${RATE_LIMITS.accountPerUser.max} tries per account per window, even from different addresses`, async () => {
    for (let i = 0; i < RATE_LIMITS.accountPerUser.max; i++) {
      expect(await change("wrong pass", NEW_PASSWORD, req(`198.51.100.${i}`))).toMatchObject({ reason: "wrong-credentials" });
    }
    expect(await change(PASSWORD, NEW_PASSWORD, req("198.51.100.99"))).toMatchObject({ reason: "rate-limited" });
    expectOk(await change(PASSWORD, NEW_PASSWORD, req("198.51.100.99", at(RATE_LIMITS.accountPerUser.windowMs + 1))));
  });

  it(`allows ${RATE_LIMITS.accountPerIp.max} tries per address per window, across accounts`, async () => {
    const ip = "198.51.100.77";
    for (let i = 0; i < RATE_LIMITS.accountPerIp.max; i++) {
      await changePassword(db, `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, { current: "x", password: NEW_PASSWORD }, req(ip));
    }
    expect(await change(PASSWORD, NEW_PASSWORD, req(ip))).toMatchObject({ reason: "rate-limited" });
    // Stopped before the account's own count, so a blocked address can't use it up.
    const keys = (await rows<{ key: string }>("SELECT key FROM rate_limits")).map((r) => r.key);
    expect(keys).not.toContain(accountUserKey(vault, user.id));
  });

  it("says the account is gone if it was deleted meanwhile", async () => {
    await pg.exec("DELETE FROM users");
    expect(await change(PASSWORD, NEW_PASSWORD)).toMatchObject({ ok: false, reason: "gone" });
  });
});

describe("deleting the account (#234)", () => {
  let user: { id: string; username: string };
  let session: string;
  let device: string;
  beforeEach(async () => {
    const signup = expectOk(await register(db, { username: "Ethan", password: PASSWORD }, req("192.0.2.1")));
    ({ user, device } = signup);
    session = signup.session.token;
  });
  const remove = (current: unknown, confirm: unknown, r = req()) => deleteAccount(db, user.id, { current, confirm }, r);

  it("needs the current password and the username typed again (any case)", async () => {
    expect(await remove("wrong pass", "Ethan")).toMatchObject({ ok: false, reason: "wrong-credentials" });
    expect(await remove(PASSWORD, "someone")).toEqual({ ok: false, reason: "invalid", errors: { confirm: expect.any(String) } });
    expect(await remove("", "")).toEqual({
      ok: false,
      reason: "invalid",
      errors: { current: expect.any(String), confirm: expect.any(String) },
    });
    expect(await rows("SELECT * FROM users")).toHaveLength(1);
    expect(await remove(PASSWORD, " ETHAN ")).toEqual({ ok: true });
  });

  it("removes the user and their sessions, so nothing about them can be read or logged into", async () => {
    expectOk(await login(db, { username: "Ethan", password: PASSWORD }, req("198.51.100.3")));
    expect(await remove(PASSWORD, "Ethan")).toEqual({ ok: true });
    expect(await rows("SELECT * FROM users")).toHaveLength(0);
    expect(await rows("SELECT * FROM sessions")).toHaveLength(0);
    expect(await findSessionUser(db, sha256Hex(session), T0)).toBeNull();
    expect(await login(db, { username: "Ethan", password: PASSWORD }, req())).toMatchObject({ reason: "wrong-credentials" });
  });

  it("deletes their games, so they leave the leaderboard", async () => {
    await pg.exec("INSERT INTO packs (id, kind, title, theme) VALUES ('pk-del', 'daily', 'T', 'T') ON CONFLICT DO NOTHING");
    await pg.query(
      `INSERT INTO games (pack_id, user_id, daily_date, state, total, finished_at) VALUES ('pk-del', $1, '2026-11-17', '{}', 300, now())`,
      [user.id],
    );
    expect(await rows("SELECT * FROM games")).toHaveLength(1);
    expect(await remove(PASSWORD, "Ethan")).toEqual({ ok: true });
    expect(await rows("SELECT * FROM games")).toHaveLength(0);
  });

  it("stops the account's device tokens being trusted, even for a new account with the same name", async () => {
    expect(await remove(PASSWORD, "Ethan")).toEqual({ ok: true });
    expectOk(await register(db, { username: "ethan", password: PASSWORD }, req("192.0.2.9")));
    expect(await trusts("ethan", device)).toBe(false);
  });

  it(`shares the ${RATE_LIMITS.accountPerUser.max}-try limit with password changes`, async () => {
    for (let i = 0; i < RATE_LIMITS.accountPerUser.max; i++) {
      await changePassword(db, user.id, { current: "wrong pass", password: "a brand new passphrase" }, req(`198.51.100.${i}`));
    }
    expect(await remove(PASSWORD, "Ethan", req("198.51.100.99"))).toMatchObject({ reason: "rate-limited" });
    expect(await rows("SELECT * FROM users")).toHaveLength(1);
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
