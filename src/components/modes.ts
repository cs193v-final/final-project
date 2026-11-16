/** A way to play, as listed on the home screen's mode picker (#50). */
export type GameMode =
  | {
      id: string;
      title: string;
      description: string;
      status: "available";
      href: string;
      /** The link text, e.g. "Start practice". */
      cta: string;
    }
  | {
      id: string;
      title: string;
      description: string;
      /** Shown, but marked "Coming soon" and not a link, until its issue lands. */
      status: "coming-soon";
    };

/**
 * The modes, in the order the home screen lists them. When a mode is built,
 * switch it to `status: "available"` with its `href` and `cta`. Custom lobbies
 * (#67) are a stretch goal, so they aren't listed until they exist.
 */
export const MODES: readonly GameMode[] = [
  {
    id: "daily",
    title: "Daily challenge",
    description: "Five images from today's theme, the same for everyone.",
    status: "coming-soon", // #58
  },
  {
    id: "stanford",
    title: "Stanford",
    description: "Campus spots, flags and mascots.",
    status: "coming-soon", // #65
  },
  {
    id: "practice",
    title: "Practice",
    description: "Three sample images. Play as often as you like.",
    status: "available",
    href: "/play",
    cta: "Start practice",
  },
  {
    id: "leaderboard",
    title: "Leaderboard",
    description: "Today's top scores.",
    status: "coming-soon", // #62
  },
];
