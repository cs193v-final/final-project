"use server";

// Server Actions for custom lobbies (#67), for the create-a-round screen and
// the lobby page (#68). Each is a public POST endpoint, so every argument is
// untrusted and checked in src/server/lobbies.ts; the user and owner come from
// cookies, never from the client. Photos are uploaded first, one per request,
// to `POST /api/lobby-uploads` (a Server Action body is capped at 1 MB).
//
// Moves in a lobby game use /play's `actAction` and `getGameAction`, like the daily.

import type { GameResult } from "@/game/game-result";
import type { LobbyRoundInput } from "@/game/lobby";
import {
  createLobbyForUser,
  deleteMyLobby,
  joinLobby,
  lobbyLeaderboard,
  myLobbies,
  reportLobby,
  startLobbyGame,
} from "@/server/lobbies";

/** Create a lobby from 3-5 uploaded photos. Login required. Returns the share code once. */
export async function createLobbyAction(rounds: LobbyRoundInput[]) {
  return createLobbyForUser(rounds);
}

/** Look up a lobby by its code (as typed): how many photos and until when. */
export async function joinLobbyAction(code: string) {
  return joinLobby(code);
}

/** Start or resume the player's game of a lobby. */
export async function startLobbyGameAction(code: string): Promise<GameResult> {
  return startLobbyGame(code);
}

/** A lobby's leaderboard (logged-in players' first finished games) and your entry. */
export async function lobbyLeaderboardAction(code: string) {
  return lobbyLeaderboard(code);
}

/** The current user's own lobbies, with their codes. */
export async function myLobbiesAction() {
  return myLobbies();
}

/** Delete one of your lobbies (its photos, answers and games go with it). */
export async function deleteLobbyAction(lobbyId: string) {
  return deleteMyLobby(lobbyId);
}

/** Report a lobby. Hidden from everyone after a few distinct reports. */
export async function reportLobbyAction(code: string) {
  return reportLobby(code);
}
