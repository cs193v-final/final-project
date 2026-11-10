import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { canZoomOut, handleZoomOutClick, ZoomOutButton, type ZoomOutButtonProps } from "./ZoomOutButton";

// These run in Node without a DOM: markup through renderToStaticMarkup, and
// clicks through handleZoomOutClick, which is exactly what the button's onClick calls.

const round = (revealLevel: number, state: ZoomOutButtonProps["round"]["state"] = "playing") => ({
  state,
  revealLevel,
  maxRevealLevel: 3,
});

function click(r: ZoomOutButtonProps["round"]) {
  const onZoomOut = vi.fn();
  const preventDefault = vi.fn();
  handleZoomOutClick(r, onZoomOut, { preventDefault });
  return { onZoomOut, preventDefault };
}

const html = (r: ZoomOutButtonProps["round"]) => renderToStaticMarkup(<ZoomOutButton round={r} onZoomOut={() => {}} />);

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
    const { onZoomOut, preventDefault } = click(round(0));
    expect(onZoomOut).toHaveBeenCalledTimes(1);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("does nothing at the full image, but stays focusable (aria-disabled, not disabled)", () => {
    const { onZoomOut, preventDefault } = click(round(3));
    expect(onZoomOut).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalled();

    const full = html(round(3));
    expect(full).toContain('aria-disabled="true"');
    expect(full).not.toMatch(/\sdisabled(=|\s|>)/);
    expect(full).toContain("Showing the full image");
  });

  it("does nothing once the round is over", () => {
    expect(click(round(1, "correct")).onZoomOut).not.toHaveBeenCalled();
    expect(html(round(1, "correct"))).toContain('aria-disabled="true"');
  });

  it("is a real, labelled button whose hint says how many steps are left", () => {
    const out = html(round(1));
    expect(out).toMatch(/<button type="button"[^>]*>Zoom out<\/button>/);
    expect(out).toContain('aria-disabled="false"');
    const describedBy = out.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(describedBy).toBeTruthy();
    expect(out).toContain(`<span id="${describedBy}"`);
    expect(out).toContain("2 steps left");
    expect(html(round(2))).toContain("1 step left");
  });

  it("gives each button its own hint id", () => {
    const two = renderToStaticMarkup(
      <>
        <ZoomOutButton round={round(0)} onZoomOut={() => {}} />
        <ZoomOutButton round={round(0)} onZoomOut={() => {}} />
      </>,
    );
    const ids = [...two.matchAll(/aria-describedby="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });
});
