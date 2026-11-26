// Spec for the lobby rules that don't need a database (#67): hard-to-guess
// codes, what a client may send to create a lobby, and when a lobby can be played.
import { describe, expect, it } from "vitest";

import {
  CODE_ALPHABET,
  CODE_BITS,
  CODE_LENGTH,
  formatLobbyCode,
  InvalidLobbyError,
  isLobbyPlayable,
  LOBBY_LIFETIME_MS,
  MAX_ALTERNATES,
  MAX_ANSWER_LENGTH,
  MAX_LOBBY_PUZZLES,
  MIN_LOBBY_PUZZLES,
  newLobbyCode,
  normalizeLobbyCode,
  parseLobbyRounds,
  type LobbyStatus,
} from "./lobby";

const upload = (n: number) => n.toString(16).padStart(32, "0");
const round = (n: number, extra: Record<string, unknown> = {}) => ({
  uploadId: upload(n),
  answer: `Answer ${n}`,
  acceptedAnswers: [],
  focus: { x: 0.5, y: 0.25 },
  ...extra,
});
const rounds = (count: number) => Array.from({ length: count }, (_, i) => round(i + 1));

describe("lobby codes", () => {
  it("are at least 80 random bits, in an alphabet without ambiguous characters", () => {
    expect(CODE_BITS).toBeGreaterThanOrEqual(80);
    expect(CODE_ALPHABET).toHaveLength(32);
    for (const ambiguous of ["I", "L", "O", "U"]) expect(CODE_ALPHABET).not.toContain(ambiguous);
    const code = newLobbyCode();
    expect(code).toHaveLength(CODE_LENGTH);
    expect([...code].every((c) => CODE_ALPHABET.includes(c))).toBe(true);
  });

  it("use every bit of the random bytes", () => {
    expect(newLobbyCode((n) => new Uint8Array(n))).toBe("0".repeat(16));
    expect(newLobbyCode((n) => new Uint8Array(n).fill(255))).toBe("Z".repeat(16));
    // 0x08 0x42 ... = 00001 00001 00001 ...: every group of 5 bits is one character.
    expect(newLobbyCode((n) => Uint8Array.from({ length: n }, (_, i) => [0x08, 0x42, 0x10, 0x84, 0x21][i % 5]!))).toBe(
      "1".repeat(16),
    );
  });

  it("don't repeat", () => {
    const codes = new Set(Array.from({ length: 2000 }, () => newLobbyCode()));
    expect(codes.size).toBe(2000);
  });

  it("are shared in groups of four and read back however they're typed", () => {
    const code = "7KQ2M9XD0A1BZZ34";
    expect(formatLobbyCode(code)).toBe("7KQ2-M9XD-0A1B-ZZ34");
    for (const typed of [code, formatLobbyCode(code), "7kq2 m9xd 0a1b zz34", "7KQ2-M9XD-OAIB-ZZ34", "7kq2m9xdoalbzz34"]) {
      expect(normalizeLobbyCode(typed)).toBe(code);
    }
  });

  it("refuse anything that can't be a code", () => {
    for (const bad of [undefined, null, 42, "", "7KQ2-M9XD", "7KQ2M9XD0A1BZZ345", "7KQ2M9XD0A1BZZ3U", "7KQ2M9XD0A1BZZ3!", "x".repeat(65)]) {
      expect(normalizeLobbyCode(bad)).toBeNull();
    }
  });
});

describe("parseLobbyRounds", () => {
  it(`accepts ${MIN_LOBBY_PUZZLES} to ${MAX_LOBBY_PUZZLES} photos`, () => {
    for (let n = MIN_LOBBY_PUZZLES; n <= MAX_LOBBY_PUZZLES; n++) expect(parseLobbyRounds(rounds(n))).toHaveLength(n);
    for (const n of [0, 1, MIN_LOBBY_PUZZLES - 1, MAX_LOBBY_PUZZLES + 1]) {
      expect(() => parseLobbyRounds(rounds(n))).toThrow(InvalidLobbyError);
    }
    expect(() => parseLobbyRounds("nope")).toThrow(InvalidLobbyError);
  });

  it("trims answers and keeps only alternates that differ from the answer and each other", () => {
    const [first] = parseLobbyRounds([
      round(1, { answer: "  Hoover   Tower ", acceptedAnswers: ["hoover tower", "The Hoover Tower", "the hoover tower!", "Hoover"] }),
      round(2),
      round(3),
    ]);
    expect(first).toEqual({
      uploadId: upload(1),
      answer: "Hoover Tower",
      acceptedAnswers: ["The Hoover Tower", "Hoover"],
      focus: { x: 0.5, y: 0.25 },
    });
  });

  it("refuses answers nobody could guess, or that are too long", () => {
    for (const answer of ["", "   ", "?!", 7, null, "x".repeat(MAX_ANSWER_LENGTH + 1)]) {
      expect(() => parseLobbyRounds([round(1, { answer }), round(2), round(3)])).toThrow(InvalidLobbyError);
    }
    expect(() => parseLobbyRounds([round(1, { acceptedAnswers: ["..."] }), round(2), round(3)])).toThrow(InvalidLobbyError);
    const many = Array.from({ length: MAX_ALTERNATES + 1 }, (_, i) => `alt ${i}`);
    expect(() => parseLobbyRounds([round(1, { acceptedAnswers: many }), round(2), round(3)])).toThrow(InvalidLobbyError);
  });

  it("refuses a missing, malformed or repeated upload", () => {
    for (const uploadId of [undefined, "abc", upload(0xabc).toUpperCase(),"../" + upload(1)]) {
      expect(() => parseLobbyRounds([round(1, { uploadId }), round(2), round(3)])).toThrow(InvalidLobbyError);
    }
    expect(() => parseLobbyRounds([round(1), round(1), round(3)])).toThrow("twice");
  });

  it("refuses a focus point outside the photo", () => {
    for (const focus of [undefined, null, { x: -0.1, y: 0.5 }, { x: 0.5, y: 1.1 }, { x: Number.NaN, y: 0 }, { x: "0.5", y: 0.5 }]) {
      expect(() => parseLobbyRounds([round(1, { focus }), round(2), round(3)])).toThrow(InvalidLobbyError);
    }
  });

  it("never echoes the input in its error", () => {
    try {
      parseLobbyRounds([round(1, { answer: "secret".repeat(20) }), round(2), round(3)]);
    } catch (error) {
      expect(String(error)).not.toContain("secret");
    }
  });
});

describe("isLobbyPlayable", () => {
  const now = new Date("2026-11-26T12:00:00Z");
  const live: LobbyStatus = {
    ownerUserId: "6f1c1f3e-8f53-4a59-9d4e-0d6e2b0c1a11",
    readyAt: new Date(now.getTime() - 1000),
    expiresAt: new Date(now.getTime() + LOBBY_LIFETIME_MS),
    deletedAt: null,
    hiddenAt: null,
  };

  it("is true for a finished, unexpired lobby nobody deleted or hid", () => {
    expect(isLobbyPlayable(live, now)).toBe(true);
  });

  it("is false once it expires, is deleted, is hidden by reports, its owner is gone, or it was never finished", () => {
    expect(isLobbyPlayable({ ...live, expiresAt: now }, now)).toBe(false);
    expect(isLobbyPlayable({ ...live, deletedAt: now }, now)).toBe(false);
    expect(isLobbyPlayable({ ...live, hiddenAt: now }, now)).toBe(false);
    expect(isLobbyPlayable({ ...live, ownerUserId: null }, now)).toBe(false);
    expect(isLobbyPlayable({ ...live, readyAt: null }, now)).toBe(false);
  });

  it("lasts 30 days", () => {
    expect(LOBBY_LIFETIME_MS).toBe(30 * 86_400_000);
  });
});
