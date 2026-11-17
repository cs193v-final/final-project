// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GAME_NAME } from "@/site";
import { SiteHeader } from "./SiteHeader";

// Spec for #50: every screen has a way home. The header is in the root
// layout, so it's on every page; these tests cover what it shows.

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

beforeEach(() => {
  pathname = "/";
});

const siteNav = () => screen.getByRole("navigation", { name: "Site" });
const homeLink = () => within(siteNav()).getByRole("link", { name: `${GAME_NAME} home` });

describe("SiteHeader", () => {
  it("links home from any page, with the game's name as the visible text", () => {
    pathname = "/play";
    render(<SiteHeader />);
    expect(homeLink()).toHaveAttribute("href", "/");
    // Screen readers hear "Zoom Out home"; sighted players see the name.
    expect(homeLink()).toHaveTextContent(GAME_NAME);
  });

  it("marks the home link as the current page on the home screen only", () => {
    const { unmount } = render(<SiteHeader />);
    expect(homeLink()).toHaveAttribute("aria-current", "page");
    unmount();

    pathname = "/play";
    render(<SiteHeader />);
    expect(homeLink()).not.toHaveAttribute("aria-current");
  });

  it("is a banner landmark, so screen-reader users can skip past it", () => {
    render(<SiteHeader />);
    expect(screen.getByRole("banner")).toContainElement(siteNav());
  });

  it("shows nothing for accounts until they exist (#53)", () => {
    render(<SiteHeader />);
    expect(within(siteNav()).getAllByRole("link")).toHaveLength(1);
    expect(screen.queryByText(/log ?in|sign ?in/i)).not.toBeInTheDocument();
  });

  it("shows the account area it's given, for #53 to fill", () => {
    render(<SiteHeader account={<span>Signed in as sam</span>} />);
    expect(within(siteNav()).getByText("Signed in as sam")).toBeInTheDocument();
  });
});
