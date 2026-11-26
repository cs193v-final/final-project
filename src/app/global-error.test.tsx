// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GAME_NAME } from "@/site";
import GlobalError from "./global-error";

// Spec for the global error page (#229): an error in the root layout itself.
// It replaces the layout, so it renders the whole document, here into
// `document` as React does for a full page, and works without the header.

const internalError = () => Object.assign(new Error("relation \"users\" does not exist"), { digest: "2208815571" });

/** Render it as the whole page, the way Next does when the root layout fails. */
function renderPage(retry: () => void = () => {}) {
  return render(<GlobalError error={internalError()} retry={retry} />, { container: document });
}

afterEach(() => {
  // A full-document render leaves <html> attributes behind for the next test.
  document.documentElement.removeAttribute("lang");
});

describe("the global error page", () => {
  it("renders its own document: language, title and body, without the root layout", () => {
    renderPage();
    expect(document.documentElement).toHaveAttribute("lang", "en");
    expect(document.title).toBe(`Something went wrong · ${GAME_NAME}`);
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.queryByRole("banner")).not.toBeInTheDocument(); // no site header
  });

  it("says something went wrong, and offers to try again", async () => {
    const retry = vi.fn();
    renderPage(retry);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Something went wrong");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("links home and to practice with plain links, which load a fresh page", () => {
    renderPage();
    for (const [name, href] of [["Home", "/"], ["Start practice", "/play"]] as const) {
      const link = screen.getByRole("link", { name });
      expect(link).toHaveAttribute("href", href);
      expect(link.tagName).toBe("A");
    }
  });

  it("never shows the error's message or digest", () => {
    renderPage();
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("does not exist");
    expect(text).not.toContain("2208815571");
  });
});
