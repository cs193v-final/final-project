"use client";

import { PracticeGame, type PracticeGameProps } from "./PracticeGame";

const stanfordHref = (gameId: string) => `/stanford?game=${encodeURIComponent(gameId)}`;

/**
 * Stanford mode's game (#65): the practice game with its own URL
 * (`/stanford?game=<id>`, so a refresh resumes it) and final heading. A client
 * component because those are functions, which a Server Component can't pass.
 */
export function StanfordGame(props: Pick<PracticeGameProps, "initial" | "start" | "act" | "get">) {
  return <PracticeGame {...props} gameHref={stanfordHref} finishedTitle="Stanford complete" />;
}
