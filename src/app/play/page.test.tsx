// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import PlayPage from "./page";

// The game itself streams in at request time (it reads the URL and the owner
// cookie), so render the page's static shell on the server, as Next does, and
// query the HTML like a user would.
beforeEach(() => {
  document.body.innerHTML = renderToString(<PlayPage params={Promise.resolve({})} searchParams={Promise.resolve({})} />);
});

describe("/play", () => {
  it('links home with "Home", the same word as the site header (#80)', () => {
    const link = screen.getByRole("link", { name: "Home" });
    expect(link).toHaveAttribute("href", "/");
    expect(screen.queryByRole("link", { name: /back to start/i })).not.toBeInTheDocument();
  });

  it("shows the arrow but hides it from screen readers, so the link's name is just \"Home\"", () => {
    const link = screen.getByRole("link", { name: "Home" });
    expect(link).toHaveTextContent(/^←\s*Home$/u);
    expect(link.querySelector('[aria-hidden="true"]')).toHaveTextContent("←");
  });

  it("puts the link in the static shell, so it's there while playing and on the final score", () => {
    // The game below it is still loading; the link doesn't wait for it.
    expect(screen.getByText("Loading the game…")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Back" })).toContainElement(screen.getByRole("link", { name: "Home" }));
  });

  it("labels the placeholder point values", () => {
    expect(screen.getByText("Prototype: point values are still being tuned.")).toBeInTheDocument();
  });
});
