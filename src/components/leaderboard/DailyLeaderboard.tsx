import { ButtonLink, TextLink } from "@/components/ui/controls";
import { LEADERBOARD_SIZE, UNKNOWN_PLAYER } from "@/game/leaderboard";
import type { LeaderboardEntry } from "@/game/types";

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
      {topHidden ? (
        <p className="text-center text-zinc-700 dark:text-zinc-300">Log in to see today&apos;s board.</p>
      ) : top.length === 0 ? (
        you === null ? (
          <p className="text-center text-zinc-700 dark:text-zinc-300">Nobody has finished today&apos;s daily yet.</p>
        ) : null
      ) : (
        <>
          <table className="w-full border-collapse text-left">
            <caption className="mb-2 text-left text-zinc-700 dark:text-zinc-300">Today&apos;s daily, top players</caption>
            <thead>
              <tr className="border-b border-zinc-300 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                <th scope="col" className="py-2 pr-4 font-medium">
                  Rank
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Player
                </th>
                <th scope="col" className="py-2 text-right font-medium">
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
                    className={`border-b border-zinc-200 dark:border-zinc-800 ${mine ? "bg-zinc-100 font-semibold dark:bg-zinc-900" : ""}`}
                  >
                    <td className="py-2 pr-4 tabular-nums">{entry.rank}</td>
                    <td className="py-2 pr-4 break-all">
                      {entry.username}
                      {mine ? " (you)" : null}
                    </td>
                    <td className="py-2 text-right tabular-nums">{entry.score}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {players === 1 ? "1 player" : `${players} players`} finished today&apos;s daily.
          </p>
        </>
      )}

      {mineEntry !== null && !youInTop ? (
        <p className="text-zinc-700 dark:text-zinc-300">
          <strong>Your rank:</strong> {mineEntry.rank} of {players}, with {mineEntry.score} {mineEntry.score === 1 ? "point" : "points"}.
          {listCatchingUp ? " The list updates within a minute." : null}
        </p>
      ) : null}
      {!loggedIn ? (
        <p className="text-zinc-700 dark:text-zinc-300">
          Only logged-in players are on the board. <TextLink href={`/login?next=${encodeURIComponent("/leaderboard")}`}>Log in</TextLink>{" "}
          before you play today&apos;s daily.
        </p>
      ) : you === null ? (
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-zinc-700 dark:text-zinc-300">You&apos;re not on today&apos;s board yet.</p>
          <ButtonLink href="/daily">Play today&apos;s daily</ButtonLink>
        </div>
      ) : null}
    </div>
  );
}
