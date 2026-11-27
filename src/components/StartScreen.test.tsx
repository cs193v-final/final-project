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

  it("links to the photo credits (#239)", () => {
    expect(html).toMatch(/<a[^>]*href="\/credits"[^>]*>Photo credits<\/a>/u);
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

  it("shows the scoring it's given, e.g. the practice pack's override, not the default (#204)", () => {
    const override: ScoringConfig = { basePoints: 300, revealPenalty: 25, wrongGuessPenalty: 7, minPoints: 40, skipPoints: 3 };
    const page = renderToStaticMarkup(<StartScreen scoring={override} />);
    expect(page).toContain("scores up to 300 points");
    expect(page).toContain("every zoom costs 25 points");
    expect(page).toContain("Wrong guesses cost 7 points each");
    expect(page).toContain("at least 40 points");
    expect(page).toContain("for 3 points.");
    // None of the default values are left over.
    expect(page).not.toContain(`scores up to ${SCORING_CONFIG.basePoints} points`);
    expect(page).not.toContain(`every zoom costs ${SCORING_CONFIG.revealPenalty} points`);
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
