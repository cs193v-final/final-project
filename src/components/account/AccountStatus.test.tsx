// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The header reads the URL in the browser (#134). Stand in for Next's router
// with the jsdom location, which the tests set with history.replaceState.
vi.mock("next/navigation", () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const { AccountStatusView } = await import("./AccountStatus");

const at = (url: string) => window.history.replaceState(null, "", url);

beforeEach(() => at("/"));

describe("AccountStatusView", () => {
  it("offers Log in when nobody is logged in", () => {
    render(<AccountStatusView user={null} />);
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("button", { name: "Log out" })).toBeNull();
  });

  it.each([
    ["/account", "/login?next=%2Faccount"],
    ["/play?game=abc123", "/login?next=%2Fplay%3Fgame%3Dabc123"],
    ["/register", "/login"],
    ["/login?next=%2Faccount", "/login"],
  ])("on %s, Log in comes back to the page afterwards: %s", (url, href) => {
    at(url);
    render(<AccountStatusView user={null} />);
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", href);
  });

  it("shows the username, linking to the account page, and a Log out button (not a link)", () => {
    render(<AccountStatusView user={{ id: "u1", username: "Ethan" }} />);
    expect(screen.getByRole("link", { name: "Ethan" })).toHaveAttribute("href", "/account");
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /log out/i })).toBeNull();
  });
});

describe("the one-time login confirmation (#134)", () => {
  it.each([
    ["login", "Logged in as Ethan."],
    ["signup", "Account created. Logged in as Ethan."],
  ])("?welcome=%s says %j in a status region, then leaves the URL", async (welcome, text) => {
    at(`/play?game=abc&welcome=${welcome}`);
    render(<AccountStatusView user={{ id: "u1", username: "Ethan" }} />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(text));
    expect(window.location.pathname + window.location.search).toBe("/play?game=abc");
  });

  it("says nothing on an ordinary visit or for an unknown value", () => {
    at("/?welcome=admin");
    render(<AccountStatusView user={{ id: "u1", username: "Ethan" }} />);
    expect(screen.getByRole("status")).toHaveTextContent("");
  });
});
