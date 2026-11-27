// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Spec for pausing the drifting sky (#183, WCAG 2.2.2): one button, at the
// end of the page, that pauses and resumes the clouds and is remembered.

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-clouds-paused");
  vi.resetModules();
});

async function setup() {
  // A fresh module each time, so the remembered choice is read from storage.
  const { CloudsToggle } = await import("./CloudsToggle");
  return render(<CloudsToggle />);
}

const toggle = () => screen.getByRole("button", { name: "Pause clouds" });

describe("CloudsToggle", () => {
  it("starts with the clouds moving", async () => {
    await setup();
    expect(toggle()).toHaveAttribute("aria-pressed", "false");
    expect(document.documentElement).not.toHaveAttribute("data-clouds-paused");
  });

  it("pauses the clouds, and resumes them on a second press", async () => {
    await setup();
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement).toHaveAttribute("data-clouds-paused");
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-pressed", "false");
    expect(document.documentElement).not.toHaveAttribute("data-clouds-paused");
  });

  it("remembers the choice in this browser", async () => {
    const { unmount } = await setup();
    fireEvent.click(toggle());
    unmount();
    await setup();
    expect(toggle()).toHaveAttribute("aria-pressed", "true");
  });

  it("sits in a footer landmark, so it comes after the page's content", async () => {
    await setup();
    expect(screen.getByRole("contentinfo")).toContainElement(toggle());
  });
});
