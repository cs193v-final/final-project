import { vi } from "vitest";
import type { Pixels } from "@/game/effects";

/** How a photo URL behaves: decodes to these pixels, fails to load, or never finishes loading. */
export type FakePhoto = Pixels | "fail" | "pending";

type Recorded = { count: number; last?: Uint8ClampedArray };

let undo: (() => void) | undefined;

/**
 * jsdom can't decode images or draw on a canvas. Stands in for both: an
 * `<img>` or `new Image()` whose `src` is in `photos` decodes as listed (a
 * URL not listed fails), a photo drawn on a canvas reads back as its pixels,
 * and every frame put on a canvas is recorded (after calling `onPut`, e.g.
 * to make each frame take time on a faked clock). Undo with `removeFakeCanvas()`.
 */
export function fakeCanvas(photos: Record<string, FakePhoto>, { onPut }: { onPut?: () => void } = {}) {
  removeFakeCanvas();
  const photoOf = (image: HTMLImageElement): FakePhoto => photos[image.getAttribute("src") ?? ""] ?? "fail";
  const pixelsOf = (image: HTMLImageElement) => {
    const photo = photoOf(image);
    return typeof photo === "string" ? undefined : photo;
  };

  Object.defineProperty(HTMLImageElement.prototype, "decode", {
    configurable: true,
    value(this: HTMLImageElement) {
      const photo = photoOf(this);
      if (photo === "pending") return new Promise(() => {});
      return photo === "fail" ? Promise.reject(new Error("fake decode: the photo didn't load")) : Promise.resolve();
    },
  });
  const width = vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockImplementation(function (this: HTMLImageElement) {
    return pixelsOf(this)?.width ?? 0;
  });
  const height = vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockImplementation(function (this: HTMLImageElement) {
    return pixelsOf(this)?.height ?? 0;
  });

  const recorded = new Map<HTMLCanvasElement, Recorded>();
  const contexts = new Map<HTMLCanvasElement, unknown>();
  const context = (canvas: HTMLCanvasElement) => {
    if (!contexts.has(canvas)) {
      let drawn: Pixels | undefined;
      contexts.set(canvas, {
        drawImage: (image: HTMLImageElement) => void (drawn = pixelsOf(image)),
        getImageData: () => ({ width: drawn!.width, height: drawn!.height, data: new Uint8ClampedArray(drawn!.data) }),
        createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
        putImageData: (frame: { data: Uint8ClampedArray }) => {
          onPut?.();
          const r = recorded.get(canvas) ?? { count: 0 };
          recorded.set(canvas, { count: r.count + 1, last: new Uint8ClampedArray(frame.data) });
        },
      });
    }
    return contexts.get(canvas);
  };
  const getContext = vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockImplementation(function (this: HTMLCanvasElement) {
      return context(this) as RenderingContext;
    } as unknown as HTMLCanvasElement["getContext"]);

  undo = () => {
    delete (HTMLImageElement.prototype as { decode?: unknown }).decode;
    width.mockRestore();
    height.mockRestore();
    getContext.mockRestore();
  };

  return {
    /** The last frame put on `canvas`, or undefined if none has been. */
    lastFrame: (canvas: Element) => recorded.get(canvas as HTMLCanvasElement)?.last,
    /** How many frames have been put on `canvas`. */
    frameCount: (canvas: Element) => recorded.get(canvas as HTMLCanvasElement)?.count ?? 0,
  };
}

export function removeFakeCanvas() {
  undo?.();
  undo = undefined;
}

/**
 * A made-up photo: smooth colour waves and a red disc, so every effect
 * changes it visibly and differently over time.
 */
export function testPhoto(width = 40, height = 30): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0, i = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i += 4) {
      const disc = Math.hypot(x - width * 0.3, y - height * 0.6) < height / 4;
      data[i] = disc ? 230 : 128 + 100 * Math.sin(x * 0.4 + y * 0.15);
      data[i + 1] = disc ? 40 : 128 + 100 * Math.sin(x * 0.2 - y * 0.35 + 1);
      data[i + 2] = disc ? 60 : 128 + 100 * Math.sin(x * 0.3 + y * 0.25 + 2);
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

/** True if two frames are the same bytes. Faster than `toEqual` on a million bytes, and no giant diff. */
export const sameFrame = (a: Uint8ClampedArray | undefined, b: Uint8ClampedArray): boolean =>
  a !== undefined && a.length === b.length && a.every((v, i) => v === b[i]);
