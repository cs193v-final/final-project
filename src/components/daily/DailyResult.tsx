"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { resetLabel } from "@/components/daily/DailyIntroScreen";
import { Button, ButtonLink, SectionHeading } from "@/components/ui/controls";
import type { DailyIntro } from "@/game/daily";
import { betterThanPercent, formatCountdown, nextResetAt, shareText, type DailyStats } from "@/game/daily-result";
import { SCORING_CONFIG } from "@/game/scoring-config";
import type { GameView } from "@/game/types";
import { GAME_NAME } from "@/site";

export type DailyResultProps = {
  intro: DailyIntro;
  view: GameView;
  /** The Server Action that returns this player's stats (or null until there are any). */
  loadStats: () => Promise<DailyStats | null>;
  /** For tests: the clock and the share/copy functions. */
  now?: () => Date;
  share?: (text: string) => Promise<"shared" | "copied">;
};

/** Native share sheet where there is one (phones), else the clipboard. */
async function defaultShare(text: string): Promise<"shared" | "copied"> {
  if (typeof navigator.share === "function") {
    await navigator.share({ text });
    return "shared";
  }
  await navigator.clipboard.writeText(text);
  return "copied";
}

/** A clock that `useSyncExternalStore` can read: null until subscribed, then the time every 30 s. */
function createClock(now: () => Date) {
  let time: Date | null = null;
  return {
    subscribe(onChange: () => void) {
      const tick = () => {
        time = now();
        onChange();
      };
      queueMicrotask(tick);
      const id = window.setInterval(tick, 30_000);
      return () => window.clearInterval(id);
    },
    get: () => time,
  };
}

/** The time, updated every 30 s. `null` on the server and in the first client render, so they agree. */
function useNow(now: () => Date): Date | null {
  const clock = useMemo(() => createClock(now), [now]);
  return useSyncExternalStore(clock.subscribe, clock.get, () => null);
}

const systemNow = () => new Date();

/**
 * Under the daily's final score (#58): when the next challenge starts, a
 * spoiler-free Share button, a way home, and how the player did on each image
 * against everyone else who finished today ("better than 62% of players").
 */
export function DailyResult({ intro, view, loadStats, now = systemNow, share = defaultShare }: DailyResultProps) {
  const time = useNow(now);
  const [stats, setStats] = useState<DailyStats | null | "loading">("loading");
  const [shareStatus, setShareStatus] = useState<"idle" | "shared" | "copied" | "failed">("idle");

  useEffect(() => {
    let live = true;
    loadStats()
      .then((s) => live && setStats(s))
      .catch(() => live && setStats(null));
    return () => {
      live = false;
    };
  }, [loadStats]);

  const text = shareText({
    gameName: GAME_NAME,
    date: intro.date,
    theme: intro.pack?.theme ?? "",
    rounds: view.results,
    total: view.total,
    maxTotal: SCORING_CONFIG.basePoints * view.results.length,
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

  const next = time ? nextResetAt(time, intro.reset) : null;
  const ready = next !== null && time !== null && next.getTime() <= time.getTime();

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-5 text-center">
      <p className="text-zinc-700 dark:text-zinc-300">
        That&apos;s today&apos;s challenge.{" "}
        {next && time && !ready ? (
          <>
            The next one starts in <strong>{formatCountdown(next.getTime() - time.getTime())}</strong>.
          </>
        ) : (
          <>A new one starts at {resetLabel(intro.reset)}.</>
        )}
      </p>

      <div className="flex flex-wrap justify-center gap-3">
        <Button onClick={() => void onShare()}>Share result</Button>
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
          className="w-full rounded-md border border-zinc-400 p-2 font-mono text-sm dark:border-zinc-500 dark:bg-zinc-900"
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
