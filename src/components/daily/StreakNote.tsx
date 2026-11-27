// The daily streak (#63), on the home screen and under the daily result. Just
// the display: the server counts the streak (src/server/streaks.ts) and the
// page passes it in. No state, so it works in Server and Client Components.
import { loginPath } from "@/auth/next-path";
import { TextLink } from "@/components/ui/controls";
import type { StreakSummary } from "@/game/streak";

export type StreakNoteProps = {
  /** The player's streak, or `null` when logged out (only accounts have streaks, #58). */
  streak: StreakSummary | null;
  /** The home screen invites a visit to today's daily; the result says what's next. */
  where: "home" | "result";
};

const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/**
 * One short line, in words, never a colour or an icon alone (#49). Logged
 * out, the home screen shows nothing, and the result says how to get a streak.
 */
export function StreakNote({ streak, where }: StreakNoteProps) {
  if (streak === null) {
    if (where === "home") return null;
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Want a daily streak? <TextLink href={loginPath("/daily")}>Log in</TextLink> before you play tomorrow. Games
        played logged out don&apos;t count.
      </p>
    );
  }

  const { current, longest, playedToday } = streak;
  const best = longest > current ? <> Your best is {days(longest)}.</> : null;
  return (
    <section
      aria-label="Daily streak"
      // Text size matches TextLink (text-sm), so the link doesn't shrink mid-sentence.
      className="w-full max-w-md rounded-lg bg-zinc-100 px-4 py-3 text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
    >
      <p>
        {current === 0 ? (
          <>
            No daily streak yet.{" "}
            <TodayLink where={where}>Play today&apos;s daily</TodayLink> to start one.
          </>
        ) : (
          <>
            Daily streak: <strong className="text-zinc-900 dark:text-zinc-100">{days(current)}</strong>.{" "}
            {playedToday ? (
              <>Come back tomorrow to make it {current + 1}.</>
            ) : (
              <>
                <TodayLink where={where}>Play today&apos;s daily</TodayLink> to keep it going.
              </>
            )}
          </>
        )}
        {best}
      </p>
    </section>
  );
}

/** A link on the home screen; plain words on /daily itself, where the daily already is. */
function TodayLink({ where, children }: { where: StreakNoteProps["where"]; children: string }) {
  return where === "home" ? <TextLink href="/daily">{children}</TextLink> : <>{children}</>;
}
