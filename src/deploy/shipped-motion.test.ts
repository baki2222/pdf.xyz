// @vitest-environment node
/**
 * The motion contract, held on the stylesheet the build SHIPS rather than on
 * the source it was written from.
 *
 * `motion-contract.test.ts` reads `src/**\/*.css` and the class strings of
 * shipped sources. That is the author's artifact, and it missed the case this
 * file exists for: Tailwind generates utilities from EVERY file it scans —
 * tests, comments, docblocks — so on 2026-10-09 the contract's own docblock
 * and its own test fixture each put an ungated scroll-timeline utility into
 * the built CSS. Exactly the defect the contract forbids, and invisible to it.
 * The reader receives the built stylesheet, so this reads that.
 *
 * The set is DERIVED: every stylesheet a prerendered page links, not a
 * directory listing (a stale CSS file left in `.next` is not served by any
 * page and is not the reader's).
 *
 * Runs under `pnpm test:bundle` (it needs `.next`), never `pnpm test`.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { prerenderedPages } from "../../scripts/page-weight";
import { resetCoverage, timelineViolations } from "@/lib/motion/contract";

const NEXT_DIR = path.join(process.cwd(), ".next");

/** The stylesheets prerendered pages link, as files on disk. */
function shippedStylesheets(): string[] {
  const files = new Set<string>();
  for (const html of prerenderedPages(NEXT_DIR)) {
    const source = readFileSync(
      path.join(NEXT_DIR, "server", "app", html),
      "utf8",
    );
    for (const m of source.matchAll(/\/_next\/(static\/css\/[^"'?]+\.css)/g))
      files.add(path.join(NEXT_DIR, m[1]!));
  }
  return [...files].sort();
}

describe("the shipped stylesheet keeps the motion contract", () => {
  const built = existsSync(path.join(NEXT_DIR, "server", "app"));

  it("has a build to measure", () => {
    expect(built, "no .next — run `pnpm build` first (CI does)").toBe(true);
  });

  it("health check: pages link stylesheets, and every one is on disk", () => {
    if (!built) return;
    const sheets = shippedStylesheets();
    expect(sheets.length).toBeGreaterThanOrEqual(1);
    expect(sheets.filter((f) => !existsSync(f))).toEqual([]);
  });

  it("no scroll-driven timeline ships outside @supports and no-preference", () => {
    if (!built) return;
    for (const file of shippedStylesheets()) {
      expect(
        timelineViolations(readFileSync(file, "utf8")),
        `${path.basename(file)} ships an ungated animation-timeline. If it is a bracketed utility, some scanned file (a test or a comment counts) spells the class out`,
      ).toEqual([]);
    }
  });

  it("the complete reduced-motion reset survives the build", () => {
    if (!built) return;
    const css = shippedStylesheets()
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    expect(resetCoverage(css).missing).toEqual([]);
  });

  it("positive control: the minified shape of the defect is caught", () => {
    // The utility as Tailwind emitted it, minified, assembled from parts so
    // this file cannot ship it in turn.
    const property = ["animation", "timeline"].join("-");
    const minified = `.select-none{user-select:none}.\\[${property}\\:view\\(\\)\\]{${property}:view()}.x{color:red}`;
    expect(timelineViolations(minified)).toHaveLength(1);
    expect(
      timelineViolations(
        `@supports (${property}:view()){@media (prefers-reduced-motion:no-preference){.y{${property}:view()}}}`,
      ),
    ).toEqual([]);
  });

  it("positive control: the reset as the minifier writes it is read, and a missing line is caught", () => {
    const reset = (delay: string) =>
      `@media (prefers-reduced-motion:reduce){*,:after,:before{scroll-behavior:auto!important;transition-duration:.001ms!important;transition-delay:0s!important;animation-duration:.001ms!important;animation-iteration-count:1!important;${delay}animation-timeline:auto!important}html{scroll-behavior:auto}::view-transition-group(*){animation:none!important}::view-transition-old(*){animation:none!important}::view-transition-new(*){animation:none!important}}`;
    expect(
      resetCoverage(reset("animation-delay:0s!important;")).missing,
    ).toEqual([]);
    expect(resetCoverage(reset("")).missing).toEqual(["animation-delay"]);
  });
});
