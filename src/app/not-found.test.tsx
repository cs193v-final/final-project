// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MODES } from "@/components/modes";
import { PAGE_TITLE } from "@/components/ui/styles";
import { GAME_NAME } from "@/site";
import NotFound, { metadata } from "./not-found";

// Spec for the 404 page (#229): a mistyped URL says so in our words, with a
// way home and into practice, instead of Next's default page.

describe("the 404 page", () => {
  it("says the page wasn't found, in the heading and the tab title", () => {
    render(<NotFound />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Page not found");
    expect(metadata.title).toBe(`Page not found · ${GAME_NAME}`);
  });

  it("links home and to practice, with the home screen's link text", () => {
    render(<NotFound />);
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    const practice = MODES.find((mode) => mode.id === "practice");
    expect(practice?.status).toBe("available");
    if (practice?.status !== "available") return;
    expect(screen.getByRole("link", { name: practice.cta })).toHaveAttribute("href", practice.href);
  });

  it("shows an empty monitor above the title as decoration, hidden from screen readers (#183)", () => {
    render(<NotFound />);
    const art = screen.getByText("Nothing in frame").closest('[aria-hidden="true"]');
    expect(art).not.toBeNull();
    // Before the title, so the heading is still what a screen reader meets first.
    expect(art!.compareDocumentPosition(screen.getByRole("heading", { level: 1 })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).className).toBe(PAGE_TITLE);
  });

  it("is the page's main content, so the header stays a separate landmark", () => {
    render(<NotFound />);
    expect(screen.getByRole("main")).toContainElement(screen.getByRole("heading", { level: 1 }));
  });
});
