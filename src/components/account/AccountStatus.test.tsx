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
    // On the login and sign-up pages, Log in keeps where they were going.
    ["/login?next=%2Faccount", "/login?next=%2Faccount"],
    ["/register?next=%2Faccount", "/login?next=%2Faccount"],
    ["/register?next=%2F%2Fevil.com", "/login"],
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

  it("has the (empty) status region logged out too, so it exists before a login fills it in", () => {
    render(<AccountStatusView user={null} />);
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("keeps the same status element when the header switches to logged in", async () => {
    const { rerender } = render(<AccountStatusView user={null} />);
    const region = screen.getByRole("status");
    at("/?welcome=login");
    rerender(<AccountStatusView user={{ id: "u1", username: "Ethan" }} />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Logged in as Ethan."));
    expect(screen.getByRole("status")).toBe(region);
  });

  it("doesn't show the message again after leaving the page and coming back", async () => {
    at("/?welcome=signup");
    const { rerender } = render(<AccountStatusView user={{ id: "u1", username: "Ethan" }} />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Account created."));
    at("/play");
    rerender(<AccountStatusView user={{ id: "u1", username: "Ethan" }} />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(""));
    at("/");
    rerender(<AccountStatusView user={{ id: "u1", username: "Ethan" }} />);
    // Give the effects a chance to run before checking it stayed empty.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("says nothing on an ordinary visit or for an unknown value", () => {
    at("/?welcome=admin");
    render(<AccountStatusView user={{ id: "u1", username: "Ethan" }} />);
    expect(screen.getByRole("status")).toHaveTextContent("");
  });
});
