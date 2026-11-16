import { describe, expect, it, vi } from "vitest";
import { runGameCall } from "./game-result.ts";
import { GameConflictError, GameNotFoundError, InvalidGameActionError } from "./server-game.ts";
import type { GameView } from "./types.ts";

const VIEW: GameView = {
  gameId: "g1",
  pack: { id: "pk", kind: "practice", title: "Practice", theme: "Mixed" },
  round: null,
  results: [],
  total: 0,
  finished: true,
};

describe("runGameCall", () => {
  it("returns the view when the call succeeds", async () => {
    expect(await runGameCall(async () => VIEW)).toEqual({ ok: true, view: VIEW });
  });

  it("maps not found / not yours and invalid actions to codes, without messages", async () => {
    const log = vi.fn();
    expect(await runGameCall(() => Promise.reject(new GameNotFoundError()), log)).toEqual({ ok: false, error: "not-found" });
    expect(await runGameCall(() => Promise.reject(new InvalidGameActionError("unknown type")), log)).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(log).not.toHaveBeenCalled();
  });

  it("retries once after a conflict, re-running the call (which re-reads the game)", async () => {
    const call = vi.fn<() => Promise<GameView>>().mockRejectedValueOnce(new GameConflictError("g1")).mockResolvedValue(VIEW);
    expect(await runGameCall(call)).toEqual({ ok: true, view: VIEW });
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("reports a conflict if the retry loses too", async () => {
    const call = vi.fn<() => Promise<GameView>>().mockRejectedValue(new GameConflictError("g1"));
    expect(await runGameCall(call)).toEqual({ ok: false, error: "conflict" });
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("logs anything else on the server and returns only `unavailable`", async () => {
    const log = vi.fn();
    const secret = new Error("connection to postgresql://USER:PASSWORD@host failed");
    const result = await runGameCall(() => Promise.reject(secret), log);
    expect(result).toEqual({ ok: false, error: "unavailable" });
    expect(log).toHaveBeenCalledWith(secret);
  });
});
