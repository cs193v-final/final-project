// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ErrorPage from "./error";

// Spec for the error page (#229): an unexpected error in a page offers to try
// again and a way home, and never shows the error, whose message or stack
// could show internal details.

/** An error that looks like what a failed database call could carry. */
function internalError() {
  const error = new Error("connect ECONNREFUSED 10.0.0.5:5432 (user app_owner)");
  return Object.assign(error, { digest: "4011593217" });
}

describe("the error page", () => {
  it("says something went wrong, and offers to try again", async () => {
    const retry = vi.fn();
    render(<ErrorPage error={internalError()} retry={retry} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Something went wrong");

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("links home and to practice", () => {
    render(<ErrorPage error={internalError()} retry={() => {}} />);
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Start practice" })).toHaveAttribute("href", "/play");
  });

  it("never shows the error's message, digest or stack", () => {
    const error = internalError();
    const { container } = render(<ErrorPage error={error} retry={() => {}} />);
    const text = container.textContent ?? "";
    expect(text).not.toContain("ECONNREFUSED");
    expect(text).not.toContain("app_owner");
    expect(text).not.toContain(error.digest);
    const frames = (error.stack ?? "").split("\n").slice(1).map((line) => line.trim());
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) expect(text).not.toContain(frame);
  });

  it("works when what was thrown isn't an Error", () => {
    const { container } = render(<ErrorPage error="secret value" retry={() => {}} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Something went wrong");
    expect(container.textContent).not.toContain("secret value");
  });
});
