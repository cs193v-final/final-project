import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PlayPage from "./page";

describe("/play", () => {
  it("links back to the start screen while playing", () => {
    // The game itself streams in at request time (it reads the URL and the
    // owner cookie); the back link is in the static shell around it.
    const html = renderToString(<PlayPage params={Promise.resolve({})} searchParams={Promise.resolve({})} />);
    expect(html).toMatch(/<a[^>]*href="\/"[^>]*>← Back to start<\/a>/u);
    expect(html).toContain("Loading the game…");
  });
});
