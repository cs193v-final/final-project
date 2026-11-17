// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageViewer } from "./ImageViewer";

// Spec for showing per-level images (#57): each zoom level is its own image, so
// zooming out swaps the image, and that must never show an empty frame.
//
// jsdom never loads images, so each test stands in for the browser: it sets the
// decoded size and fires `load` itself.

let width = 400;
let height = 300;
beforeEach(() => {
  width = 400;
  height = 300;
  vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockImplementation(() => width);
  vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockImplementation(() => height);
  vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(false);
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** Per-level images need no crop: every level is shown as it is. */
const NO_CROP = { focus: { x: 0.5, y: 0.5 }, zoomLevels: [1, 1, 1] };
const viewer = (imageUrl: string, revealLevel: number) => (
  <ImageViewer puzzle={{ imageUrl, reveal: NO_CROP }} revealLevel={revealLevel} />
);
const frame = (container: HTMLElement) => container.querySelector("figure > div") as HTMLElement;

describe("ImageViewer with one image per level", () => {
  it("shows the first level by itself", () => {
    render(viewer("/img/level-0.webp", 0));
    fireEvent.load(screen.getByRole("img"));
    expect(document.querySelectorAll("img")).toHaveLength(1);
    expect(screen.getByRole("img")).toHaveClass("opacity-100");
  });

  it("keeps the last level on screen until the next one has loaded and faded in, then shows only the new one", () => {
    const { rerender } = render(viewer("/img/level-0.webp", 0));
    fireEvent.load(screen.getByRole("img"));

    rerender(viewer("/img/level-1.webp", 1));
    const previous = document.querySelector("[data-previous-level]");
    expect(previous).toHaveAttribute("src", "/img/level-0.webp");
    // The new level is there, but invisible until it has loaded.
    expect(screen.getByRole("img")).toHaveAttribute("src", "/img/level-1.webp");
    expect(screen.getByRole("img")).toHaveClass("opacity-0");

    // Loaded: it starts fading in, with the last level still under it, so the
    // empty frame never shows through the fade.
    fireEvent.load(screen.getByRole("img"));
    expect(screen.getByRole("img")).toHaveClass("opacity-100");
    expect(document.querySelector("[data-previous-level]")).toHaveAttribute("src", "/img/level-0.webp");

    // Faded in: only the new level is left.
    fireEvent.transitionEnd(screen.getByRole("img"));
    expect(document.querySelector("[data-previous-level]")).not.toBeInTheDocument();
    expect(document.querySelectorAll("img")).toHaveLength(1);
  });

  it("removes the kept level after the fade's length even when no transition runs (reduced motion)", () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(viewer("/img/level-0.webp", 0));
      fireEvent.load(screen.getByRole("img"));
      rerender(viewer("/img/level-1.webp", 1));
      fireEvent.load(screen.getByRole("img"));
      // No transitionend: with reduced motion there's no transition.
      act(() => vi.advanceTimersByTime(400));
      expect(document.querySelector("[data-previous-level]")).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(300));
      expect(document.querySelector("[data-previous-level]")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("zooming out twice before a level loads keeps the last level that was on screen", () => {
    const { rerender } = render(viewer("/img/level-0.webp", 0));
    fireEvent.load(screen.getByRole("img"));
    rerender(viewer("/img/level-1.webp", 1));
    // Level 1 never loads before the player zooms out again.
    rerender(viewer("/img/level-2.webp", 2));
    expect(document.querySelector("[data-previous-level]")).toHaveAttribute("src", "/img/level-0.webp");
    expect(screen.getByRole("img")).toHaveAttribute("src", "/img/level-2.webp");
    expect(screen.getByRole("img")).toHaveClass("opacity-0");
  });

  it("gives screen readers one image, the level being loaded, with its level in the name", () => {
    const { rerender } = render(viewer("/img/level-0.webp", 0));
    fireEvent.load(screen.getByRole("img"));
    rerender(viewer("/img/level-1.webp", 1));
    // The kept copy is aria-hidden with empty alt text, so it isn't announced.
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.getByRole("img")).toHaveAccessibleName("Mystery image, zoom level 2 of 3");
  });

  it("keeps the frame's shape while the next level loads, instead of jumping back to 4:3", () => {
    width = 400;
    height = 200;
    const { container, rerender } = render(viewer("/img/level-0.webp", 0));
    fireEvent.load(screen.getByRole("img"));
    expect(frame(container).style.aspectRatio).toBe("2 / 1"); // jsdom writes 2 as "2 / 1"
    rerender(viewer("/img/level-1.webp", 1));
    expect(frame(container).style.aspectRatio).toBe("2 / 1");
  });

  it("says so if the next level fails to load, rather than leaving the old one up", () => {
    const { rerender } = render(viewer("/img/level-0.webp", 0));
    fireEvent.load(screen.getByRole("img"));
    rerender(viewer("/img/level-1.webp", 1));
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByText("The image couldn't load")).toBeInTheDocument();
    expect(document.querySelectorAll("img")).toHaveLength(0);
  });
});
