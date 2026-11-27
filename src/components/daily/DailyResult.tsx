"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { resetLabel } from "@/components/daily/DailyIntroScreen";
import { StreakNote } from "@/components/daily/StreakNote";
import { ROW_IN_TIMING, useCountUp, usePrefersReducedMotion } from "@/components/game/motion";
import { Button, ButtonLink, SectionHeading, TextLink } from "@/components/ui/controls";
import { CAPS_LABEL, CARD, CARD_ROW, chipClass, joinClasses, TEXT_INPUT } from "@/components/ui/styles";
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

/** How long the overall figure takes to count up, and the gap between stats rows arriving (#283, as the final score). */
const COUNT_UP_MS = 900;
const ROW_STAGGER_MS = 70;

/**
 * A stats row arriving: it rises into place. Transform only, never a fade, so
 * an accessibility scan mid-animation sees the final colours (#291 review).
 */
const ROW_RISE: Keyframe[] = [{ transform: "translateY(6px)" }, { transform: "translateY(0)" }];

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
    total: view.total,
    // The game's own scoring (#64, #174): every image is worth basePoints at most,
    // including a skipped one (its breakdown's base is skipPoints, not the maximum).
    maxTotal: view.scoring.basePoints * view.results.length,
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
      <p className="text-zinc-700 dark:text-zinc-300">That&apos;s today&apos;s challenge.</p>

      <div data-next-daily className={joinClasses(CARD, "flex w-full flex-col items-center gap-1 px-4 py-3")}>
        <p className={CAPS_LABEL}>Next daily</p>
        {ready ? (
          <p className="text-zinc-700 dark:text-zinc-300">
            A new challenge is ready. <TextLink href="/daily">Play it</TextLink>
          </p>
        ) : time !== null ? (
          // The sentence is for screen readers; the big countdown says it at a glance.
          <p>
            <span className="sr-only">The next one starts in </span>
            <span className="font-mono text-2xl font-bold text-plum tabular-nums dark:text-zinc-50">
              {formatCountdown(next.getTime() - time.getTime())}
            </span>
            <span className="sr-only">.</span>
          </p>
        ) : (
          <p className="text-zinc-700 dark:text-zinc-300">A new one starts at {resetLabel()}.</p>
        )}
      </div>

      {streak === undefined ? null : <StreakNote streak={streak} where="result" />}

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button onClick={() => void onShare()} size="lg">
          Share result
        </Button>
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
  const overall = betterThanPercent(stats.beatenTotal, stats.others) ?? 0;
  return (
    <div className="flex flex-col gap-3">
      <Overall percent={overall} />
      <p className="text-center text-zinc-700 dark:text-zinc-300">
        Overall you did better than <strong>{overall}%</strong> of the {stats.others}{" "}
        {stats.others === 1 ? "other player" : "other players"} who finished today.
      </p>
      <StatRows stats={stats} view={view} />
    </div>
  );
}

/** The overall figure, big and counting up, like the final score's total (#183). Decorative: the sentence under it says it. */
function Overall({ percent }: { percent: number }) {
  const shown = useCountUp(percent, COUNT_UP_MS);
  return (
    <div aria-hidden="true" className="flex flex-col items-center gap-2">
      <span
        data-overall-count
        className="font-display text-6xl leading-none tracking-[-0.07em] text-emerald-700 tabular-nums dark:text-[#d6eea7]"
      >
        {shown}%
      </span>
      <span className={chipClass("meadow", "badge-pop")}>Overall</span>
    </div>
  );
}

/** One row per image, arriving one after another (#283); rows only move without reduced motion. */
function StatRows({ stats, view }: { stats: DailyStats; view: GameView }) {
  const list = useRef<HTMLOListElement>(null);
  const reduced = usePrefersReducedMotion();
  useEffect(() => {
    if (reduced) return;
    const items = Array.from(list.current?.children ?? []) as HTMLElement[];
    const animations = items.flatMap((item, i) =>
      typeof item.animate === "function" ? [item.animate(ROW_RISE, { ...ROW_IN_TIMING, delay: i * ROW_STAGGER_MS })] : [],
    );
    return () => animations.forEach((a) => a.cancel());
    // Once per showing of the stats.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <ol ref={list} className="flex flex-col gap-2">
      {view.results.map((round, i) => {
        const stat = stats.rounds.find((r) => r.position === i + 1);
        const pct = stat ? betterThanPercent(stat.beaten, stat.others) : null;
        return (
          <li key={round.puzzleId} className={joinClasses(CARD_ROW, "flex flex-col gap-2 px-4 py-3")}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium">Image {i + 1}</span>
              {pct === null ? (
                <span className="text-zinc-700 dark:text-zinc-300">No one to compare with yet</span>
              ) : (
                <span className="text-zinc-700 dark:text-zinc-300">
                  Better than <span className="font-mono font-bold text-plum tabular-nums dark:text-zinc-50">{pct}%</span> of players
                </span>
              )}
            </div>
            {pct === null ? null : (
              // Decorative: the figure above says it.
              <span aria-hidden="true" data-stat-bar className="block h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                <span className="block h-full rounded-full bg-meadow" style={{ width: `${pct}%` }} />
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
