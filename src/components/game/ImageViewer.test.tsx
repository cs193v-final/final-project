import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ImageViewer } from "./ImageViewer";

// Server-rendered markup, so these run in Node without a DOM. They check what
// the viewer outputs for a level; the crop math itself is tested in crop.test.ts.

const puzzle = {
  imageUrl: "/test-images/grid.svg",
  reveal: { focus: { x: 0.5, y: 0.5 }, zoomLevels: [8, 4, 2, 1] },
};

const render = (props: Partial<Parameters<typeof ImageViewer>[0]> = {}) =>
  renderToStaticMarkup(<ImageViewer puzzle={puzzle} revealLevel={0} {...props} />);

describe("ImageViewer", () => {
  it("starts at the tightest crop", () => {
    const html = render();
    expect(html).toContain('src="/test-images/grid.svg"');
    expect(html).toContain("transform:translate(-350%, -350%) scale(8)");
    expect(html).toContain("Zoom level 1 of 4");
  });

  it("renders any reveal level, up to the full image", () => {
    expect(render({ revealLevel: 1 })).toContain("scale(4)");
    const full = render({ revealLevel: 3 });
    expect(full).toContain("transform:translate(0%, 0%) scale(1)");
    expect(full).toContain("Zoom level 4 of 4");
  });

  it("clamps an out-of-range level instead of breaking", () => {
    expect(render({ revealLevel: 99 })).toContain("Zoom level 4 of 4");
    expect(render({ revealLevel: -3 })).toContain("Zoom level 1 of 4");
  });

  it("can show the full image once the round is over", () => {
    const html = render({ revealLevel: 0, showFull: true });
    expect(html).toContain("scale(1)");
    expect(html).toContain("Full image");
  });

  it("never puts the answer in the markup", () => {
    const html = renderToStaticMarkup(
      <ImageViewer
        puzzle={{ ...puzzle, ...{ answer: "Golden Gate Bridge", acceptedAnswers: ["Golden Gate"] } }}
        revealLevel={0}
      />,
    );
    expect(html.toLowerCase()).not.toContain("golden");
    expect(html).toContain('alt="Mystery image, zoom level 1 of 4"');
  });

  it("shows a message instead of a broken image when there's no image yet", () => {
    const html = render({ puzzle: { ...puzzle, imageUrl: "" } });
    expect(html).not.toContain("<img");
    expect(html).toContain("No image for this puzzle yet");
  });
});
