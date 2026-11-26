import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TIMED_SCORING_CONFIG } from "@/game/scoring-config";
import type { TimedScoringConfig } from "@/game/types";
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

  it("explains timed rounds: Start round, the draining score, the limit, and that wrong guesses are free (#255)", () => {
    const rules = HOW_TO_PLAY.join(" ");
    expect(rules).toMatch(/Start round/u);
    expect(rules).toMatch(/drops the longer you take/u);
    expect(rules).toMatch(/Wrong guesses cost nothing/u);
    expect(rules).not.toMatch(/zoom|skip/iu);
  });

  it("explains the point values once, from the scoring config (#146, from user test #90)", () => {
    const rules = HOW_TO_PLAY.join(" ");
    const { maxPoints, minPoints, revealSeconds, limitSeconds } = TIMED_SCORING_CONFIG;
    expect(rules).toContain(`scores ${maxPoints.toLocaleString("en-US")} points`);
    expect(rules).toContain(`clear (${revealSeconds} seconds), a correct guess still scores ${minPoints} points`);
    expect(rules).toContain(`After ${limitSeconds} seconds the round ends with 0`);
  });

  it("follows the config when the values change, so numbers live in one place (#64)", () => {
    const config: TimedScoringConfig = { maxPoints: 500, minPoints: 1, revealSeconds: 10, limitSeconds: 12, curve: 1 };
    const rules = howToPlay(config).join(" ");
    expect(rules).toContain("scores 500 points");
    expect(rules).toContain("clear (10 seconds), a correct guess still scores 1 point.");
    expect(rules).toContain("After 12 seconds");
  });

  it("shows the scoring it's given, e.g. the practice pack's override, not the default (#204)", () => {
    const override: TimedScoringConfig = { maxPoints: 3_000, minPoints: 40, revealSeconds: 20, limitSeconds: 24, curve: 2 };
    const page = renderToStaticMarkup(<StartScreen scoring={override} />);
    expect(page).toContain("scores 3,000 points");
    expect(page).toContain("still scores 40 points");
    expect(page).toContain("After 24 seconds");
    // None of the default values are left over.
    expect(page).not.toContain(`scores ${TIMED_SCORING_CONFIG.maxPoints.toLocaleString("en-US")} points`);
  });

  it("offers the mode picker before the how-to-play steps (#50)", () => {
    const picker = html.indexOf("Choose a mode");
    expect(picker).toBeGreaterThan(-1);
    expect(picker).toBeLessThan(html.indexOf("How to play"));
  });

  it("links to today's leaderboard after the mode picker, not as a mode card (#62)", () => {
    const link = html.indexOf("See today&#x27;s leaderboard");
    expect(link).toBeGreaterThan(html.indexOf("Choose a mode"));
    expect(link).toBeLessThan(html.indexOf("How to play"));
    expect(html).toMatch(/<a[^>]*href="\/leaderboard"[^>]*>See today&#x27;s leaderboard<\/a>/u);
    expect(html).not.toContain("Coming soon: a daily leaderboard");
  });

  it("shows the daily streak (#63) between the tagline and the mode picker, when given one", () => {
    const withStreak = renderToStaticMarkup(<StartScreen streak={<p>STREAK SLOT</p>} />);
    const slot = withStreak.indexOf("STREAK SLOT");
    expect(slot).toBeGreaterThan(withStreak.indexOf("Guess the picture."));
    expect(slot).toBeLessThan(withStreak.indexOf("Choose a mode"));
    // Logged out (no slot), the home screen is unchanged.
    expect(html).not.toContain("streak");
  });

  it("labels what's still a placeholder (#58: the daily is built now)", () => {
    expect(html).toContain("Prototype: point values are still being tuned.");
    expect(html).not.toContain("Daily puzzles aren");
  });
});
