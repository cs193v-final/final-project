// Who is logged in. Server-only.
//
// #77 left this as a stub that always returned null; accounts (#53) fill it
// in. src/server/owner.ts calls it, so a logged-in player's games are owned by
// `{ userId }`, and anonymous players keep the owner cookie. A game started
// anonymously stays anonymous: logging in doesn't claim it, so a daily played
// in a private window can't be moved onto an account's leaderboard (#58, #62).
import "server-only";

export { getCurrentUser } from "@/auth/session";
