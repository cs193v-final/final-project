"use client";

import { useRef, useState } from "react";

import { DailyIntroScreen } from "@/components/daily/DailyIntroScreen";
import { DailyResult } from "@/components/daily/DailyResult";
import { PracticeGame } from "@/components/game/PracticeGame";
import { Button } from "@/components/ui/controls";
import type { DailyIntro } from "@/game/daily";
import type { DailyStats } from "@/game/daily-result";
import type { GameResult } from "@/game/game-result";
import type { GameAction } from "@/game/types";

/** What starting the daily can return: a game, or why not (src/server/daily.ts). */
export type DailyStart = GameResult | { ok: false; error: "day-over" | "no-daily" };

export type DailyPlayProps = {
  /** Today's game if the player already started it (resume or result), else null. */
  initial: GameResult | null;
  /** Starts (or resumes) the daily for the day this intro shows. */
  start: (date: string) => Promise<DailyStart>;
  act: (gameId: string, action: GameAction, revision: number) => Promise<GameResult>;
  get: (gameId: string) => Promise<GameResult>;
  /** Today's intro (a day with a pack: the page shows the no-challenge screen otherwise). */
  intro: DailyIntro;
  /** This player's per-image stats for a day once they've finished it (the Server Action). */
  loadStats: (date: string) => Promise<DailyStats | null>;
};

const NOT_STARTED: Record<"day-over" | "no-daily", string> = {
  "day-over": "A new daily challenge has started since you opened this page.",
  "no-daily": "There's no daily challenge scheduled right now.",
};

/**
 * The daily challenge (#58): the intro with a Start button, then the game.
 * Start asks the server for the day the intro showed, so a player who opened
 * the page before midnight doesn't silently play the next day's game. A
 * player who already started today goes straight to their game (resumed), or
 * to their result once it's finished. One game per player per day, so there's
 * no Play again.
 */
export function DailyPlay({ initial, start, act, get, intro, loadStats }: DailyPlayProps) {
  const [game, setGame] = useState<GameResult | null>(initial);
  const [notStarted, setNotStarted] = useState<"day-over" | "no-daily" | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  /**
   * Ask the server for the intro's day. "day-over" and "no-daily" switch this
   * screen to a message (below); anything else is a game result for the game
   * to show. Also the game's own retry, so a retry can't start the next day.
   */
  const startToday = async (): Promise<GameResult> => {
    const result = await start(intro.date);
    if (!result.ok && (result.error === "day-over" || result.error === "no-daily")) {
      setNotStarted(result.error);
      return { ok: false, error: "unavailable" }; // not shown: this screen switches to the message
    }
    return result as GameResult;
  };

  async function onStart() {
    if (inFlight.current) return; // a second click in the same tick
    inFlight.current = true;
    setPending(true);
    try {
      const result = await start(intro.date);
      if (!result.ok && (result.error === "day-over" || result.error === "no-daily")) setNotStarted(result.error);
      else setGame(result as GameResult);
    } catch {
      setGame({ ok: false, error: "unavailable" }); // offline, or the action is gone after a redeploy
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  if (notStarted !== null) {
    return (
      <section className="flex w-full max-w-md flex-col items-center gap-4 text-center">
        <p role="alert" className="text-zinc-700 dark:text-zinc-300">
          {NOT_STARTED[notStarted]}
        </p>
        <Button onClick={() => window.location.reload()}>See today&apos;s challenge</Button>
      </section>
    );
  }

  if (game === null) {
    return (
      <DailyIntroScreen
        intro={intro}
        start={
          <Button onClick={() => void onStart()} disabled={pending}>
            Start today&apos;s challenge
          </Button>
        }
      />
    );
  }
  return (
    <PracticeGame
      initial={game}
      start={startToday}
      act={act}
      get={get}
      gameHref={() => "/daily"}
      replay={false}
      // One daily per player per day, so a lost one can't be restarted (#164).
      // TODO(Joseph, #58): or let the server replace the unreadable row.
      lostGameMessage="Today's game can't be loaded anymore. That's a problem on our side, not yours. A new daily starts tomorrow; meanwhile you can play practice."
      afterFinish={(view) => <DailyResult intro={intro} view={view} loadStats={loadStats} />}
    />
  );
}
