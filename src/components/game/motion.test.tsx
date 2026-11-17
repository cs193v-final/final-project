// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { fakeAnimate, fakeMotionSetting, removeFakeAnimate } from "@/test/fakeMotion";
import { SHAKE, SHAKE_TIMING, useAnimateOn, usePrefersReducedMotion } from "./motion";

// Spec for the motion helpers behind #48's answer feedback.

function MotionSetting() {
  return <p>{usePrefersReducedMotion() ? "reduced" : "full"}</p>;
}

function Box({ trigger }: { trigger: unknown }) {
  const ref = useAnimateOn<HTMLDivElement>(trigger, SHAKE, SHAKE_TIMING);
  return <div ref={ref} role="img" aria-label="box" />;
}

afterEach(() => {
  vi.unstubAllGlobals();
  removeFakeAnimate();
});

describe("usePrefersReducedMotion", () => {
  it("reads the player's setting", () => {
    fakeMotionSetting(true);
    render(<MotionSetting />);
    expect(screen.getByText("reduced")).toBeInTheDocument();
  });

  it("updates live when the player changes the setting mid-game", () => {
    const setting = fakeMotionSetting(false);
    render(<MotionSetting />);
    expect(screen.getByText("full")).toBeInTheDocument();
    setting.set(true);
    expect(screen.getByText("reduced")).toBeInTheDocument();
    setting.set(false);
    expect(screen.getByText("full")).toBeInTheDocument();
  });

  it("stops listening for changes once unmounted", () => {
    const setting = fakeMotionSetting(false);
    const { unmount } = render(<MotionSetting />);
    expect(setting.listenerCount()).toBeGreaterThan(0);
    unmount();
    expect(setting.listenerCount()).toBe(0);
  });

  it("treats a browser without matchMedia as having no setting (motion allowed)", () => {
    render(<MotionSetting />);
    expect(screen.getByText("full")).toBeInTheDocument();
  });
});

describe("useAnimateOn", () => {
  let animate: Mock;
  beforeEach(() => {
    animate = fakeAnimate();
  });

  /** The `cancel` mock returned by the nth animate() call. */
  const cancelOf = (n: number) => (animate.mock.results[n]?.value as { cancel: Mock }).cancel;

  it("does nothing while the trigger is empty", () => {
    fakeMotionSetting(false);
    const { rerender } = render(<Box trigger={null} />);
    rerender(<Box trigger={false} />);
    rerender(<Box trigger={undefined} />);
    expect(animate).not.toHaveBeenCalled();
  });

  it("plays on the element once per new trigger, not on every render", () => {
    fakeMotionSetting(false);
    const { rerender } = render(<Box trigger={null} />);
    const first = { kind: "incorrect" };
    rerender(<Box trigger={first} />);
    rerender(<Box trigger={first} />);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate).toHaveBeenCalledWith(SHAKE, SHAKE_TIMING);
    expect(animate.mock.contexts[0]).toBe(screen.getByRole("img", { name: "box" }));
  });

  it("cancels the running animation when a new trigger starts the next one", () => {
    fakeMotionSetting(false);
    const { rerender } = render(<Box trigger={{ n: 1 }} />);
    rerender(<Box trigger={{ n: 2 }} />);
    expect(animate).toHaveBeenCalledTimes(2);
    expect(cancelOf(0)).toHaveBeenCalled();
    expect(cancelOf(1)).not.toHaveBeenCalled();
  });

  it("cancels the animation when the element goes away", () => {
    fakeMotionSetting(false);
    const { unmount } = render(<Box trigger="go" />);
    unmount();
    expect(cancelOf(0)).toHaveBeenCalled();
  });

  it("never plays when the player prefers reduced motion", () => {
    fakeMotionSetting(true);
    const { rerender } = render(<Box trigger="go" />);
    rerender(<Box trigger="again" />);
    expect(animate).not.toHaveBeenCalled();
  });

  it("stops a running animation if the player turns on reduced motion", () => {
    const setting = fakeMotionSetting(false);
    render(<Box trigger="go" />);
    setting.set(true);
    expect(cancelOf(0)).toHaveBeenCalled();
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("doesn't throw in a browser without the Web Animations API", () => {
    fakeMotionSetting(false);
    removeFakeAnimate();
    expect(() => render(<Box trigger="go" />)).not.toThrow();
  });
});
