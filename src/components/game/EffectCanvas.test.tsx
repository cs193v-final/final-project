// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEffect, DEFAULT_EFFECT, FRAME_LONG_SIDE, frameSize, type EffectName, type Pixels } from "@/game/effects";
import { fakeCanvas, removeFakeCanvas, sameFrame, testPhoto } from "@/test/fakeCanvas";
import { EffectCanvas } from "./EffectCanvas";

// Spec for drawing a puzzle's effect on the round screen (#257). The frames
// must be the ones the Beat the AI solver shows CLIP (src/images/clip/analyze.ts
// `solveTimed`): the same effect code, from the whole photo, at `frameSize`,
// with the puzzle's focus and seed. Otherwise the AI's time is for a
// different picture than the player's.

const PHOTO = testPhoto();
const FOCUS = { x: 0.3, y: 0.6 };
const LABEL = "The photo to guess, still hidden";

/** What the solver draws for this photo at `progress`. */
function solverFrame(effect: EffectName, photo: Pixels, progress: number, seed = "pz-test", focus = FOCUS) {
  return createEffect(effect, photo, { focus, seed, size: frameSize(photo.width, photo.height) })(progress);
}

/** Let the photo decode (the fake resolves at once, a few promises deep). */
const decoded = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

function canvasProps(overrides: Partial<Parameters<typeof EffectCanvas>[0]> = {}) {
  return { src: "/img/photo.webp", effect: "tiles" as const, focus: FOCUS, seed: "pz-test", progress: 0, label: LABEL, ...overrides };
}

afterEach(() => {
  vi.useRealTimers();
  removeFakeCanvas();
  vi.restoreAllMocks();
});

describe("EffectCanvas", () => {
  it("says the photo is loading until it's decoded, then shows it as an image named by the label", async () => {
    fakeCanvas({ "/img/photo.webp": PHOTO });
    render(<EffectCanvas {...canvasProps()} />);
    expect(screen.getByText("Loading the photo…")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();

    await decoded();
    expect(screen.getByRole("img", { name: LABEL }).tagName).toBe("CANVAS");
    expect(screen.queryByText("Loading the photo…")).not.toBeInTheDocument();
  });

  it.each(["pixelate", "spotlight", "thermal", "swirl", "zoom", "tiles"] as const)(
    "draws %s exactly as the AI solver does, at the progress it's given",
    async (effect) => {
      const fake = fakeCanvas({ "/img/photo.webp": PHOTO });
      const { rerender } = render(<EffectCanvas {...canvasProps({ effect, progress: 0.3 })} />);
      await decoded();
      const canvas = screen.getByRole("img", { name: LABEL });
      expect(sameFrame(fake.lastFrame(canvas), solverFrame(effect, PHOTO, 0.3))).toBe(true);

      rerender(<EffectCanvas {...canvasProps({ effect, progress: 0.7 })} />);
      // Maybe not at once: see "on a slow phone" below.
      await waitFor(() => expect(sameFrame(fake.lastFrame(canvas), solverFrame(effect, PHOTO, 0.7))).toBe(true));
    },
  );

  it(`draws ${FRAME_LONG_SIDE} px on the photo's longer side, keeping its shape, whatever the photo's size`, async () => {
    fakeCanvas({ "/img/wide.webp": testPhoto(1600, 1200), "/img/tall.webp": testPhoto(30, 40) });
    render(
      <>
        <EffectCanvas {...canvasProps({ src: "/img/wide.webp", label: "wide" })} />
        <EffectCanvas {...canvasProps({ src: "/img/tall.webp", label: "tall" })} />
      </>,
    );
    await decoded();
    const wide = screen.getByRole("img", { name: "wide" });
    const tall = screen.getByRole("img", { name: "tall" });
    expect([wide.getAttribute("width"), wide.getAttribute("height")]).toEqual(["600", "450"]);
    expect([tall.getAttribute("width"), tall.getAttribute("height")]).toEqual(["450", "600"]);
  });

  it(`plays ${DEFAULT_EFFECT} when the puzzle has no effect chosen, as the server and the solver do`, async () => {
    const fake = fakeCanvas({ "/img/photo.webp": PHOTO });
    render(<EffectCanvas {...canvasProps({ effect: undefined, progress: 0.4 })} />);
    await decoded();
    const canvas = screen.getByRole("img", { name: LABEL });
    expect(canvas).toHaveAttribute("data-effect-canvas", DEFAULT_EFFECT);
    expect(sameFrame(fake.lastFrame(canvas), solverFrame(DEFAULT_EFFECT, PHOTO, 0.4))).toBe(true);
  });

  it("opens the tiles in the order the seed fixes, so another puzzle's reveal differs", async () => {
    const fake = fakeCanvas({ "/img/photo.webp": PHOTO });
    render(<EffectCanvas {...canvasProps({ seed: "pz-other", progress: 0.5 })} />);
    await decoded();
    const frame = fake.lastFrame(screen.getByRole("img", { name: LABEL }));
    expect(sameFrame(frame, solverFrame("tiles", PHOTO, 0.5, "pz-other"))).toBe(true);
    expect(sameFrame(frame, solverFrame("tiles", PHOTO, 0.5, "pz-test"))).toBe(false);
  });

  it("doesn't redraw while the progress stays the same", async () => {
    const fake = fakeCanvas({ "/img/photo.webp": PHOTO });
    const { rerender } = render(<EffectCanvas {...canvasProps({ progress: 1 })} />);
    await decoded();
    const canvas = screen.getByRole("img", { name: LABEL });
    expect(fake.frameCount(canvas)).toBe(1);
    // Between the clear time and the limit, progress stays at 1 while the clock ticks.
    rerender(<EffectCanvas {...canvasProps({ progress: 1 })} />);
    expect(fake.frameCount(canvas)).toBe(1);
  });

  it("on a slow phone, leaves the page as long free as each frame took, so a guess can still be typed", async () => {
    let now = 1_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const fake = fakeCanvas({ "/img/photo.webp": PHOTO }, { onPut: () => void (now += 60) }); // each frame takes 60 ms
    const { rerender } = render(<EffectCanvas {...canvasProps({ progress: 0.1 })} />);
    await decoded();
    const canvas = screen.getByRole("img", { name: LABEL });
    expect(fake.frameCount(canvas)).toBe(1); // drawn at once, from 1,000 to 1,060 ms: free until 1,120

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    rerender(<EffectCanvas {...canvasProps({ progress: 0.2 })} />);
    expect(fake.frameCount(canvas)).toBe(1); // still free time left
    rerender(<EffectCanvas {...canvasProps({ progress: 0.3 })} />); // the clock moved on: 0.2 is skipped
    now = 1_120;
    act(() => void vi.advanceTimersByTime(60));
    expect(fake.frameCount(canvas)).toBe(2);
    expect(sameFrame(fake.lastFrame(canvas), solverFrame("tiles", PHOTO, 0.3))).toBe(true);
  });

  it("draws the last progress even if the clock stops moving during the free time", async () => {
    let now = 1_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const fake = fakeCanvas({ "/img/photo.webp": PHOTO }, { onPut: () => void (now += 60) });
    const { rerender } = render(<EffectCanvas {...canvasProps({ progress: 0.9 })} />);
    await decoded();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // The photo is clear (progress stays 1 until the limit): it must still be drawn clear.
    rerender(<EffectCanvas {...canvasProps({ progress: 1 })} />);
    now = 1_120;
    act(() => void vi.advanceTimersByTime(60));
    expect(sameFrame(fake.lastFrame(screen.getByRole("img", { name: LABEL })), solverFrame("tiles", PHOTO, 1))).toBe(true);
  });

  it("says so if the photo doesn't load", async () => {
    fakeCanvas({ "/img/photo.webp": "fail" });
    render(<EffectCanvas {...canvasProps()} />);
    await decoded();
    expect(screen.getByRole("alert")).toHaveTextContent("The photo didn't load. Check your connection, then refresh the page.");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("shows Loading for a new photo until it's ready, never the old photo's frames", async () => {
    fakeCanvas({ "/img/photo.webp": PHOTO, "/img/next.webp": "pending" });
    const { rerender } = render(<EffectCanvas {...canvasProps()} />);
    await decoded();
    expect(screen.getByRole("img", { name: LABEL })).toBeInTheDocument();

    rerender(<EffectCanvas {...canvasProps({ src: "/img/next.webp", seed: "pz-next" })} />);
    await decoded();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("Loading the photo…")).toBeInTheDocument();
  });
});
