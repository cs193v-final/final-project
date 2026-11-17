// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ModePicker } from "./ModePicker";
import { MODES, type GameMode } from "./modes";

// Spec for #50: the home screen lists the ways to play. Only built modes are
// links; the rest are clearly marked in text, never just greyed out.

function setup(modes?: readonly GameMode[]) {
  render(<ModePicker modes={modes} />);
  const picker = screen.getByRole("region", { name: "Choose a mode" });
  const cards = within(picker).getAllByRole("listitem");
  const card = (title: string) => {
    const found = cards.find((c) => within(c).queryByRole("heading", { name: title }));
    if (!found) throw new Error(`no card titled ${title}`);
    return found;
  };
  return { picker, cards, card };
}

describe("ModePicker", () => {
  it("lists the ways to play: Daily, Stanford and Practice, in that order", () => {
    const { cards } = setup();
    expect(cards.map((c) => within(c).getByRole("heading").textContent)).toEqual([
      "Daily challenge",
      "Stanford",
      "Practice",
    ]);
  });

  it("doesn't list the leaderboard as a mode, since you don't play it", () => {
    const { picker } = setup();
    expect(within(picker).queryByText(/leaderboard/i)).not.toBeInTheDocument();
  });

  it("links Practice to the practice game", () => {
    const { card } = setup();
    expect(within(card("Practice")).getByRole("link", { name: "Start practice" })).toHaveAttribute("href", "/play");
  });

  it("marks modes that aren't built as Coming soon, with no link to a dead end", () => {
    const { card } = setup();
    for (const title of ["Daily challenge", "Stanford"]) {
      expect(within(card(title)).getByText("Coming soon")).toBeInTheDocument();
      expect(within(card(title)).queryByRole("link")).not.toBeInTheDocument();
    }
    expect(within(card("Practice")).queryByText("Coming soon")).not.toBeInTheDocument();
  });

  it("doesn't list custom lobbies yet (stretch goal, #67)", () => {
    setup();
    expect(screen.queryByText(/lobb/i)).not.toBeInTheDocument();
  });

  it("puts only playable modes in the keyboard tab order", async () => {
    const user = userEvent.setup();
    setup();
    await user.tab();
    expect(screen.getByRole("link", { name: "Start practice" })).toHaveFocus();
    await user.tab();
    expect(document.body).toHaveFocus();
  });

  it("turns a mode into a link once it's switched to available", () => {
    const { card } = setup(
      MODES.map((m): GameMode =>
        m.id === "daily" ? { ...m, status: "available", href: "/daily", cta: "Play today's" } : m,
      ),
    );
    expect(within(card("Daily challenge")).getByRole("link", { name: "Play today's" })).toHaveAttribute(
      "href",
      "/daily",
    );
    expect(within(card("Daily challenge")).queryByText("Coming soon")).not.toBeInTheDocument();
  });
});

describe("MODES", () => {
  it("gives every mode a unique id, a title and a description", () => {
    const ids = MODES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const mode of MODES) {
      expect(mode.title.trim()).not.toBe("");
      expect(mode.description.trim()).not.toBe("");
    }
  });

  it("points every available mode at a page in this app, with link text", () => {
    for (const mode of MODES) {
      if (mode.status !== "available") continue;
      expect(mode.href).toMatch(/^\/[a-z0-9/-]*$/);
      expect(mode.cta.trim()).not.toBe("");
    }
  });
});
