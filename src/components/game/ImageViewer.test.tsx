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

  it("sits in the monitor with a zoom track lit up to the level on screen, and corners until it's full (#183)", () => {
    const html = render({ revealLevel: 1 });
    expect(html).toContain("data-monitor");
    expect([...html.matchAll(/data-zoom-segment="(on|off)"/g)].map((m) => m[1])).toEqual(["on", "on", "off", "off"]);
    expect(html).toContain("2/4");
    expect(html).toContain("data-corners");

    const full = render({ showFull: true });
    expect([...full.matchAll(/data-zoom-segment="on"/g)]).toHaveLength(4);
    expect(full).not.toContain("data-corners");
  });

  it("puts the instruments above the photo and the overlay inside its frame", () => {
    const html = renderToStaticMarkup(
      <ImageViewer puzzle={puzzle} revealLevel={0} instruments={<b data-test-instrument />} overlay={<i data-test-overlay />} />,
    );
    expect(html.indexOf("data-test-instrument")).toBeLessThan(html.indexOf("data-frame"));
    expect(html.indexOf("data-test-overlay")).toBeGreaterThan(html.indexOf("data-frame"));
    expect(html.indexOf("data-test-overlay")).toBeLessThan(html.indexOf("<figcaption"));
  });

  it("shows a message instead of a broken image when there's no image yet", () => {
    const html = render({ puzzle: { ...puzzle, imageUrl: "" } });
    expect(html).not.toContain("<img");
    expect(html).toContain("No image for this puzzle yet");
  });
});
