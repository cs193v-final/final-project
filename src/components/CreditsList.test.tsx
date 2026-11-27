// @vitest-environment jsdom
// Spec for the photo credits list (#239): practice photos, then past dailies
// newest first, each with its author, license and a link to the photo's page.
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CreditsList } from "./CreditsList";

const practice = [{ source: "Jane Doe, via Wikimedia Commons", license: "CC BY-SA 4.0", url: "https://commons.example/a" }];
const dailies = [
  { date: "2026-12-02", title: "Birds", credits: [{ source: "Cy, via Wikimedia Commons", license: "CC BY 2.0, cropped", url: "https://commons.example/b" }] },
  {
    date: "2026-12-01",
    title: "Fruit",
    credits: [
      { source: "Ann", license: "CC0 1.0" },
      { source: "Bo", license: "CC BY 3.0, cropped", url: "javascript:alert(1)" },
    ],
  },
];

describe("CreditsList", () => {
  it("lists the practice photos, then each past daily under its day and title", () => {
    render(<CreditsList practice={practice} dailies={dailies} />);
    expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual(["Practice", "Wed, Dec 2: Birds", "Tue, Dec 1: Fruit"]);
    const birds = screen.getByRole("region", { name: "Wed, Dec 2: Birds" });
    expect(within(birds).getByText("Cy, via Wikimedia Commons")).toBeInTheDocument();
    expect(within(birds).getByText(/CC BY 2.0, cropped/)).toBeInTheDocument();
    expect(within(birds).getByRole("link", { name: "Photo page" })).toHaveAttribute("href", "https://commons.example/b");
  });

  it("links only to https pages, and shows a credit without a link as text", () => {
    render(<CreditsList practice={practice} dailies={dailies} />);
    const fruit = screen.getByRole("region", { name: "Tue, Dec 1: Fruit" });
    expect(within(fruit).queryByRole("link")).toBeNull();
    expect(within(fruit).getByText("Ann")).toBeInTheDocument();
  });

  it("says when daily credits will appear, before any daily has been played", () => {
    render(<CreditsList practice={practice} dailies={[]} />);
    expect(screen.getByText(/the day after they.re played/)).toBeInTheDocument();
  });
});
