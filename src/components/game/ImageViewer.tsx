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

/** How long a new level takes to fade in. Matches `duration-500` on the image. */
const FADE_MS = 500;

/**
 * Shows a puzzle's image cropped around `puzzle.reveal.focus` at the zoom for
 * `revealLevel` (#10). It only displays: it doesn't track score or change the
 * level. The Zoom out button (#11) asks the round logic for the next level.
 *
 * With per-level images (#57) each zoom level is its own `imageUrl`. While the
 * next level loads, the last one that loaded stays on screen, at its own shape,
 * and the new one fades in on top once it's ready. The old one is removed only
 * after that fade has finished, so zooming out never shows an empty frame. Give each puzzle its own `key` (PracticeGame uses the round
 * position), so a new puzzle starts fresh instead of over the last one.
 */
export function ImageViewer({ puzzle, revealLevel, showFull = false }: ImageViewerProps) {
  const { imageUrl, reveal } = puzzle;
  const levels = Math.max(1, reveal.zoomLevels.length);
  const level = showFull ? levels - 1 : clampRevealLevel(reveal, revealLevel);
  const transform = cropTransformCss(reveal, level);

  // Size the frame to the image's own shape once it loads, so the focus point
  // (a fraction of the image) maps exactly onto the frame. 4:3 until the first
  // image loads. Each result is tagged with the URL it belongs to.
  const [result, setResult] = useState<{ url: string; load: LoadState; aspect: number }>({
    url: imageUrl,
    load: "loading",
    aspect: 4 / 3,
  });
  // The last image that finished loading.
  const [shown, setShown] = useState<{ url: string; aspect: number } | null>(null);
  // The image kept under a new one: from when the URL changes until the new
  // one has loaded AND faded in, so the empty frame never shows through.
  const [under, setUnder] = useState<{ url: string; aspect: number } | null>(null);
  const [underFor, setUnderFor] = useState(imageUrl);
  if (underFor !== imageUrl) {
    // A new level: keep whatever was last on screen under it.
    setUnderFor(imageUrl);
    setUnder(shown !== null && shown.url !== imageUrl ? shown : null);
  }
  const current = result.url === imageUrl ? result : { load: "loading" as const, aspect: shown?.aspect ?? 4 / 3 };
  const { load, aspect } = current;
  const img = useRef<HTMLImageElement>(null);
  const previous = under !== null && under.url !== imageUrl ? under : null;

  // Drop the kept image once the new one has faded in: on its transitionend,
  // or after the fade's length when no transition runs (reduced motion, a
  // background tab), so it never lingers.
  const fadingIn = load === "loaded" && previous !== null;
  useEffect(() => {
    if (!fadingIn) return;
    const timer = setTimeout(() => setUnder(null), FADE_MS + 100);
    return () => clearTimeout(timer);
  }, [fadingIn]);

  function measure(el: HTMLImageElement, url: string) {
    if (el.naturalWidth > 0 && el.naturalHeight > 0) {
      const loaded = el.naturalWidth / el.naturalHeight;
      setResult({ url, load: "loaded", aspect: loaded });
      setShown({ url, aspect: loaded });
    }
  }

  // The image can finish (or fail) before React attaches onLoad / onError,
  // e.g. when it's cached or the server-rendered page loads it first.
  useEffect(() => {
    const el = img.current;
    if (!el?.complete) return;
    if (el.naturalWidth > 0) measure(el, imageUrl);
    else setResult({ url: imageUrl, load: "error", aspect: 4 / 3 });
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
          <>
            {previous && (
              // The last level, kept on screen until the new one has loaded.
              // A copy for sighted players only: screen readers hear the new one.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={previous.url}
                src={previous.url}
                alt=""
                aria-hidden="true"
                data-previous-level
                draggable={false}
                className="absolute inset-0 h-full w-full select-none"
              />
            )}
            {/* A plain <img>, not next/image: next/image serves a copy sized to
                the frame, which looks blocky when scaled up 8×. This needs the
                full-resolution file. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={imageUrl}
              ref={img}
              src={imageUrl}
              // Never put the answer in alt text: screen readers (and anyone
              // inspecting the page) would get it for free.
              alt={`Mystery image, ${caption.toLowerCase()}`}
              draggable={false}
              onLoad={(e) => measure(e.currentTarget, imageUrl)}
              onError={() => setResult({ url: imageUrl, load: "error", aspect: 4 / 3 })}
              onContextMenu={(e) => e.preventDefault()}
              // Its fade-in is done, so the kept image under it can go.
              onTransitionEnd={() => {
                if (load === "loaded") setUnder(null);
              }}
              // While a later level loads over the last one, it stays invisible,
              // then fades in over it (instantly with reduced motion).
              className={`absolute inset-0 h-full w-full origin-top-left select-none transition-[transform,opacity] duration-500 ease-out motion-reduce:transition-none ${previous && load !== "loaded" ? "opacity-0" : "opacity-100"}`}
              style={{ transform }}
            />
          </>
        )}
      </div>
      <figcaption aria-live="polite" className="text-center text-sm text-zinc-600 dark:text-zinc-400">
        {caption}
      </figcaption>
    </figure>
  );
}
