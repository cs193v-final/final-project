// @vitest-environment jsdom
// The password-change and delete-account forms on /account (#234): labelled
// fields on the shared controls, the server's errors on their fields, a
// confirmation that's announced, and no browser dialog for deleting.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DeleteFormState, PasswordFormState } from "@/app/account/actions";
import { buttonClass, CARD, TEXT_INPUT } from "@/components/ui/styles";

import { ChangePasswordForm, DeleteAccountForm } from "./AccountSettings";

const neverPassword = () => new Promise<PasswordFormState>(() => {});
const neverDelete = () => new Promise<DeleteFormState>(() => {});

async function submit(buttonName: string) {
  await act(async () => {
    fireEvent.submit(screen.getByRole("button", { name: buttonName }).closest("form")!);
  });
}

describe("ChangePasswordForm", () => {
  it("is a card titled in the display face, like the page (#183)", () => {
    render(<ChangePasswordForm action={neverPassword} />);
    expect(screen.getByRole("region", { name: "Change your password" }).className).toContain(CARD);
    expect(screen.getByRole("heading", { level: 2, name: "Change your password" }).className).toContain("font-display");
  });

  it("has a named section with labelled password boxes on the shared controls", () => {
    render(<ChangePasswordForm action={neverPassword} />);
    expect(screen.getByRole("region", { name: "Change your password" })).toBeInTheDocument();
    for (const name of ["Current password", "New password"]) {
      const box = screen.getByLabelText(name);
      expect(box).toHaveAttribute("type", "password");
      expect(box.className).toContain(TEXT_INPUT);
    }
    expect(screen.getByLabelText("Current password")).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByLabelText("New password")).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByLabelText("New password")).toHaveAccessibleDescription(/other browsers will be logged out/i);
  });

  it("shows the server's errors on their fields and its message in an alert", async () => {
    const action = vi.fn(async () => ({ errors: { password: "Passwords are at least 10 characters." }, message: "Too many attempts." }));
    render(<ChangePasswordForm action={action} />);
    await submit("Change password");
    expect(screen.getByLabelText("New password")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("New password")).toHaveAccessibleDescription(/at least 10 characters/);
    expect(screen.getByRole("alert")).toHaveTextContent("Too many attempts.");
  });

  it("announces that it worked", async () => {
    render(<ChangePasswordForm action={async () => ({ errors: {}, done: true })} />);
    expect(screen.getByRole("status")).toHaveTextContent("");
    await submit("Change password");
    expect(screen.getByRole("status")).toHaveTextContent(/password changed/i);
  });

  it("keeps the button focusable but inactive while it's sent", async () => {
    // Resolved at the end: React holds back every action's update while any
    // action is still pending, so a never-ending one would stall later tests.
    let finish: (state: PasswordFormState) => void = () => {};
    render(<ChangePasswordForm action={() => new Promise((resolve) => (finish = resolve))} />);
    await submit("Change password");
    expect(screen.getByRole("button", { name: "Please wait…" })).toHaveAttribute("aria-disabled", "true");
    await act(async () => finish({ errors: {} }));
    expect(screen.getByRole("button", { name: "Change password" })).toHaveAttribute("aria-disabled", "false");
  });
});

describe("DeleteAccountForm", () => {
  it("is its own card, marked by a rust edge, with a secondary (not primary) button (#183)", () => {
    render(<DeleteAccountForm action={neverDelete} username="ethan" />);
    const section = screen.getByRole("region", { name: "Delete your account" });
    expect(section.className).toContain(CARD);
    expect(section.className).toContain("border-l-rust");
    expect(screen.getByRole("button", { name: "Delete my account" }).className).toBe(buttonClass("secondary"));
  });

  it("says what's deleted, and asks for the password and the username typed again", () => {
    render(<DeleteAccountForm action={neverDelete} username="ethan" />);
    const section = screen.getByRole("region", { name: "Delete your account" });
    expect(section).toHaveTextContent(/every game you played.*leaderboard.*can't be undone/i);
    expect(screen.getByLabelText("Current password")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("Type your username to confirm")).toHaveAccessibleDescription(/Your username is ethan/);
  });

  it("sends the fields to the server, without a browser confirm dialog", async () => {
    const sent: Record<string, unknown> = {};
    const action = vi.fn(async (_state: DeleteFormState, data: FormData): Promise<DeleteFormState> => {
      for (const name of ["current", "confirm"]) sent[name] = data.get(name);
      return { errors: { confirm: "That isn't your username." } };
    });
    render(<DeleteAccountForm action={action} username="ethan" />);
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "my password" } });
    fireEvent.change(screen.getByLabelText("Type your username to confirm"), { target: { value: "ethan" } });
    await submit("Delete my account");
    expect(action).toHaveBeenCalledOnce();
    expect(sent).toMatchObject({ current: "my password", confirm: "ethan" });
    expect(await screen.findByText("That isn't your username.")).toBeInTheDocument();
    expect(screen.getByLabelText("Type your username to confirm")).toHaveAttribute("aria-invalid", "true");
  });
});
