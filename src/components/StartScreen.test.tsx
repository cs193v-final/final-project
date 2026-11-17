import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SCORING_CONFIG } from "@/game/scoring-config";
import type { ScoringConfig } from "@/game/types";
import { HOW_TO_PLAY, howToPlay, StartScreen } from "./StartScreen.tsx";

const html = renderToStaticMarkup(<StartScreen />);

describe("StartScreen", () => {
  it("shows the game name as the page heading", () => {
    expect(html).toMatch(/<h1[^>]*>Zoom Out<\/h1>/u);
  });

  it("says what the game is in one short line under the name (#144, from user test #90)", () => {
    expect(html).toMatch(/<\/h1><p[^>]*>Guess the picture\. The less you see, the more you score\.<\/p>/u);
    // The longer wording a tester found too wordy is gone.
    expect(html).not.toContain("tiny piece of it");
  });

  it("has a Start button that goes to the practice game", () => {
    expect(html).toMatch(/<a[^>]*href="\/play"[^>]*>Start practice<\/a>/u);
  });

  it("lists every how-to-play step, in order", () => {
    const positions = HOW_TO_PLAY.map((step) => html.indexOf(step.replace("'", "&#x27;")));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("explains what costs points and that you can skip", () => {
    const rules = HOW_TO_PLAY.join(" ");
    expect(rules).toMatch(/zoom costs/u);
    expect(rules).toMatch(/Wrong guesses cost/u);
    expect(rules).toMatch(/skip/u);
  });

  it("explains the point values once, from the scoring config (#146, from user test #90)", () => {
    const rules = HOW_TO_PLAY.join(" ");
    const { basePoints, revealPenalty, wrongGuessPenalty, minPoints, skipPoints } = SCORING_CONFIG;
    expect(rules).toContain(`scores up to ${basePoints} points`);
    expect(rules).toContain(`every zoom costs ${revealPenalty} points`);
    expect(rules).toContain(`Wrong guesses cost ${wrongGuessPenalty} points each`);
    expect(rules).toContain(`at least ${minPoints} points`);
    expect(rules).toContain(`for ${skipPoints} points`);
  });

  it("follows the config when the values change, so numbers live in one place (#64)", () => {
    const config: ScoringConfig = { basePoints: 50, revealPenalty: 5, wrongGuessPenalty: 1, minPoints: 2, skipPoints: 1 };
    const rules = howToPlay(config).join(" ");
    expect(rules).toContain("scores up to 50 points");
    expect(rules).toContain("every zoom costs 5 points");
    expect(rules).toContain("Wrong guesses cost 1 point each");
    expect(rules).toContain("at least 2 points");
    expect(rules).toContain("for 1 point.");
  });

  it("offers the mode picker before the how-to-play steps (#50)", () => {
    const picker = html.indexOf("Choose a mode");
    expect(picker).toBeGreaterThan(-1);
    expect(picker).toBeLessThan(html.indexOf("How to play"));
  });

  it("mentions the leaderboard as coming soon, after the mode picker and not as a link", () => {
    const note = html.indexOf("Coming soon: a daily leaderboard.");
    expect(note).toBeGreaterThan(html.indexOf("Choose a mode"));
    expect(note).toBeLessThan(html.indexOf("How to play"));
    expect(html).not.toMatch(/<a[^>]*>[^<]*leaderboard/iu);
  });

  it("labels the prototype as a placeholder for the daily game", () => {
    expect(html).toContain("Daily puzzles aren&#x27;t built yet");
  });
});
