// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button, ButtonLink, FOCUS_RING, PrototypeNotice, SectionHeading, TextInput, TextLink, type ButtonVariant } from "./controls";

// Spec for the shared controls (#89): the same look and behavior on every
// screen, with visible keyboard focus and targets of at least 24 × 24 px.

const VARIANTS: ButtonVariant[] = ["primary", "secondary", "quiet"];

describe("Button", () => {
  it("is a plain button by default, so it never submits a form by accident", () => {
    render(<Button>Play again</Button>);
    expect(screen.getByRole("button", { name: "Play again" })).toHaveAttribute("type", "button");
  });

  it("calls onClick when pressed with the mouse or the keyboard", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Play again</Button>);
    await user.click(screen.getByRole("button", { name: "Play again" }));
    await user.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("when disabled, says so to screen readers and ignores presses, but keeps keyboard focus", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Zoom out
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Zoom out" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled(); // still in the tab order

    await user.tab();
    expect(button).toHaveFocus();
    await user.keyboard("{Enter}");
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("when disabled, doesn't submit its form either", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit" disabled>
          Guess
        </Button>
      </form>,
    );
    await user.click(screen.getByRole("button", { name: "Guess" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("isn't marked disabled when it's enabled", () => {
    render(<Button>Skip</Button>);
    expect(screen.getByRole("button", { name: "Skip" })).not.toHaveAttribute("aria-disabled");
  });

  it('says aria-disabled="false" when it can be disabled but isn\'t right now, and then works', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled={false} onClick={onClick}>
        Zoom out
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Zoom out" });
    expect(button).toHaveAttribute("aria-disabled", "false");
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("passes a ref to the button, so focus can move to it (e.g. Next image after a round)", () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Next image</Button>);
    expect(ref.current).toBe(screen.getByRole("button", { name: "Next image" }));
    ref.current?.focus();
    expect(screen.getByRole("button", { name: "Next image" })).toHaveFocus();
  });

  it("keeps extra classes from the caller, e.g. for layout", () => {
    render(<Button className="self-start">Next image</Button>);
    expect(screen.getByRole("button", { name: "Next image" })).toHaveClass("self-start");
  });
});

describe("ButtonLink and TextLink", () => {
  it("are links to their page, named by their text", () => {
    render(
      <>
        <ButtonLink href="/play">Start practice</ButtonLink>
        <TextLink href="/">← Home</TextLink>
      </>,
    );
    expect(screen.getByRole("link", { name: "Start practice" })).toHaveAttribute("href", "/play");
    expect(screen.getByRole("link", { name: "← Home" })).toHaveAttribute("href", "/");
  });
});

describe("TextInput", () => {
  it("is a text box named by its label, and passes on what it's given", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <>
        <label htmlFor="guess">What is it?</label>
        <TextInput id="guess" autoComplete="off" onChange={onChange} className="flex-1" />
      </>,
    );
    const box = screen.getByRole("textbox", { name: "What is it?" });
    expect(box).toHaveAttribute("type", "text");
    expect(box).toHaveAttribute("autocomplete", "off");
    expect(box).toHaveClass("flex-1");
    await user.type(box, "x");
    expect(onChange).toHaveBeenCalled();
  });

  it("passes a ref to the box, so focus can move to it (e.g. after a form error)", () => {
    const ref = createRef<HTMLInputElement>();
    render(<TextInput ref={ref} aria-label="Username" />);
    expect(ref.current).toBe(screen.getByRole("textbox", { name: "Username" }));
    ref.current?.focus();
    expect(ref.current).toHaveFocus();
  });
});

describe("every control meets the same focus and size rules (WCAG 2.2 AA)", () => {
  function controls() {
    render(
      <>
        {VARIANTS.map((variant) => (
          <Button key={variant} variant={variant}>
            {`button ${variant}`}
          </Button>
        ))}
        {VARIANTS.map((variant) => (
          <ButtonLink key={variant} href="/" variant={variant}>
            {`link ${variant}`}
          </ButtonLink>
        ))}
        <TextLink href="/">text link</TextLink>
        <TextInput aria-label="text box" />
      </>,
    );
    return [...screen.getAllByRole("button"), ...screen.getAllByRole("link"), screen.getByRole("textbox")];
  }

  it("shows the same visible focus ring on every control (2.4.7 Focus Visible)", () => {
    for (const control of controls()) {
      for (const cls of FOCUS_RING.split(" ")) expect(control).toHaveClass(cls);
    }
  });

  it("gives every control a minimum height of at least 24 px (2.5.8 Target Size)", () => {
    // jsdom has no layout, so check the min-height class: min-h-6 is 24 px, min-h-11 is 44 px.
    for (const control of controls()) {
      expect(control.className).toMatch(/\bmin-h-(6|10|11)\b/u);
    }
  });
});

describe("SectionHeading", () => {
  it("names its section for screen readers", () => {
    render(
      <section aria-labelledby="how-to-play">
        <SectionHeading id="how-to-play">How to play</SectionHeading>
      </section>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "How to play" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "How to play" })).toBeInTheDocument();
  });
});

describe("PrototypeNotice", () => {
  it("shows its label as text, so placeholder data is marked in words, not color alone", () => {
    render(<PrototypeNotice>Prototype: 3 practice images.</PrototypeNotice>);
    expect(screen.getByText("Prototype: 3 practice images.")).toBeInTheDocument();
  });
});
