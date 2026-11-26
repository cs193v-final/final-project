"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { GameError, GameResult } from "@/game/game-result";
import type { GameAction, GameView, Puzzle, PublicRound } from "@/game/types";
import { AiBadge } from "./AiBadge";
import { Confetti } from "./Confetti";
import { FinalScore } from "./FinalScore";
import { GuessPanel } from "./GuessPanel";
import { ImageViewer } from "./ImageViewer";
import { POP, POP_TIMING, useAnimateOn } from "./motion";
import { feedbackFor, finalScoreLabels, learnAnswer, NO_FEEDBACK, type Feedback, type KnownAnswers } from "./practice";
import { RoundValue, ScoreHeader } from "./LiveScore";
import { ZoomOutButton } from "./ZoomOutButton";
import { Button, ButtonLink } from "../ui/controls";

export type PracticeGameProps = {
  /** The game from the URL (`/play?game=<id>`), loaded on the server; null starts a new one. */
  initial: GameResult | null;
  /** Server Actions (src/app/play/actions.ts). Props, so tests can pass in-memory ones. */
  start: () => Promise<GameResult>;
  act: (gameId: string, action: GameAction, revision: number) => Promise<GameResult>;
  get: (gameId: string) => Promise<GameResult>;
  /** Where a started game lives, so a refresh resumes it. Default: `/play?game=<id>`. */
  gameHref?: (gameId: string) => string;
  /** Whether the final score offers Play again. The daily (#58) is one game per day: false, with `afterFinish`. */
  replay?: boolean;
  afterFinish?: ReactNode | ((view: GameView) => ReactNode);
  /**
   * For a mode that can't start over (the daily, one game per day): what to
   * say when this game can't be loaded anymore (`unreadable`, #164). Then
   * there's no "Start a new game", only a link to practice. Practice leaves it
   * out and offers a new game.
   */
  lostGameMessage?: string;
};

const playHref = (gameId: string) => `/play?game=${encodeURIComponent(gameId)}`;

const PROBLEMS: Record<GameError, string> = {
  "not-found": "We couldn't find that game. It may have been started in another browser.",
  invalid: "That didn't work. Please try again.",
  "guess-limit": "That's the most guesses one image allows. Zoom out or skip it to keep playing.",
  conflict: "This game was updated since you last saw it, so it was reloaded.",
  "rate-limited": "You're going faster than we allow right now. Please wait a while (up to an hour), then try again.",
  unavailable: "Couldn't reach the server. Check your connection and try again, or reload the page.",
  unreadable: "This game can't be loaded anymore. That's a problem on our side, not yours. Start a new one.",
};

/**
 * The practice game: the image viewer and Zoom out (#10, #11), guessing (#14),
 * the live and final score (#16), and answer feedback (#48). The game runs on
 * the server (#54): every move is a Server Action that returns a `GameView`,
 * and this component only renders that view. It never sees answers before a
 * round ends, and it doesn't score anything.
 */
export function PracticeGame({
  initial,
  start,
  act,
  get,
  gameHref = playHref,
  replay = true,
  afterFinish,
  lostGameMessage,
}: PracticeGameProps) {
  const [view, setView] = useState<GameView | null>(initial?.ok ? initial.view : null);
  // The latest view, updated as soon as a result arrives. `send` reads the
  // game id and revision from here rather than from `view`, which only
  // updates on the next render: a click in between would otherwise send the
  // old revision and get a false conflict (#107).
  const latest = useRef<GameView | null>(initial?.ok ? initial.view : null);
  const [problem, setProblem] = useState<GameError | null>(initial && !initial.ok ? initial.error : null);
  const [feedback, setFeedback] = useState<Feedback>(() =>
    initial?.ok ? feedbackFor(null, initial.view, NO_FEEDBACK) : NO_FEEDBACK,
  );
  const [answers, setAnswers] = useState<KnownAnswers>(() => (initial?.ok ? learnAnswer({}, initial.view) : {}));
  const startedOnMount = useRef(false);
  // One Server Action at a time. The ref ignores a second click in the same
  // tick (before React re-renders); `pending` marks the controls as disabled.
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  // False once the player has left /play (e.g. "← Home" while a game is
  // starting). Results that arrive after that are ignored, so they can't
  // rewrite the URL of the page the player is on now.
  const mounted = useRef(false);
  // True right after a guess made here solved the round, so the confetti and
  // the pop (#48) are for the player's own solve. A solved round that was
  // loaded (a refresh, or the reload after another tab changed the game)
  // isn't celebrated again.
  const [justSolved, setJustSolved] = useState(false);

  /**
   * Run one server round trip, unless one is already running. A Server Action
   * can also reject (offline, or "Failed to find Server Action" after a
   * redeploy); that shows `unavailable` with a way to retry instead of hanging.
   */
  async function exclusive(task: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      await task();
    } catch {
      if (mounted.current) setProblem("unavailable");
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  }

  function show(result: GameResult, action: GameAction | null) {
    if (!result.ok) {
      setProblem(result.error);
      return;
    }
    setProblem(null);
    setJustSolved(action?.type === "guess" && result.view.round?.state === "correct");
    latest.current = result.view;
    setView(result.view);
    setFeedback((previous) => feedbackFor(action, result.view, previous));
    setAnswers((known) => learnAnswer(known, result.view));
  }

  function newGame() {
    return exclusive(async () => {
      const result = await start();
      if (!mounted.current) return;
      if (result.ok) {
        setAnswers({});
        // Put the game in the URL, so a refresh resumes it (the page loads it with getGame).
        window.history.replaceState(null, "", gameHref(result.view.gameId));
      }
      show(result, null);
    });
  }

  function send(action: GameAction) {
    if (view === null || inFlight.current) return Promise.resolve();
    if (action.type === "guess" && action.guess.trim() === "") {
      // The server ignores blank guesses too; this just explains why.
      setFeedback({ kind: "empty" });
      return Promise.resolve();
    }
    return exclusive(async () => {
      const current = latest.current;
      if (current === null) return;
      const { gameId, revision } = current;
      const result = await act(gameId, action, revision);
      if (!mounted.current) return;
      if (!result.ok && result.error === "conflict") {
        // The game changed since this view (another tab, or a lost response), so this action wasn't applied.
        // Show the game as it is now and let the player decide again.
        const fresh = await get(gameId);
        if (!mounted.current) return;
        show(fresh, null);
        if (fresh.ok) setProblem("conflict");
        return;
      }
      show(result, action);
    });
  }

  // Set in its own effect, so React's development-mode mount → unmount →
  // mount leaves it true (and the one start below still counts).
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // No game in the URL: start one. The ref keeps React's development-mode
  // double effect from starting two.
  useEffect(() => {
    if (initial !== null || startedOnMount.current) return;
    startedOnMount.current = true;
    void newGame();
    // Only on mount: later renders get new props when the server re-renders the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The image a guess made here just solved, if any: it pops once (#48).
  // Called before the early returns below so the hooks run in the same order
  // every render.
  const solvedRound = justSolved && view?.round && !view.finished ? view.round.position : null;
  const imageBox = useAnimateOn<HTMLDivElement>(solvedRound, POP, POP_TIMING);

  // A lost game (#164) in a mode that can't start over gets that mode's message.
  const lost = problem === "unreadable" && lostGameMessage !== undefined;
  const message = problem === null ? null : lost ? lostGameMessage : PROBLEMS[problem];
  // What a lost game offers: a new one, or (one game per day) practice.
  const lostAction = lost ? (
    <ButtonLink href="/play">Play practice</ButtonLink>
  ) : (
    <Button disabled={pending} onClick={() => void newGame()}>
      Start a new game
    </Button>
  );

  const alert = problem && view ? (
    <div className="flex flex-col items-center gap-2">
      <p role="alert" className="text-center text-sm text-rose-700 dark:text-rose-400">
        {message}
      </p>
      {problem === "unreadable" ? lostAction : null}
      {problem === "unavailable" ? (
        // After a redeploy only a reload fixes "Failed to find Server Action".
        // Always underlined: it sits next to the message, and on a touch screen
        // there's no hover to show it can be pressed.
        <Button variant="quiet" onClick={() => window.location.reload()} className="text-sm underline">
          Reload the page
        </Button>
      ) : null}
    </div>
  ) : null;

  if (view === null) {
    if (problem === null) {
      return <p className="text-zinc-600 dark:text-zinc-400">Starting a new game…</p>;
    }
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <p role="alert">{message}</p>
        {problem === "unreadable" ? (
          lostAction
        ) : (
          <Button disabled={pending} onClick={() => void newGame()}>
            {problem === "not-found" ? "Start a new game" : "Try again"}
          </Button>
        )}
      </div>
    );
  }

  const round = view.round;
  if (view.finished || round === null) {
    return (
      <div className="flex w-full flex-col items-center gap-3">
        {alert}
        <FinalScore
          puzzles={finalScoreLabels(view, answers)}
          score={{ rounds: view.results, total: view.total }}
          beatAi={view.beatAi}
          {...(replay ? { onPlayAgain: () => void newGame() } : {})}
          after={typeof afterFinish === "function" ? afterFinish(view) : afterFinish}
        />
      </div>
    );
  }

  const roundView = {
    state: round.state,
    revealLevel: round.revealLevel,
    maxRevealLevel: round.levelCount - 1,
    wrongGuesses: round.wrongGuesses,
  };
  // Once this round has ended, its result is the last one scored.
  const roundResult = round.state === "playing" ? undefined : view.results[round.position - 1];

  return (
    <div className="flex w-full flex-col items-center gap-6" aria-busy={pending}>
      <ScoreHeader index={round.position - 1} count={round.puzzleCount} total={view.total} />

      <div className="flex w-full max-w-md flex-col items-center gap-3">
        <div ref={imageBox} data-image-box className="relative flex w-full justify-center">
          {/* key: each image starts at its own tight crop, with no zoom animation from the last one. */}
          <ImageViewer
            key={round.position}
            puzzle={{ imageUrl: round.imageSrc, reveal: cropFor(round) }}
            revealLevel={round.revealLevel}
            showFull={round.state !== "playing"}
          />
          {/* Mounts fresh each time a guess here solves an image ("Next image" unmounts it), so it plays once per solve. */}
          {solvedRound !== null && <Confetti />}
        </div>
        {round.state === "playing" ? (
          <ZoomOutButton round={roundView} pending={pending} onZoomOut={() => void send({ type: "reveal" })} />
        ) : round.credit ? (
          <Credit credit={round.credit} />
        ) : null}
        <RoundValue round={roundView} result={roundResult} pointsNow={round.pointsAvailable} />
        <AiBadge round={round} result={roundResult} />
      </div>

      <GuessPanel
        key={round.position}
        round={roundView}
        feedback={feedback}
        pending={pending}
        isLastRound={round.position === round.puzzleCount}
        onGuess={(guess) => void send({ type: "guess", guess })}
        onSkip={() => void send({ type: "skip" })}
        onNext={() => void send({ type: "next" })}
      />
      {alert}
    </div>
  );
}

/**
 * How the viewer crops `imageSrc`. TODO(#57): once the server sends a
 * per-level image, show it as is and drop `PublicRound.reveal`.
 */
function cropFor(round: PublicRound): Puzzle["reveal"] {
  return round.reveal ?? { focus: { x: 0.5, y: 0.5 }, zoomLevels: Array.from({ length: round.levelCount }, () => 1) };
}

/**
 * Image source and license, required by CC BY-SA. The server sends it only
 * after the round, because the source and file name often give the answer away.
 */
function Credit({ credit }: { credit: Puzzle["credit"] }) {
  const source = credit.url ? (
    <a href={credit.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
      {credit.source}
    </a>
  ) : (
    credit.source
  );
  return (
    <p className="text-center text-xs text-zinc-600 dark:text-zinc-400">
      Photo: {source} ({credit.license})
    </p>
  );
}
