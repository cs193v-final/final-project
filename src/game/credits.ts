// Photo credits (#239): the shape the database returns and the page shows.
import type { Puzzle } from "./types.ts";

/** One past daily's photos, in play order. No ids, answers or images. */
export type DailyCredits = { date: string; title: string; credits: Puzzle["credit"][] };
