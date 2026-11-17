import { act } from "@testing-library/react";
import { vi, type Mock } from "vitest";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/**
 * jsdom has no `matchMedia`. This stands in for the player's "reduce motion"
 * system setting, and lets a test change it mid-test like a player would.
 * Undo with `vi.unstubAllGlobals()`.
 */
export function fakeMotionSetting(reduce: boolean) {
  let current = reduce;
  const listeners = new Set<() => void>();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      get matches() {
        return current && query === REDUCED_MOTION;
      },
      media: query,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    })),
  );
  return {
    /** Flip the setting and notify the page, as the browser does. */
    set(next: boolean) {
      current = next;
      act(() => listeners.forEach((listener) => listener()));
    },
    listenerCount: () => listeners.size,
  };
}

/**
 * jsdom has no Web Animations API. Installs a recording `element.animate`.
 * `contexts` are the elements animated, in order; each call's return value has
 * a `cancel` mock. Undo with `removeFakeAnimate()`.
 */
export function fakeAnimate(): Mock {
  const animate = vi.fn(() => ({ cancel: vi.fn() }));
  HTMLElement.prototype.animate = animate as unknown as HTMLElement["animate"];
  return animate;
}

export function removeFakeAnimate() {
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
}
