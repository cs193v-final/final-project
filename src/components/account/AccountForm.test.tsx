// @vitest-environment jsdom
// The log-in and sign-up form (#53) on the shared controls (#183): labelled
// fields, the errors the server returns, and a submit button that stays
// focusable while the form is on its way.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AccountFormState } from "@/app/account/actions";
import { buttonClass, TEXT_INPUT } from "@/components/ui/styles";

import { AccountForm } from "./AccountForm";

vi.mock("next/link", () => ({
  default: ({ href, ...rest }: { href: string } & Record<string, unknown>) => <a href={href} {...rest} />,
}));

const never = () => new Promise<AccountFormState>(() => {});

describe("AccountForm", () => {
  it("uses the shared text boxes and primary button", () => {
    render(<AccountForm mode="login" action={never} />);
    for (const name of ["Username", "Password"]) expect(screen.getByLabelText(name).className).toContain(TEXT_INPUT);
    expect(screen.getByRole("button", { name: "Log in" }).className).toBe(buttonClass("primary"));
  });

  it("links to the other form, keeping where to go next", () => {
    render(<AccountForm mode="register" action={never} next="/leaderboard" />);
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login?next=%2Fleaderboard");
  });

  it("shows the server's errors on their fields", async () => {
    const action = vi.fn(async () => ({ username: "x", errors: { username: "Enter your username." }, message: "Too many attempts." }));
    render(<AccountForm mode="login" action={action} />);
    await act(async () => {
      fireEvent.submit(screen.getByRole("button", { name: "Log in" }).closest("form")!);
    });
    expect(screen.getByLabelText("Username")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Username")).toHaveAccessibleDescription(/Enter your username\./);
    expect(screen.getByRole("alert")).toHaveTextContent("Too many attempts.");
  });

  it("keeps the button focusable but inactive while the form is sent", async () => {
    render(<AccountForm mode="register" action={never} />);
    const button = screen.getByRole("button", { name: "Create account" });
    button.focus();
    await act(async () => {
      fireEvent.submit(button.closest("form")!);
    });
    const waiting = screen.getByRole("button", { name: "Please wait…" });
    expect(waiting).toHaveAttribute("aria-disabled", "true");
    expect(waiting).not.toBeDisabled();
    expect(waiting).toHaveFocus();
  });
});
