// @vitest-environment node
/**
 * The palette exists in THREE copies, and only one of them is the source.
 *
 * `globals.css` defines it. Two other files must restate it in literal hex
 * because neither can read a stylesheet:
 *
 *   - `layout.tsx`'s `viewport.themeColor` — the browser paints this behind
 *     overscroll and in the tab strip, so a mismatch reads as a flash of the
 *     previous design on every rubber-band scroll;
 *   - `global-error.tsx` — the root error boundary replaces the layout that
 *     imports the stylesheet, so it inlines the whole palette to render at all.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * Both copies were kept in sync by a COMMENT. `layout.tsx` says "These MUST
 * track --sf-canvas in globals.css"; `global-error.tsx` said its hexes were
 * "the same values as `.theme-paper` in globals.css". On 2026-09-20 the
 * prepress redesign changed every one of those values, and the error
 * boundary's eight hexes did not move — leaving the one page a user sees when
 * everything else has failed as the only surface still painting the retired
 * cream design, under a docblock that claimed it matched. Nothing was red.
 * `browser-count-surfaces` renders those components with `css: false`; the
 * bundle budget cannot see a colour; the contrast audit never visits
 * `global-error` because it cannot be crashed on demand.
 *
 * A comment is not a guard (CLAUDE.md rule 2). This is the guard: it parses
 * the values out of the stylesheet and asserts the copies equal them, per
 * scheme. Nothing here hard-codes a colour, so a future palette change moves
 * all three or fails here.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const CSS = read("src/app/globals.css");
const LAYOUT = read("src/app/layout.tsx");
const GLOBAL_ERROR = read("src/app/global-error.tsx");

/**
 * The light block is `:root, .theme-paper { … }` at top level; the dark one is
 * the same selector nested inside `@media (prefers-color-scheme: dark)`. Both
 * are located by their OPENING SELECTOR and read to the matching close, so a
 * reordered stylesheet moves the parser with it rather than silently matching
 * the wrong scope (`.theme-ink` sits between them and must never be read here).
 */
function paperBlock(scheme: "light" | "dark"): string {
  const media = CSS.indexOf("@media (prefers-color-scheme: dark)");
  expect(media, "no dark-scheme media block in globals.css").toBeGreaterThan(0);
  const region = scheme === "light" ? CSS.slice(0, media) : CSS.slice(media);
  const start = region.indexOf(".theme-paper {");
  expect(
    start,
    `no \`.theme-paper\` block in the ${scheme} region of globals.css`,
  ).toBeGreaterThan(-1);
  const end = region.indexOf("\n}", start);
  const nested = region.indexOf("\n  }", start);
  const close =
    end === -1 ? nested : nested === -1 ? end : Math.min(end, nested);
  expect(
    close,
    `unterminated \`.theme-paper\` block (${scheme})`,
  ).toBeGreaterThan(start);
  return region.slice(start, close);
}

function token(scheme: "light" | "dark", name: string): string {
  const block = paperBlock(scheme);
  // Parsed with string operations, not a regular expression, deliberately:
  // the first version of this helper was written through a shell heredoc and
  // its s escapes collapsed to plain `s` in the template literal, so the
  // pattern could never match and the guard reported the stylesheet as having
  // no tokens at all. An instrument that cannot see is worse than none.
  const prefix = `--sf-${name}:`;
  const line = block
    .split(String.fromCharCode(10))
    .map((raw) => raw.trim())
    .find((raw) => raw.startsWith(prefix));
  expect(
    line,
    `--sf-${name} is not defined in the ${scheme} .theme-paper block`,
  ).toBeTruthy();
  const value = line!
    .slice(prefix.length)
    .replace(";", "")
    .trim()
    .toLowerCase();
  expect(
    value.startsWith("#"),
    `--sf-${name} (${scheme}) is ${value}, which is not a hex literal`,
  ).toBe(true);
  return value;
}

/** Every `--sf-*` the two copies restate, so the set is not hand-picked twice. */
const MIRRORED = [
  "canvas",
  "fg",
  "muted",
  "faint",
  "invert",
  "fg-invert",
] as const;

describe("the palette's three copies agree", () => {
  it("the stylesheet really defines both schemes (health check)", () => {
    // `[] ⊆ X` is vacuously true: a parser that returned nothing would make
    // every assertion below pass while comparing empty sets.
    for (const scheme of ["light", "dark"] as const) {
      for (const name of MIRRORED) {
        expect(token(scheme, name)).toMatch(/^#[0-9a-f]{3,8}$/);
      }
    }
    // And the two schemes must actually differ, or the parser is reading one
    // block twice — which is exactly how this check would go blind.
    expect(token("light", "canvas")).not.toBe(token("dark", "canvas"));
  });

  it("layout.tsx's themeColor is the canvas, per scheme", () => {
    const colorFor = (scheme: string): string => {
      const marker = `(prefers-color-scheme: ${scheme})`;
      const line = LAYOUT.split(String.fromCharCode(10)).find(
        (raw) => raw.includes(marker) && raw.includes("color:"),
      );
      expect(line, `no ${scheme} themeColor entry in layout.tsx`).toBeTruthy();
      const after = line!.slice(line!.indexOf("color:") + "color:".length);
      const open = after.indexOf(String.fromCharCode(34));
      const close = after.indexOf(String.fromCharCode(34), open + 1);
      return after.slice(open + 1, close).toLowerCase();
    };
    expect(colorFor("light")).toBe(token("light", "canvas"));
    expect(colorFor("dark")).toBe(token("dark", "canvas"));
  });
  it("global-error.tsx inlines the same values, per scheme", () => {
    // The file declares light `--ge-*` first, then overrides them inside its
    // own dark media query; splitting there gives the two scopes.
    const split = GLOBAL_ERROR.indexOf("prefers-color-scheme: dark");
    expect(split, "global-error.tsx declares no dark scheme").toBeGreaterThan(
      0,
    );
    const scopes = {
      light: GLOBAL_ERROR.slice(0, split),
      dark: GLOBAL_ERROR.slice(split),
    };

    const mismatched: string[] = [];
    for (const scheme of ["light", "dark"] as const) {
      for (const name of MIRRORED) {
        const prefix = `--ge-${name}:`;
        const line = scopes[scheme]
          .split(String.fromCharCode(10))
          .map((raw) => raw.trim())
          .find((raw) => raw.startsWith(prefix));
        expect(
          line,
          `global-error.tsx declares no --ge-${name} (${scheme})`,
        ).toBeTruthy();
        const inlined = line!
          .slice(prefix.length)
          .replace(";", "")
          .trim()
          .toLowerCase();
        const source = token(scheme, name);
        if (inlined !== source) {
          mismatched.push(
            `${scheme} --ge-${name}: ${inlined} ≠ globals.css --sf-${name}: ${source}`,
          );
        }
      }
    }
    expect(
      mismatched,
      "the root error boundary is painting a palette the stylesheet no longer defines:\n  " +
        mismatched.join("\n  "),
    ).toEqual([]);
  });

  it("no retired palette literal survives in either copy", () => {
    // The cream/ink values the prepress redesign replaced. Kept as an explicit
    // corpus so the check names what it is looking for; each was measured in
    // global-error.tsx on 2026-09-20 before the fix.
    const RETIRED = [
      "#f7f5f2",
      "#1c1917",
      "#57534e",
      "#6e6862",
      "#171412",
      "#ece7e1",
      "#b3aba2",
      "#9c948b",
    ];
    const offenders: string[] = [];
    for (const [label, source] of [
      ["layout.tsx", LAYOUT],
      ["global-error.tsx", GLOBAL_ERROR],
    ] as const) {
      for (const hex of RETIRED) {
        if (source.toLowerCase().includes(hex))
          offenders.push(`${label}: ${hex}`);
      }
    }
    expect(offenders).toEqual([]);
    // Positive control, through the same predicate: the corpus can still match.
    expect(RETIRED.some((hex) => `background: ${hex};`.includes(hex))).toBe(
      true,
    );
  });
});
