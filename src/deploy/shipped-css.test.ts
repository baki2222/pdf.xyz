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
 * WP-12 (2026-10-21), in gzip-9 bytes against the ceiling's 15,360: main at
 * c3767ea3 shipped 15,211 (149 left). Blocking the English words that are
 * also bare utilities (`@source not inline(…)` in globals.css — "grayscale",
 * "blur", "shadow" and fifteen more that no page renders as a class, the
 * filter family's thirteen registered properties with them) took it to
 * 14,687 (-524). The signature and motion layer then added 541: 15,228,
 * 132 left. The ceiling did NOT move. The blocklist is a claim — "no page
 * renders these" — so it is tested below, on every prerendered page.
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
import { droppedClasses } from "@/tests/class-conflicts";

const NEXT_DIR = path.join(process.cwd(), ".next");
const GLOBALS = path.join(process.cwd(), "src", "app", "globals.css");
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

/**
 * The utilities `globals.css` tells Tailwind never to generate
 * (`@source not inline("…")`): English words a scanned file spells that are
 * also bare utilities — "grayscale" in the catalogue, "blur" in an event
 * name. Read from the stylesheet, never typed here.
 */
export function blockedUtilities(css: string): string[] {
  return [...css.matchAll(/@source\s+not\s+inline\(\s*"([^"]*)"\s*\)/g)]
    .flatMap((m) => m[1]!.split(/\s+/))
    .filter(Boolean);
}

/** Class tokens a page's HTML renders, in its `class` attributes. */
export function renderedClasses(html: string): Set<string> {
  const out = new Set<string>();
  for (const m of html.matchAll(/\sclass="([^"]*)"/g))
    for (const c of m[1]!.split(/\s+/)) if (c) out.add(c);
  return out;
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

  it("a blocked utility is generated for nobody: no page renders one, and the build ships none", () => {
    if (!built) return;
    const blocked = blockedUtilities(readFileSync(GLOBALS, "utf8"));
    // Health: the list is read (18 words on 2026-10-21). A reader that lost
    // it would find nothing blocked and pass both halves below.
    expect(blocked.length).toBeGreaterThanOrEqual(10);
    expect(blocked).toContain("grayscale");
    const pages = prerenderedPages(NEXT_DIR);
    expect(pages.length).toBeGreaterThan(20);
    // A class a page renders and Tailwind was told never to write would
    // render as NOTHING — the blocklist is a claim that no page uses these.
    const rendered = pages.flatMap((html) => {
      const page = readFileSync(
        path.join(NEXT_DIR, "server", "app", html),
        "utf8",
      );
      return blocked
        .filter((cls) => renderedClasses(page).has(cls))
        .map((cls) => `${html}: ${cls}`);
    });
    expect(
      rendered,
      "a page renders a class globals.css blocks — remove it from the @source not inline(…) list",
    ).toEqual([]);
    // …and the block works: the build ships none of them.
    const shipped = new Set(
      shippedStylesheets().flatMap((f) => [
        ...selectorClasses(readFileSync(f, "utf8")),
      ]),
    );
    expect(blocked.filter((cls) => shipped.has(cls))).toEqual([]);
  });

  it("positive control: the blocklist reader and the class reader each see what they claim", () => {
    const fixture = `@source not "../x";
@source not inline("blur  invert");
@source not inline("shadow");`;
    expect(blockedUtilities(fixture)).toEqual(["blur", "invert", "shadow"]);
    const html = `<div class="flex blur"></div><p data-class="invert"></p><span class=" shadow-lg  shadow "></span>`;
    expect([...renderedClasses(html)].sort()).toEqual([
      "blur",
      "flex",
      "shadow",
      "shadow-lg",
    ]);
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

/**
 * Every element the build prerenders carries at most one class per Tailwind
 * family. `cn()` joins and does not merge since 2026-10-29 (src/lib/utils.ts),
 * so two classes from one family — a base `font-medium` and a caller's
 * `font-semibold` — are decided by the stylesheet's order, not by what was
 * written last. The source scan (src/lib/cn-conflicts.test.ts) cannot read a
 * variable or a prop handed further on; this reads what a reader receives,
 * every class attribute of every page, with the same oracle.
 */
describe("the shipped markup", () => {
  const built = existsSync(path.join(NEXT_DIR, "server", "app"));

  it("positive control: a base class and its override in one attribute are reported", () => {
    expect(
      classConflicts(
        `<a class="font-medium h-9 font-semibold"></a><b class="text-fg text-display-1"></b>`,
      ),
    ).toEqual([
      { dropped: ["font-medium"], classes: "font-medium h-9 font-semibold" },
    ]);
  });

  it("no prerendered element carries two classes from one family", () => {
    if (!built) return;
    const pages = prerenderedPages(NEXT_DIR);
    let attributes = 0;
    const found: { page: string; dropped: string[]; classes: string }[] = [];
    for (const page of pages) {
      const html = readFileSync(
        path.join(NEXT_DIR, "server", "app", page),
        "utf8",
      );
      attributes += [...html.matchAll(/\sclass="/g)].length;
      for (const hit of classConflicts(html)) found.push({ page, ...hit });
    }
    // Health check: 99 pages and 35,735 class attributes on 2026-10-29.
    expect(pages.length).toBeGreaterThanOrEqual(60);
    expect(attributes).toBeGreaterThan(10_000);
    expect(
      found.filter(
        (a, i) => found.findIndex((b) => b.classes === a.classes) === i,
      ),
      "an element ships two classes from one family — cn() does not merge; write one class per family per branch",
    ).toEqual([]);
  });
});

function classConflicts(
  html: string,
): { dropped: string[]; classes: string }[] {
  const out: { dropped: string[]; classes: string }[] = [];
  for (const m of html.matchAll(/\sclass="([^"]*)"/g)) {
    const dropped = droppedClasses(m[1]!);
    if (dropped.length > 0) out.push({ dropped, classes: m[1]! });
  }
  return out;
}
