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
import { execSync } from "node:child_process";
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

/**
 * The sticky header and everything that gets scrolled under it.
 *
 * Survey item 4, observed rather than inferred: #51's contrast audit had to
 * occlusion-test every text run because elements scrolled into view landed
 * beneath `header.sticky.top-0` and it measured the HEADER's background as
 * theirs. A keyboard user meets the same defect without the instrument — Tab
 * to a control below the fold and the browser parks it under the chrome.
 *
 * The fix is one `scroll-padding-top` on the scroll port, and the thing worth
 * guarding is not the declaration but the RELATIONSHIP: the padding has to
 * track the header's real height. Both now read one token, so a header that
 * grows moves the padding with it. A test that only asserted "some padding
 * exists" would pass through the exact drift it exists to prevent.
 */
describe("nothing lands underneath the sticky header", () => {
  const header = readFileSync(
    path.join(ROOT, "src/components/layout/site-header.tsx"),
    "utf8",
  );

  it("declares the header height as a token, once", () => {
    expect(css).toMatch(/--sf-header-h:\s*[\d.]+rem/);
  });

  it("sizes the header FROM that token, not from a literal", () => {
    // `h-14` and `--sf-header-h: 3.5rem` are the same number written twice;
    // this is what makes them the same number written once.
    expect(header).toContain("h-[var(--sf-header-h)]");
    expect(header).not.toMatch(/Container className="[^"]*\bh-\d+\b/);
  });

  it("reserves scroll room DERIVED from the same token", () => {
    const padding = /scroll-padding-top:\s*calc\(var\(--sf-header-h\)/;
    expect(
      padding.test(css),
      "scroll-padding-top must be computed from --sf-header-h; a typed length " +
        "silently stops matching the header the day the header changes",
    ).toBe(true);
  });

  it("keeps the per-anchor scroll margins that predate it", () => {
    // `scroll-padding-top` covers every target; the section anchors' own
    // `scroll-mt-*` is additive and harmless. Removing them is a separate
    // decision, not a side effect of this one — pinned so it stays deliberate.
    const anchors = execSync(
      "git ls-files src/components src/app | grep -E '\.tsx$'",
      { encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean)
      .filter((file) =>
        readFileSync(path.join(ROOT, file), "utf8").includes("scroll-mt-"),
      );
    expect(anchors.length).toBeGreaterThan(0);
  });
});
