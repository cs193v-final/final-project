import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PlayPage from "./page";

describe("/play", () => {
  it("links back to the start screen while playing", () => {
    const html = renderToString(<PlayPage />);
    expect(html).toMatch(/<a[^>]*href="\/"[^>]*>← Back to start<\/a>/u);
  });
});
