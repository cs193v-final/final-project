// Stanford mode on the server (#65). Server-only: it reads the database.
//
// One fixed pack (src/db/stanford.ts), played like practice: as often as you
// like, with the same reuse rule and the same rate limits (#85). Moves and
// reloads go through /play's Server Actions (`actOnGame`, `loadGame`), which
// are rate-limited per owner and per IP too.
import "server-only";

import { cacheLife } from "next/cache";

import { getDb } from "@/db";
import { scoringFromStored } from "@/db/scoring";
import { getStanfordIntro, getStanfordPack, type StanfordIntro } from "@/db/stanford";
import { runGameCall, type GameResult } from "@/game/game-result";

import { requestIpHash, startOrReuseGame } from "./games";
import { checkStartLimits } from "./limits";
import { currentOrNewOwner } from "./owner";

/**
 * The Stanford intro (title, theme, number of images), the same for everyone,
 * so it's cached like the daily intro: reloading /stanford in a loop doesn't
 * query the database each time. "minutes": a pack seeded later shows up
 * within about a minute. Only a database error is thrown, and isn't cached.
 */
export async function loadStanfordIntro(): Promise<StanfordIntro> {
  "use cache";
  cacheLife("minutes");
  return getStanfordIntro(getDb());
}

/**
 * Start a Stanford game for the current owner (creating the owner cookie if
 * needed), or resume an untouched one, like practice. Rate-limited per owner
 * and per IP before anything else is read (#85). No Stanford pack loaded:
 * `unavailable` (the page only offers a game once the intro has a pack). A
 * pack that can't be played is logged and `unavailable` too.
 */
export async function startStanfordGame(): Promise<GameResult> {
  return runGameCall(async () => {
    const owner = await currentOrNewOwner();
    const db = getDb();
    await checkStartLimits(db, owner, await requestIpHash(), new Date());
    const pack = await getStanfordPack(db);
    if (pack === null) throw new Error("Stanford mode: no Stanford pack is loaded");
    // Its own scoring (#64) when it has one, checked like any stored override.
    return startOrReuseGame(db, owner, pack, () => scoringFromStored(pack.id, pack.scoring ?? null));
  });
}
