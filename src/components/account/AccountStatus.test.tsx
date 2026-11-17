// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AccountStatusView } from "./AccountStatus";

describe("AccountStatusView", () => {
  it("offers Log in when nobody is logged in", () => {
    render(<AccountStatusView user={null} />);
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("button", { name: "Log out" })).toBeNull();
  });

  it("shows the username, linking to the account page, and a Log out button (not a link)", () => {
    render(<AccountStatusView user={{ id: "u1", username: "Ethan" }} />);
    expect(screen.getByRole("link", { name: "Ethan" })).toHaveAttribute("href", "/account");
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /log out/i })).toBeNull();
  });
});
