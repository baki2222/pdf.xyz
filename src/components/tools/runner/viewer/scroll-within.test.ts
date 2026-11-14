// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { scrollWithin } from "./scroll-within";

/**
 * `scrollWithin` moves its container and nothing else. The window staying
 * put in a real browser is proved by e2e/pdf-viewer.spec.ts ("the web page
 * stays put"); here, the arithmetic, on boxes jsdom cannot lay out.
 */

function box(top: number, height: number, left = 0, width = 100) {
  return {
    top,
    bottom: top + height,
    left,
    right: left + width,
    height,
    width,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function setup(elTop: number, elHeight = 20, elLeft = 0, elWidth = 50) {
  const container = document.createElement("div");
  const el = document.createElement("span");
  container.append(el);
  Object.defineProperty(container, "clientHeight", { value: 200 });
  Object.defineProperty(container, "clientWidth", { value: 100 });
  container.getBoundingClientRect = () => box(100, 200);
  el.getBoundingClientRect = () => box(elTop, elHeight, elLeft, elWidth);
  container.scrollTop = 1_000;
  container.scrollLeft = 0;
  const intoView = vi.fn();
  el.scrollIntoView = intoView;
  const windowScroll = vi
    .spyOn(window, "scrollTo")
    .mockImplementation(() => {});
  return { container, el, intoView, windowScroll };
}

describe("scrollWithin", () => {
  it("centres an element below the view, by scrolling the container only", () => {
    const { container, el, intoView, windowScroll } = setup(500);
    scrollWithin(container, el, "center");
    // Element centre 510, view centre 200: 310 down.
    expect(container.scrollTop).toBe(1_310);
    expect(intoView).not.toHaveBeenCalled();
    expect(windowScroll).not.toHaveBeenCalled();
  });

  // Compare PDF's Next change (2026-11-14): "nearest" left the change's
  // heading on the list's bottom edge with every row of it below the edge.
  it("start: puts an element at the top of the view, from below or above it", () => {
    const below = setup(310);
    scrollWithin(below.container, below.el, "start");
    // Element top 310, view top 100: 210 down, where nearest moves 30.
    expect(below.container.scrollTop).toBe(1_210);
    const above = setup(40);
    scrollWithin(above.container, above.el, "start");
    expect(above.container.scrollTop).toBe(940);
    const inside = setup(150);
    scrollWithin(inside.container, inside.el, "start");
    expect(inside.container.scrollTop).toBe(1_050);
  });

  it("nearest: brings an element above the view to its top, below it to its bottom", () => {
    const above = setup(40);
    scrollWithin(above.container, above.el, "nearest");
    expect(above.container.scrollTop).toBe(940);
    const below = setup(310);
    scrollWithin(below.container, below.el, "nearest");
    expect(below.container.scrollTop).toBe(1_030);
  });

  it("nearest: an element already in view moves nothing (control)", () => {
    const { container, el } = setup(150);
    scrollWithin(container, el, "nearest");
    expect(container.scrollTop).toBe(1_000);
    expect(container.scrollLeft).toBe(0);
  });

  it("brings an element right of the view in, horizontally", () => {
    const { container, el } = setup(150, 20, 130, 30);
    scrollWithin(container, el, "nearest");
    expect(container.scrollLeft).toBe(60);
  });
});
