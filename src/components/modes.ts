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
 * The ways to play, in the order the home screen lists them. When a mode is
 * built, switch it to `status: "available"` with its `href` and `cta`. Custom
 * lobbies (#67) are a stretch goal, so they aren't listed until they exist.
 *
 * The leaderboard isn't here: you don't play it, so it isn't a mode (Joseph's
 * review of #71). The home screen mentions it separately until #62 adds it,
 * e.g. as a header link.
 */
export const MODES: readonly GameMode[] = [
  {
    id: "daily",
    title: "Daily challenge",
    description: "Five images from today's theme, the same for everyone.",
    status: "available", // #58
    href: "/daily",
    cta: "Play today's",
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
];
