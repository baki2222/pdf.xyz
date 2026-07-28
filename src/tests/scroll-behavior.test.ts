// @vitest-environment node
/**
 * Static guard for a subtle, user-visible regression.
 *
 * We ship `html { scroll-behavior: smooth }` for in-page anchor links. Up to
 * Next 15 the App Router silently forced `scroll-behavior: auto` around its own
 * navigation scroll, so route changes still jumped instantly. Next 16 dropped
 * that implicit override: an app must now opt in with `data-scroll-behavior`
 * on `<html>` (see `next/dist/shared/lib/router/utils/disable-smooth-scroll`).
 *
 * Without the opt-in, every navigation glides to the top over several hundred
 * milliseconds — the destination page keeps moving under the pointer. A click
 * that lands mid-glide is dropped *entirely*: press and release resolve to
 * different elements, so the browser fires no `click` at all and the button
 * simply does nothing. That is how the workspace → Compress hand-off e2e went
 * red (the batch runner stayed pristine-idle after a verified click on "Compress
 * 2 PDFs"), and a real user clicking during the glide loses the same click.
 *
 * So the two files must agree: smooth scrolling in the stylesheet requires the
 * attribute in the layout.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const css = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
const layout = readFileSync(path.join(ROOT, "src/app/layout.tsx"), "utf8");

/** `scroll-behavior: smooth` declared outside the reduced-motion reset. */
function declaresSmoothScroll(stylesheet: string): boolean {
  const reduced = stylesheet.indexOf("prefers-reduced-motion");
  const base = reduced === -1 ? stylesheet : stylesheet.slice(0, reduced);
  return /scroll-behavior:\s*smooth/.test(base);
}

describe("smooth scrolling and the App Router", () => {
  it("declares smooth scrolling for anchor navigation", () => {
    expect(declaresSmoothScroll(css)).toBe(true);
  });

  it("opts into Next's instant navigation scroll whenever it does", () => {
    // Guard the guard: if the stylesheet ever stops declaring smooth scrolling,
    // this pairing is moot and should be revisited rather than silently pass.
    expect(declaresSmoothScroll(css)).toBe(true);
    expect(layout).toMatch(/data-scroll-behavior=["']smooth["']/);
  });

  it("keeps the reduced-motion reset that neutralizes it", () => {
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(css.slice(css.indexOf("prefers-reduced-motion"))).toMatch(
      /scroll-behavior:\s*auto/,
    );
  });
});
