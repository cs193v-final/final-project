import type { MouseEvent, ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { canZoomOut, ZoomOutButton, type ZoomOutButtonProps } from "./ZoomOutButton";

// These run in Node without a DOM: markup through renderToStaticMarkup, and
// clicks by calling the button's onClick directly (the component has no hooks).

const round = (revealLevel: number, state: ZoomOutButtonProps["round"]["state"] = "playing") => ({
  state,
  revealLevel,
  maxRevealLevel: 3,
});

type ButtonProps = { onClick: (e: MouseEvent<HTMLButtonElement>) => void; "aria-disabled": boolean };

function button(props: ZoomOutButtonProps): ButtonProps {
  const tree = ZoomOutButton(props) as ReactElement<{ children: ReactElement<ButtonProps>[] }>;
  const [btn] = tree.props.children;
  if (!btn) throw new Error("no button");
  return btn.props;
}

function click(props: ZoomOutButtonProps) {
  const preventDefault = vi.fn();
  button(props).onClick({ preventDefault } as unknown as MouseEvent<HTMLButtonElement>);
  return { preventDefault };
}

describe("canZoomOut", () => {
  it("is true while playing below the full image", () => {
    expect(canZoomOut(round(0))).toBe(true);
    expect(canZoomOut(round(2))).toBe(true);
  });

  it("is false at the full image or once the round is over", () => {
    expect(canZoomOut(round(3))).toBe(false);
    expect(canZoomOut(round(1, "correct"))).toBe(false);
    expect(canZoomOut(round(1, "skipped"))).toBe(false);
  });
});

describe("ZoomOutButton", () => {
  it("asks the round logic to go up one level", () => {
    const onZoomOut = vi.fn();
    click({ round: round(0), onZoomOut });
    expect(onZoomOut).toHaveBeenCalledTimes(1);
  });

  it("does nothing at the full image, but stays focusable (aria-disabled, not disabled)", () => {
    const onZoomOut = vi.fn();
    const { preventDefault } = click({ round: round(3), onZoomOut });
    expect(onZoomOut).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalled();

    const html = renderToStaticMarkup(<ZoomOutButton round={round(3)} onZoomOut={onZoomOut} />);
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toMatch(/\sdisabled(=|\s|>)/);
    expect(html).toContain("Showing the full image");
  });

  it("does nothing once the round is over", () => {
    const onZoomOut = vi.fn();
    click({ round: round(1, "correct"), onZoomOut });
    expect(onZoomOut).not.toHaveBeenCalled();
    expect(button({ round: round(1, "correct"), onZoomOut })["aria-disabled"]).toBe(true);
  });

  it("is a real, labelled button with a hint of the steps left", () => {
    const html = renderToStaticMarkup(<ZoomOutButton round={round(1)} onZoomOut={() => {}} />);
    expect(html).toMatch(/<button type="button"[^>]*>Zoom out<\/button>/);
    expect(html).toContain('aria-disabled="false"');
    expect(html).toContain('aria-describedby="zoom-out-hint"');
    expect(html).toContain('id="zoom-out-hint"');
    expect(html).toContain("2 steps left");
    expect(renderToStaticMarkup(<ZoomOutButton round={round(2)} onZoomOut={() => {}} />)).toContain(
      "1 step left",
    );
  });
});
