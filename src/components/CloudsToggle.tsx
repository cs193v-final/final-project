"use client";

import { useEffect, useSyncExternalStore } from "react";
import { FOCUS_RING } from "./ui/styles";

/**
 * Pauses and resumes the drifting clouds (#183), as WCAG 2.2.2 asks for
 * motion that runs on its own for more than 5 seconds. Remembered in this
 * browser. Hidden with reduced motion, when the clouds don't move anyway.
 * Sits at the end of the page, in the flow (not floating), so it never
 * covers content or comes before the main actions in the tab order.
 */
const STORAGE_KEY = "zoomout:clouds";
const listeners = new Set<() => void>();
let chosen: boolean | null = null;

function readPaused(): boolean {
  if (chosen !== null) return chosen;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "paused";
  } catch {
    return false;
  }
}

function setPaused(paused: boolean) {
  chosen = paused;
  try {
    window.localStorage.setItem(STORAGE_KEY, paused ? "paused" : "moving");
  } catch {
    // Remembered for this tab only.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function CloudsToggle() {
  const paused = useSyncExternalStore(subscribe, readPaused, () => false);

  // The sky reads this attribute (globals.css), so pausing needs no re-render of the clouds.
  useEffect(() => {
    document.documentElement.toggleAttribute("data-clouds-paused", paused);
  }, [paused]);

  return (
    <footer className="clouds-toggle mt-auto flex justify-end px-4 pt-6 pb-4">
      <button
        type="button"
        aria-pressed={paused}
        onClick={() => setPaused(!paused)}
        className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border border-zinc-400 bg-paper/90 px-3 text-xs font-semibold text-zinc-700 backdrop-blur-sm hover:bg-paper dark:border-zinc-500 dark:bg-zinc-800/90 dark:text-zinc-200 ${FOCUS_RING}`}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-3.5" fill="currentColor">
          {paused ? <path d="M7 5v14l12-7z" /> : <path d="M7 5h3v14H7zm7 0h3v14h-3z" />}
        </svg>
        Pause clouds
      </button>
    </footer>
  );
}
