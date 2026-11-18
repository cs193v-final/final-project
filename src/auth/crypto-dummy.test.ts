// The dummy hash (#53) when argon2 fails once, e.g. it can't get its memory
// on a cold start. In its own file because it replaces node:crypto's argon2.
import { describe, expect, it, vi } from "vitest";

let failNext = true;
vi.mock("node:crypto", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:crypto")>();
  const argon2: typeof real.argon2 = (algorithm, params, callback) => {
    if (failNext) {
      failNext = false;
      queueMicrotask(() => callback(new Error("out of memory"), Buffer.alloc(0)));
      return;
    }
    real.argon2(algorithm, params, callback);
  };
  return { ...real, argon2 };
});

const { getDummyPasswordHash, verifyPassword } = await import("./crypto");

describe("getDummyPasswordHash after a failure", () => {
  it("tries again on the next call instead of failing for good", async () => {
    await expect(getDummyPasswordHash()).rejects.toThrow("out of memory");
    const hash = await getDummyPasswordHash();
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword("", hash)).toBe(false);
    expect(await getDummyPasswordHash()).toBe(hash);
  });
});
