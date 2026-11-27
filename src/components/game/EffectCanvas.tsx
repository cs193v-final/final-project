"use client";

import { useEffect, useRef, useState } from "react";
import { createEffect, DEFAULT_EFFECT, frameSize, type Effect, type EffectName, type Pixels } from "@/game/effects";

/**
 * Decodes the photo at `src` and reads its pixels at full size, the way the
 * AI solver reads the same stored photo with sharp. Rejects if it doesn't
 * load or the browser can't read it.
 */
export async function loadPhotoPixels(src: string): Promise<Pixels> {
  const image = new Image();
  image.decoding = "async";
  image.src = src;
  await image.decode();
  const { naturalWidth: width, naturalHeight: height } = image;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) throw new Error("loadPhotoPixels: this browser can't draw on a canvas");
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, width, height);
}

type Loaded =
  | { key: string; status: "ready"; draw: Effect; width: number; height: number }
  | { key: string; status: "failed" };

/**
 * The photo hidden by its effect at `progress` (0 hidden, 1 clear), drawn on
 * a canvas (#257). Frames come from src/game/effects at `frameSize`, from
 * the whole photo, with the puzzle's focus and seed: the same frames the
 * Beat the AI solver shows CLIP, so the AI's time is for what players see.
 * Says so while the photo loads, and if it fails to.
 */
export function EffectCanvas({
  src,
  effect = DEFAULT_EFFECT,
  focus,
  seed,
  progress,
  label,
}: {
  src: string;
  effect?: EffectName | undefined;
  focus: { x: number; y: number };
  /** The puzzle's id (`PublicRound.seed`): it fixes the tiles' order, the same as the AI saw. */
  seed: string;
  progress: number;
  /** What the photo is, for screen readers. */
  label: string;
}) {
  const { x, y } = focus;
  const key = JSON.stringify([src, effect, x, y, seed]);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let current = true;
    void (async () => {
      let result: Loaded;
      try {
        const photo = await loadPhotoPixels(src);
        const size = frameSize(photo.width, photo.height);
        result = { key, status: "ready", draw: createEffect(effect, photo, { focus: { x, y }, seed, size }), ...size };
      } catch {
        result = { key, status: "failed" };
      }
      if (current) setLoaded(result);
    })();
    return () => {
      current = false;
    };
  }, [key, src, effect, x, y, seed]);

  // Only what was loaded for these props: a new photo shows "Loading" until it's ready.
  const ready = loaded?.key === key && loaded.status === "ready" ? loaded : null;
  const failed = loaded?.key === key && loaded.status === "failed";

  const canvas = useRef<HTMLCanvasElement>(null);
  // One frame's pixels, reused: the clock redraws it 20 times a second.
  const frame = useRef<ImageData | null>(null);
  // When the next frame may be drawn (performance.now() ms). See below.
  const freeUntil = useRef(0);
  useEffect(() => {
    const context = ready === null ? null : canvas.current?.getContext("2d");
    if (ready === null || !context) return;
    const drawNow = () => {
      const started = performance.now();
      if (frame.current?.width !== ready.width || frame.current.height !== ready.height) {
        frame.current = context.createImageData(ready.width, ready.height);
      }
      ready.draw(progress, frame.current.data);
      context.putImageData(frame.current, 0, 0);
      // Frames are drawn on the page's one thread. On a slow phone, zoom's
      // frames can take longer than the clock's 50 ms tick, which would leave
      // no time to type a guess. So after each frame, leave the page free for
      // as long as it took: a slow phone draws fewer frames, a fast one the same.
      const ended = performance.now();
      freeUntil.current = ended + (ended - started);
    };
    const wait = freeUntil.current - performance.now();
    if (wait <= 0) {
      drawNow();
      return;
    }
    // Draw this progress once the page has had its free time, unless the
    // clock moves on first (then the next progress is drawn instead).
    const id = setTimeout(drawNow, wait);
    return () => clearTimeout(id);
  }, [ready, progress]);

  if (ready !== null) {
    return (
      <canvas
        ref={canvas}
        width={ready.width}
        height={ready.height}
        role="img"
        aria-label={label}
        data-effect-canvas={effect}
        className="h-full w-full object-cover"
      />
    );
  }
  return failed ? (
    <p role="alert" className="px-6 text-center text-sm text-rose-700 dark:text-rose-400">
      The photo didn&apos;t load. Check your connection, then refresh the page.
    </p>
  ) : (
    <p className="px-6 text-center text-sm text-zinc-600 dark:text-zinc-400">Loading the photo…</p>
  );
}
