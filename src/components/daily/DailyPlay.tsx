"use client";

import { useState } from "react";

import { DailyIntroScreen } from "@/components/daily/DailyIntroScreen";
import { DailyResult } from "@/components/daily/DailyResult";
import { PracticeGame } from "@/components/game/PracticeGame";
import { Button } from "@/components/ui/controls";
import type { DailyIntro } from "@/game/daily";
import type { DailyStats } from "@/game/daily-result";
import type { GameResult } from "@/game/game-result";
import type { GameAction } from "@/game/types";

export type DailyPlayProps = {
  /** Today's game if the player already started it (resume or result), else null. */
  initial: GameResult | null;
  start: () => Promise<GameResult>;
  act: (gameId: string, action: GameAction) => Promise<GameResult>;
  get: (gameId: string) => Promise<GameResult>;
  /** Today's intro (a day with a pack: the page shows the no-challenge screen otherwise). */
  intro: DailyIntro;
  /** This player's per-image stats once they've finished (the Server Action). */
  loadStats: () => Promise<DailyStats | null>;
};

/**
 * The daily challenge (#58): the intro with a Start button, then the game.
 * A player who already started today goes straight to their game (resumed),
 * or to their result once it's finished. One game per player per day, so
 * there's no Play again.
 */
export function DailyPlay({ initial, start, act, get, intro, loadStats }: DailyPlayProps) {
  const [playing, setPlaying] = useState(initial !== null);
  if (!playing) {
    return (
      <DailyIntroScreen intro={intro} start={<Button onClick={() => setPlaying(true)}>Start today&apos;s challenge</Button>} />
    );
  }
  return (
    <PracticeGame
      initial={initial}
      start={start}
      act={act}
      get={get}
      gameHref={() => "/daily"}
      replay={false}
      afterFinish={(view) => <DailyResult intro={intro} view={view} loadStats={loadStats} />}
    />
  );
}
