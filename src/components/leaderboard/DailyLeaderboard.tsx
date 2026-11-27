import { formatDailyDate } from "@/components/daily/DailyIntroScreen";
import { ButtonLink, TextLink } from "@/components/ui/controls";
import { CAPS_LABEL, CARD, CARD_EMPTY, chipClass, joinClasses, type ChipTone } from "@/components/ui/styles";
import { LEADERBOARD_SIZE, UNKNOWN_PLAYER } from "@/game/leaderboard";
import type { LeaderboardEntry } from "@/game/types";

import { YourRank } from "./YourRank";

/** The shape `loadDailyLeaderboard` returns (src/server/leaderboard.ts). */
export type DailyLeaderboardProps = {
  board: {
    date: string;
    /** Cached for about a minute. */
    top: LeaderboardEntry[];
    players: number;
    /** Your entry and a fresh player count. */
    you: { entry: LeaderboardEntry; players: number } | null;
    loggedIn: boolean;
    topHidden?: boolean;
  };
};

/**
 * Your row in the top list: same rank and username (usernames are unique).
 * The top list carries no user ids, so this is the only way to match it. A
 * name that didn't decrypt is never "you": those all look alike.
 */
const isYou = (entry: LeaderboardEntry, you: LeaderboardEntry | null) =>
  you !== null && entry.username !== UNKNOWN_PLAYER && entry.rank === you.rank && entry.username === you.username;

/** The rank's tile (#183): first place in Meadow, second and third in Flash, the rest on paper. The number stays text. */
const rankTone = (rank: number): ChipTone => (rank === 1 ? "meadow" : rank <= 3 ? "flash" : "paper");

/** The column headings, in the small caps style. */
const TH = "py-2 font-mono text-xs font-bold tracking-wider uppercase";

/** An empty or not-yet state: dashed, centred. */
const EMPTY = joinClasses(CARD_EMPTY, "px-4 py-5 text-center text-zinc-700 dark:text-zinc-300");

/**
 * Today's daily leaderboard (#62): the top players, your own rank, and what to
 * do if you're not on it. Usernames only (`LeaderboardEntry`). No state, so
 * it renders on the server.
 */
export function DailyLeaderboard({ board }: DailyLeaderboardProps) {
  const { top, you, loggedIn, topHidden } = board;
  const mineEntry = you?.entry ?? null;
  // The top list is cached for about a minute; your entry and its count are
  // fresh. Prefer the fresh count, so it agrees with your rank.
  const players = you?.players ?? board.players;
  const youInTop = top.some((e) => isYou(e, mineEntry));
  // You finished in the top places, but the cached list doesn't have you yet.
  const listCatchingUp = mineEntry !== null && !youInTop && mineEntry.rank <= LEADERBOARD_SIZE;
  return (
    <div className="flex w-full max-w-md flex-col gap-4">
      <p className={joinClasses(CAPS_LABEL, "text-center")}>{formatDailyDate(board.date)}</p>
      {topHidden ? (
        <p className={EMPTY}>Log in to see today&apos;s board.</p>
      ) : top.length === 0 ? (
        you === null ? (
          <p className={EMPTY}>Nobody has finished today&apos;s daily yet.</p>
        ) : null
      ) : (
        <>
          <div className={joinClasses(CARD, "overflow-hidden px-4 pt-3 pb-1")}>
            <table className="w-full border-collapse text-left">
              <caption className="mb-1 text-left text-zinc-700 dark:text-zinc-300">Today&apos;s daily, top players</caption>
              <thead>
                <tr className="border-b border-zinc-300 text-zinc-600 dark:border-zinc-600 dark:text-zinc-300">
                  <th scope="col" className={`${TH} pr-4`}>
                    Rank
                  </th>
                  <th scope="col" className={`${TH} pr-4`}>
                    Player
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Score
                  </th>
                </tr>
              </thead>
              <tbody>
                {top.map((entry) => {
                  const mine = isYou(entry, mineEntry);
                  return (
                    <tr
                      key={`${entry.rank}-${entry.username}`}
                      aria-current={mine ? "true" : undefined}
                      className={
                        mine
                          ? // Your row, in Meadow: plum on soft Meadow in both modes.
                            "border-2 border-meadow-edge bg-meadow-soft font-semibold text-plum"
                          : "border-b border-zinc-200 last:border-b-0 dark:border-zinc-700"
                      }
                    >
                      <td className="py-2 pr-4 pl-1">
                        <span className={chipClass(rankTone(entry.rank), "min-w-9 justify-center font-mono tabular-nums")}>{entry.rank}</span>
                      </td>
                      <td className="py-2 pr-4 break-all">
                        {entry.username}
                        {mine ? " (you)" : null}
                      </td>
                      <td className="py-2 pr-1 text-right font-mono font-bold tabular-nums">{entry.score}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            {players === 1 ? "1 player" : `${players} players`} finished today&apos;s daily.
          </p>
        </>
      )}

      {mineEntry !== null && !youInTop ? (
        <YourRank rank={mineEntry.rank} players={players} score={mineEntry.score} catchingUp={listCatchingUp} />
      ) : null}
      {!loggedIn ? (
        <p className={EMPTY}>
          Only logged-in players are on the board. <TextLink href={`/login?next=${encodeURIComponent("/leaderboard")}`}>Log in</TextLink>{" "}
          before you play today&apos;s daily.
        </p>
      ) : you === null ? (
        <div className={joinClasses(EMPTY, "flex flex-col items-center gap-3")}>
          <p>You&apos;re not on today&apos;s board yet.</p>
          <ButtonLink href="/daily">Play today&apos;s daily</ButtonLink>
        </div>
      ) : null}
    </div>
  );
}
