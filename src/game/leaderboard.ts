// Leaderboard constants (#62), shared by the query (src/db/leaderboard.ts) and
// the screen (src/components/leaderboard/), which may not import the database.

/** How many players the board shows. */
export const LEADERBOARD_SIZE = 10;

/** Shown for a username that doesn't decrypt (e.g. a tier's key was changed). */
export const UNKNOWN_PLAYER = "Unknown player";
