import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HOW_TO_PLAY, StartScreen } from "./StartScreen.tsx";

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
    expect(rules).toMatch(/zoom costs points/u);
    expect(rules).toMatch(/Wrong guesses cost points/u);
    expect(rules).toMatch(/skip/u);
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

  it("labels what's still a placeholder (#58: the daily is built now)", () => {
    expect(html).toContain("Prototype: point values are still being tuned.");
    expect(html).not.toContain("Daily puzzles aren");
  });
});
