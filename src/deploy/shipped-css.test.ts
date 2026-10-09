// @vitest-environment node
/**
 * The stylesheet the build SHIPS: no raw palette colour nothing renders, and
 * a weight it may not outgrow.
 *
 * `raw-palette.test.ts` holds the SOURCE: the class strings of shipped
 * components. That is the author's artifact, and Tailwind does not read only
 * the author's class strings — it generates a utility for any class-shaped
 * word in any file it scans: tests, docblocks, data nothing renders. On
 * 2026-10-09 the first build after the raw-palette fix still shipped five of
 * the utilities that fix retired (the new guard's own docblock named them
 * whole), plus sixteen gradient stops from category data `ToolIcon` stopped
 * painting long ago. Each is dead CSS a reader downloads, and each is a raw
 * colour a later component could pick up and render on the wrong scheme.
 * The reader receives the built stylesheet, so this reads that.
 *
 * THE RULE: every class selector in a stylesheet a prerendered page links is
 * read back to its class name, and a raw palette colour among them must be
 * one the source allowance renders (a page of paper, ink on it) or a
 * processing mode's ink, read from `processing.ts`. Nothing is typed here.
 *
 * THE WEIGHT: the stylesheet is on every page, so the redesign budgets it —
 * 15.0 KB gzip-9 (spec G.1: 12.0 at the start of the programme plus a 3.0
 * allowance). Measured 12.3 KB on 2026-10-09 after the token package.
 *
 * Runs under `pnpm test:bundle` (it needs `.next`), never `pnpm test`.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { prerenderedPages } from "../../scripts/page-weight";
import { processingMeta } from "@/lib/tools/processing";
import { RAW_COLOUR_ALLOWANCE, rawColours } from "@/tests/raw-palette";

const NEXT_DIR = path.join(process.cwd(), ".next");
const CEILING_GZ_KB = 15.0;

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

/** Every class a stylesheet's selectors name, unescaped (`bg-ok\/10` → `bg-ok/10`). */
export function selectorClasses(css: string): Set<string> {
  const out = new Set<string>();
  const withoutBodies = css.replace(/\{[^{}]*\}/g, "{}");
  for (const m of withoutBodies.matchAll(/\.((?:\\.|[\w-])+)/g))
    out.add(m[1]!.replace(/\\(.)/g, "$1"));
  return out;
}

/** The raw colours the source is allowed to render. */
function allowed(): Set<string> {
  return new Set([
    ...Object.values(RAW_COLOUR_ALLOWANCE).flatMap((c) => Object.keys(c)),
    ...Object.values(processingMeta).map((m) => m.hue.ink),
  ]);
}

/** Raw colours a stylesheet ships that nothing is allowed to render. */
export function strayColours(css: string, allow: Set<string>): string[] {
  return [...selectorClasses(css)]
    .flatMap((cls) => rawColours(cls))
    .filter((cls) => !allow.has(cls))
    .sort();
}

describe("the shipped stylesheet", () => {
  const built = existsSync(path.join(NEXT_DIR, "server", "app"));

  it("has a build to measure", () => {
    expect(built, "no .next — run `pnpm build` first (CI does)").toBe(true);
  });

  it("health check: pages link stylesheets, every one is on disk, and the reader sees classes", () => {
    if (!built) return;
    const sheets = shippedStylesheets();
    expect(sheets.length).toBeGreaterThanOrEqual(1);
    expect(sheets.filter((f) => !existsSync(f))).toEqual([]);
    const classes = new Set(
      sheets.flatMap((f) => [...selectorClasses(readFileSync(f, "utf8"))]),
    );
    // Hundreds of utilities in a real build; a reader that lost them finds none.
    expect(classes.size).toBeGreaterThan(300);
    expect(classes).toContain("bg-panel");
    // The allowance is really in the build, so the rule below is not vacuous.
    expect(classes).toContain("bg-white");
  });

  it("positive control: a retired utility in built CSS is reported, an allowed one is not", () => {
    // The retired classes are spelled with "·" for their first hyphen and
    // restored here: Tailwind scans this file too, and would ship them.
    const css =
      `.divide·white\\/5>:not(:last-child){border-color:#fff}.bg-white{background:#fff}.hover\\:ring·white\\/50:hover{--x:1}`.replaceAll(
        "·",
        "-",
      );
    expect(strayColours(css, new Set(["bg-white"]))).toEqual(
      ["divide·white/5", "ring·white/50"].map((c) => c.replaceAll("·", "-")),
    );
  });

  it("ships no raw palette colour that nothing is allowed to render", () => {
    if (!built) return;
    const allow = allowed();
    const stray = shippedStylesheets().flatMap((f) =>
      strayColours(readFileSync(f, "utf8"), allow),
    );
    expect(
      [...new Set(stray)],
      "Tailwind generated these from a class-shaped word in some scanned file; find it (often a comment, a fixture or dead data) and stop spelling it whole",
    ).toEqual([]);
  });

  it(`weighs at most ${CEILING_GZ_KB.toFixed(1)} KB gzipped`, () => {
    if (!built) return;
    const gz = shippedStylesheets().reduce(
      (sum, f) => sum + gzipSync(readFileSync(f), { level: 9 }).byteLength,
      0,
    );
    expect(gz / 1024).toBeGreaterThan(1);
    expect(gz / 1024).toBeLessThanOrEqual(CEILING_GZ_KB);
  });
});
