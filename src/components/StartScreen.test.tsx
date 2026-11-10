import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HOW_TO_PLAY, StartScreen } from "./StartScreen.tsx";

const html = renderToStaticMarkup(<StartScreen />);

describe("StartScreen", () => {
  it("shows the game name as the page heading", () => {
    expect(html).toMatch(/<h1[^>]*>Zoom Out<\/h1>/u);
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

  it("labels the prototype as a placeholder for the daily game", () => {
    expect(html).toContain("Daily puzzles aren&#x27;t built yet");
  });
});
