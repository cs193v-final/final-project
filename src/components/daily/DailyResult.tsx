"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { resetLabel } from "@/components/daily/DailyIntroScreen";
import { StreakNote } from "@/components/daily/StreakNote";
import { Button, ButtonLink, SectionHeading, TextLink } from "@/components/ui/controls";
import { joinClasses, TEXT_INPUT } from "@/components/ui/styles";
import type { DailyIntro } from "@/game/daily";
import { DEFAULT_DAILY_RESET } from "@/game/daily-date";
import { betterThanPercent, formatCountdown, nextChallengeAt, shareText, type DailyStats } from "@/game/daily-result";
import type { StreakSummary } from "@/game/streak";
import type { GameView } from "@/game/types";
import { GAME_NAME } from "@/site";

export type DailyResultProps = {
  intro: DailyIntro;
  view: GameView;
  /** The Server Action that returns this player's stats for a day (or null until there are any). */
  loadStats: (date: string) => Promise<DailyStats | null>;
  /**
   * The player's streak counting this day (#63), from the server: `null` when
   * logged out, left out when it couldn't be loaded (then nothing is shown).
   */
  streak?: StreakSummary | null;
  /** For tests: the clock and the share/copy functions. */
  now?: () => Date;
  share?: (text: string) => Promise<"shared" | "copied">;
};

/**
 * The native share sheet where there is one (phones), else the clipboard. If
 * the share sheet refuses (desktop Chrome has one but may say NotAllowedError
 * or InvalidStateError, e.g. on a second tap), fall back to the clipboard too
 * (review of #121). Closing the sheet (AbortError) is passed on, not a failure.
 */
async function defaultShare(text: string): Promise<"shared" | "copied"> {
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ text });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
    }
  }
  await navigator.clipboard.writeText(text);
  return "copied";
}

/**
 * A clock that `useSyncExternalStore` can read: null until subscribed, then
 * the time every 30 s. It holds its own time function, which `setNow` swaps,
 * so a new function each render never restarts it (review of #121).
 */
function createClock() {
  let now: () => Date = () => new Date();
  let time: Date | null = null;
  let notify: (() => void) | null = null;
  return {
    setNow(fn: () => Date) {
      now = fn;
      // Re-read right away when already ticking, so the order of the first
      // tick and this call doesn't matter.
      if (notify) {
        time = now();
        notify();
      }
    },
    subscribe(onChange: () => void) {
      notify = onChange;
      const tick = () => {
        time = now();
        onChange();
      };
      queueMicrotask(tick);
      const id = window.setInterval(tick, 30_000);
      return () => {
        window.clearInterval(id);
        notify = null;
      };
    },
    get: () => time,
  };
}

/** The time, updated every 30 s. `null` on the server and in the first client render, so they agree. */
function useNow(now: () => Date): Date | null {
  const [clock] = useState(createClock);
  useEffect(() => clock.setNow(now), [clock, now]);
  return useSyncExternalStore(clock.subscribe, clock.get, () => null);
}

const systemNow = () => new Date();

/**
 * Under the daily's final score (#58): when the next challenge starts, a
 * spoiler-free Share button, a way home, the player's daily streak (#63), and
 * how the player did on each image against everyone else who finished today
 * ("better than 62% of players").
 */
export function DailyResult({ intro, view, loadStats, streak, now = systemNow, share = defaultShare }: DailyResultProps) {
  const time = useNow(now);
  const [stats, setStats] = useState<DailyStats | null | "loading">("loading");
  const [shareStatus, setShareStatus] = useState<"idle" | "shared" | "copied" | "failed">("idle");

  useEffect(() => {
    let live = true;
    loadStats(intro.date)
      .then((s) => live && setStats(s))
      .catch(() => live && setStats(null));
    return () => {
      live = false;
    };
  }, [loadStats, intro.date]);

  const text = shareText({
    gameName: GAME_NAME,
    date: intro.date,
    theme: intro.pack?.theme ?? "",
    rounds: view.results,
    revealSeconds: view.scoring.revealSeconds,
    total: view.total,
    // The game's own scoring (#64): each round was worth maxPoints at most.
    maxTotal: view.scoring.maxPoints * view.results.length,
    ...(typeof window === "undefined" ? {} : { url: `${window.location.origin}/daily` }),
  });

  async function onShare() {
    try {
      setShareStatus(await share(text));
    } catch (error) {
      // Closing the share sheet is not a failure.
      if (error instanceof DOMException && error.name === "AbortError") return;
      setShareStatus("failed");
    }
  }

  // When the next daily starts, from the day that was played: computed once.
  const next = useMemo(() => nextChallengeAt(intro.date, DEFAULT_DAILY_RESET), [intro.date]);
  const ready = time !== null && time.getTime() >= next.getTime();

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-5 text-center">
      <p className="text-zinc-700 dark:text-zinc-300">
        That&apos;s today&apos;s challenge.{" "}
        {ready ? (
          <>
            A new challenge is ready. <TextLink href="/daily">Play it</TextLink>
          </>
        ) : time !== null ? (
          <>
            The next one starts in <strong>{formatCountdown(next.getTime() - time.getTime())}</strong>.
          </>
        ) : (
          <>A new one starts at {resetLabel()}.</>
        )}
      </p>

      {streak === undefined ? null : <StreakNote streak={streak} where="result" />}

      <div className="flex flex-wrap justify-center gap-3">
        <Button onClick={() => void onShare()}>Share result</Button>
        <ButtonLink href="/leaderboard" variant="secondary">
          Leaderboard
        </ButtonLink>
        <ButtonLink href="/" variant="secondary">
          Home
        </ButtonLink>
      </div>
      <p role="status" className="min-h-5 text-sm text-zinc-700 dark:text-zinc-300">
        {shareStatus === "copied" ? "Copied to the clipboard, with no answers in it." : null}
        {shareStatus === "shared" ? "Shared." : null}
        {shareStatus === "failed" ? "Couldn't share. Copy this instead:" : null}
      </p>
      {shareStatus === "failed" ? (
        <textarea
          readOnly
          aria-label="Your result to copy"
          value={text}
          rows={3}
          // The shared text box style (#89, #183); a textarea, so not TextInput.
          className={joinClasses(TEXT_INPUT, "w-full font-mono text-sm")}
        />
      ) : null}

      <section aria-labelledby="daily-stats" className="w-full text-left">
        <SectionHeading id="daily-stats">How you did on each image</SectionHeading>
        <Stats stats={stats} view={view} />
      </section>
    </div>
  );
}

function Stats({ stats, view }: { stats: DailyStats | null | "loading"; view: GameView }) {
  if (stats === "loading") return <p className="text-zinc-600 dark:text-zinc-400">Loading how everyone else did…</p>;
  if (stats === null) return <p className="text-zinc-600 dark:text-zinc-400">Stats aren&apos;t available right now.</p>;
  if (stats.others === 0) {
    return <p className="text-zinc-700 dark:text-zinc-300">You&apos;re the first to finish today. Check back later to see how you compare.</p>;
  }
  const overall = betterThanPercent(stats.beatenTotal, stats.others);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-zinc-700 dark:text-zinc-300">
        Overall you did better than <strong>{overall}%</strong> of the {stats.others}{" "}
        {stats.others === 1 ? "other player" : "other players"} who finished today.
      </p>
      <ol className="flex flex-col gap-2">
        {view.results.map((round, i) => {
          const stat = stats.rounds.find((r) => r.position === i + 1);
          const pct = stat ? betterThanPercent(stat.beaten, stat.others) : null;
          return (
            <li key={round.puzzleId} className="flex justify-between gap-3 rounded-lg bg-zinc-100 px-4 py-3 dark:bg-zinc-900">
              <span>Image {i + 1}</span>
              <span>{pct === null ? "No one to compare with yet" : `Better than ${pct}% of players`}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
