// @vitest-environment jsdom
import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeMotionSetting } from "@/test/fakeMotion";
import { MOTION_BOOT_SCRIPT, MOTION_STORAGE_KEY } from "./motion-boot";
import { resetMotionChoice, usePrefersReducedMotion } from "./game/motion";
import { MotionHint, MotionToggle } from "./MotionToggle";

// Spec for the in-app Animations switch (#183): the system's Reduce motion
// setting is the default, and the player can override it either way.

beforeEach(() => {
  window.localStorage.clear();
  resetMotionChoice();
  document.documentElement.removeAttribute("data-reduced-motion");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const toggle = () => screen.getByRole("button", { name: "Animations" });

describe("MotionToggle", () => {
  it("shows animations on when the system doesn't ask for less motion", () => {
    fakeMotionSetting(false);
    render(<MotionToggle />);
    expect(toggle()).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement).not.toHaveAttribute("data-reduced-motion");
  });

  it("follows the system's Reduce motion by default", () => {
    fakeMotionSetting(true);
    render(<MotionToggle />);
    expect(toggle()).toHaveAttribute("aria-pressed", "false");
    expect(document.documentElement).toHaveAttribute("data-reduced-motion");
  });

  it("turns animations on over the system setting, and every motion check follows", () => {
    fakeMotionSetting(true);
    render(<MotionToggle />);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(true);

    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement).not.toHaveAttribute("data-reduced-motion");
    expect(result.current).toBe(false);
    expect(window.localStorage.getItem(MOTION_STORAGE_KEY)).toBe("on");
  });

  it("turns animations off even when the system doesn't ask", () => {
    fakeMotionSetting(false);
    render(<MotionToggle />);
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-pressed", "false");
    expect(document.documentElement).toHaveAttribute("data-reduced-motion");
  });

  it("remembers the choice", () => {
    fakeMotionSetting(true);
    const { unmount } = render(<MotionToggle />);
    fireEvent.click(toggle());
    unmount();
    resetMotionChoice();
    render(<MotionToggle />);
    expect(toggle()).toHaveAttribute("aria-pressed", "true");
  });
});

describe("MotionHint", () => {
  it("says why there's no motion, and turns it on in one click", () => {
    fakeMotionSetting(true);
    render(
      <>
        <MotionHint />
        <MotionToggle />
      </>,
    );
    expect(screen.getByText(/your device asks for reduced motion/u)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Turn on animations" }));
    expect(screen.queryByText(/your device asks for reduced motion/u)).not.toBeInTheDocument();
    expect(toggle()).toHaveAttribute("aria-pressed", "true");
  });

  it("stays away when the system doesn't ask, or the player already chose", () => {
    fakeMotionSetting(false);
    const { unmount } = render(<MotionHint />);
    expect(screen.queryByText(/reduced motion/u)).not.toBeInTheDocument();
    unmount();

    fakeMotionSetting(true);
    window.localStorage.setItem(MOTION_STORAGE_KEY, "off");
    render(<MotionHint />);
    expect(screen.queryByText(/reduced motion/u)).not.toBeInTheDocument();
  });
});

describe("the boot script", () => {
  const run = () => new Function(MOTION_BOOT_SCRIPT)();

  it("marks reduced motion before first paint from the system setting", () => {
    fakeMotionSetting(true);
    run();
    expect(document.documentElement).toHaveAttribute("data-reduced-motion");
  });

  it("lets the player's 'on' win over the system", () => {
    fakeMotionSetting(true);
    window.localStorage.setItem(MOTION_STORAGE_KEY, "on");
    run();
    expect(document.documentElement).not.toHaveAttribute("data-reduced-motion");
  });

  it("lets the player's 'off' win too", () => {
    fakeMotionSetting(false);
    window.localStorage.setItem(MOTION_STORAGE_KEY, "off");
    run();
    expect(document.documentElement).toHaveAttribute("data-reduced-motion");
  });
});
