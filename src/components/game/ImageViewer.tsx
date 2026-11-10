"use client";

import { useEffect, useRef, useState } from "react";
import { clampRevealLevel, cropTransformCss } from "../../game/crop";
import type { Puzzle, RevealLevel } from "../../game/types";

export type ImageViewerProps = {
  puzzle: Pick<Puzzle, "imageUrl" | "reveal">;
  /** 0 = tightest crop, `zoomLevels.length - 1` = full image (#10). Owned by the round logic. */
  revealLevel: RevealLevel;
  /** Show the full image regardless of `revealLevel`, e.g. once the round is over. */
  showFull?: boolean;
};

type LoadState = "loading" | "loaded" | "error";

/**
 * Shows a puzzle's image cropped around `puzzle.reveal.focus` at the zoom for
 * `revealLevel` (#10). It only displays: it doesn't track score or change the
 * level. The Zoom out button (#11) asks the round logic for the next level.
 *
 * Render it with `key={puzzle.id}` so a new image doesn't animate from the
 * previous image's zoom.
 */
export function ImageViewer({ puzzle, revealLevel, showFull = false }: ImageViewerProps) {
  const { imageUrl, reveal } = puzzle;
  const levels = Math.max(1, reveal.zoomLevels.length);
  const level = showFull ? levels - 1 : clampRevealLevel(reveal, revealLevel);
  const transform = cropTransformCss(reveal, level);

  // Size the frame to the image's own shape once it loads, so the focus point
  // (a fraction of the image) maps exactly onto the frame. 4:3 until then.
  const [aspect, setAspect] = useState(4 / 3);
  const [load, setLoad] = useState<LoadState>("loading");
  const img = useRef<HTMLImageElement>(null);

  function measure(el: HTMLImageElement) {
    if (el.naturalWidth > 0 && el.naturalHeight > 0) {
      setAspect(el.naturalWidth / el.naturalHeight);
      setLoad("loaded");
    }
  }

  // The image can finish (or fail) before React attaches onLoad / onError,
  // e.g. when it's cached or the server-rendered page loads it first.
  useEffect(() => {
    const el = img.current;
    if (!el?.complete) return;
    if (el.naturalWidth > 0) measure(el);
    else setLoad("error");
  }, [imageUrl]);

  const caption = showFull ? "Full image" : `Zoom level ${level + 1} of ${levels}`;

  return (
    <figure className="flex w-full max-w-md flex-col gap-2">
      <div
        className="relative w-full overflow-hidden rounded-xl bg-zinc-200 dark:bg-zinc-800"
        style={{ aspectRatio: String(aspect) }}
      >
        {imageUrl === "" || load === "error" ? (
          <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-zinc-600 dark:text-zinc-400">
            {imageUrl === "" ? "No image for this puzzle yet" : "The image couldn't load"}
          </p>
        ) : (
          // A plain <img>, not next/image: next/image serves a copy sized to the
          // frame, which looks blocky when scaled up 8×. This needs the
          // full-resolution file.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={img}
            src={imageUrl}
            // Never put the answer in alt text: screen readers (and anyone
            // inspecting the page) would get it for free.
            alt={`Mystery image, ${caption.toLowerCase()}`}
            draggable={false}
            onLoad={(e) => measure(e.currentTarget)}
            onError={() => setLoad("error")}
            onContextMenu={(e) => e.preventDefault()}
            className="absolute inset-0 h-full w-full origin-top-left select-none transition-transform duration-500 ease-out motion-reduce:transition-none"
            style={{ transform }}
          />
        )}
      </div>
      <figcaption aria-live="polite" className="text-center text-sm text-zinc-600 dark:text-zinc-400">
        {caption}
      </figcaption>
    </figure>
  );
}
