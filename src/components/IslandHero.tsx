"use client";

import Image from "next/image";
import { useState } from "react";
import { FOCUS_RING } from "./ui/styles";

/**
 * The home screen's "Picture Island" (#183), and the game in one gesture: it
 * opens on a tight close-up of the camera's lens inside a viewfinder, then
 * zooms out to the whole island, the way a round clears up. Once landed, it
 * floats gently. Clicking it plays the zoom out again.
 *
 * All CSS animation on `transform` and `opacity` (globals.css: `.island-*`),
 * so it stays smooth while the page loads. With reduced motion there's no
 * zoom or float; the island fades in.
 */
export function IslandHero() {
  // A new key remounts the zoom layer, which restarts its CSS animation.
  const [run, setRun] = useState(0);
  return (
    <button
      type="button"
      aria-label="Zoom out again"
      onClick={() => setRun((n) => n + 1)}
      className={`island-hero relative -mb-4 block w-full max-w-xl cursor-zoom-out rounded-3xl ${FOCUS_RING}`}
    >
      <span className="island-bob block">
        <span key={run} data-island-zoom className="island-zoom relative block overflow-hidden rounded-3xl">
          <Image
            src="/brand/island.webp"
            alt=""
            width={1100}
            height={733}
            priority
            sizes="(min-width: 640px) 36rem, 100vw"
            className="island-photo block h-auto w-full"
          />
          {/* The viewfinder the close-up is seen through; it opens out and fades as the zoom lands. */}
          <span aria-hidden="true" className="island-viewfinder pointer-events-none absolute inset-[6%]">
            <i className="absolute top-0 left-0 size-7 border-t-[3px] border-l-[3px] border-plum dark:border-[#fff5e6]" />
            <i className="absolute top-0 right-0 size-7 border-t-[3px] border-r-[3px] border-plum dark:border-[#fff5e6]" />
            <i className="absolute bottom-0 left-0 size-7 border-b-[3px] border-l-[3px] border-plum dark:border-[#fff5e6]" />
            <i className="absolute right-0 bottom-0 size-7 border-r-[3px] border-b-[3px] border-plum dark:border-[#fff5e6]" />
          </span>
        </span>
      </span>
    </button>
  );
}
