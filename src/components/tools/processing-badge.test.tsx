// @vitest-environment jsdom
/**
 * Where a tool runs is told by a word and a SHAPE — never by colour alone.
 *
 * WHAT SHIPPED. The processing badge paired the mode word with a 6px dot
 * whose only difference between modes was its hue: emerald, blue, cyan,
 * violet. Wherever the word is not shown (a filter, a legend, a tight row)
 * that dot is the whole message, and a reader who cannot tell those hues
 * apart gets four identical dots (WCAG 1.4.1, use of colour). AI's violet
 * was also 2.7:1 on the dark wash, under the 3:1 non-text floor (1.4.11).
 *
 * THE RULES, read from the rendered badge and the one table that defines a
 * mode's look (`processing.ts`):
 *  1. every mode renders a shape, and no two modes render the same geometry;
 *  2. the shape is decorative to assistive tech (the word carries the
 *     meaning) and takes its colour through `currentColor`, so a text-colour
 *     ink drives it and forced-colours mode can override it;
 *  3. the word is still rendered beside it;
 *  4. every mode's ink clears 3:1 on every ground the badge sits on, in both
 *     colour schemes — measured from Tailwind's own palette and the grounds
 *     the stylesheet declares, never from a hex typed here.
 *
 * The mode set is DERIVED from the table, so a fifth mode is held to all four
 * rules the day it exists.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { contrastRatio, parseColor, type Rgb } from "@/lib/a11y/contrast";
import { parseCss, type CssBlock } from "@/lib/motion/contract";
import { processingMeta } from "@/lib/tools/processing";
import type { ProcessingMode } from "@/lib/tools/types";
import { oklchToRgb, tailwindColour } from "@/tests/tailwind-palette";
import { ModeShape, ProcessingBadge } from "./processing-badge";

const MODES = Object.keys(processingMeta) as ProcessingMode[];

const dom = (markup: string) =>
  new DOMParser().parseFromString(markup, "text/html");

/** Each mode's drawn geometry under a renderer — its SVG's children — or "". */
function geometries(render: (mode: ProcessingMode) => ReactElement): string[] {
  return MODES.map(
    (mode) =>
      dom(renderToStaticMarkup(render(mode))).querySelector("svg")?.innerHTML ??
      "",
  );
}

/** Every mode draws something, and no two draw the same thing. */
const distinctShapes = (drawn: string[]) =>
  drawn.every((g) => g.length > 0) && new Set(drawn).size === drawn.length;

describe("every mode has a shape of its own", () => {
  it("health check: the table holds the four modes the catalogue uses", () => {
    expect(MODES.length).toBeGreaterThanOrEqual(4);
  });

  it("no two modes draw the same geometry", () => {
    expect(
      distinctShapes(geometries((mode) => <ModeShape mode={mode} />)),
    ).toBe(true);
  });

  it("positive control: the dot as it shipped, and one circle in four colours, are both caught", () => {
    // What shipped: a span, one circle for every mode — no shape at all.
    expect(
      distinctShapes(
        geometries(() => <span className="size-1.5 rounded-full" />),
      ),
    ).toBe(false);
    // The near miss: real SVGs, differing only in colour.
    expect(
      distinctShapes(
        geometries((mode) => (
          <svg className={mode}>
            <circle r="3" />
          </svg>
        )),
      ),
    ).toBe(false);
  });

  it.each(MODES)(
    "%s: decorative, coloured by its ink through currentColor",
    (mode) => {
      const svg = dom(
        renderToStaticMarkup(<ModeShape mode={mode} />),
      ).querySelector("svg")!;
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.getAttribute("focusable")).toBe("false");
      expect(svg.getAttribute("fill")).toBe("currentColor");
      const ink = processingMeta[mode].hue.ink;
      expect(
        ink,
        "the ink must be a text colour, or currentColor ignores it",
      ).toMatch(/^text-[a-z]+-\d{2,3}$/);
      expect(svg.getAttribute("class")?.split(/\s+/)).toContain(ink);
    },
  );

  it.each(MODES)("%s: the word is rendered beside the shape", (mode) => {
    const doc = dom(renderToStaticMarkup(<ProcessingBadge mode={mode} />));
    expect(doc.querySelector("svg")).not.toBeNull();
    expect(doc.body.textContent).toContain(processingMeta[mode].short);
  });
});

/* ------------------------------------------------------------------ *
 *  4. Non-text contrast, in both schemes
 * ------------------------------------------------------------------ */

const CSS = readFileSync(
  path.join(process.cwd(), "src/app/globals.css"),
  "utf8",
);

function* walk(block: CssBlock): Generator<CssBlock> {
  yield block;
  for (const child of block.children) yield* walk(child);
}

/** The grounds a badge can sit on — canvas, panel, wash — per scheme. */
function grounds(): { name: string; rgb: Rgb }[] {
  const out: { name: string; rgb: Rgb }[] = [];
  for (const b of walk(parseCss(CSS))) {
    if (
      !b.prelude
        .split(",")
        .map((s) => s.trim())
        .includes(".theme-paper")
    )
      continue;
    const scheme = b.ancestors.some((a) =>
      /prefers-color-scheme\s*:\s*dark/.test(a),
    )
      ? "dark"
      : "light";
    for (const d of b.declarations) {
      const role = /^--sf-(canvas|panel|wash)$/.exec(d.property)?.[1];
      if (role)
        out.push({ name: `${scheme} ${role}`, rgb: parseColor(d.value)! });
    }
  }
  return out;
}

const NON_TEXT = 3;

describe("every mode's ink is visible on every ground (WCAG 1.4.11)", () => {
  const GROUNDS = grounds();

  it("health check: three grounds per scheme, all parsed", () => {
    expect(GROUNDS.map((g) => g.name).sort()).toEqual([
      "dark canvas",
      "dark panel",
      "dark wash",
      "light canvas",
      "light panel",
      "light wash",
    ]);
  });

  it("positive control: the palette reader reproduces published sRGB red", () => {
    // oklch(62.8% 0.2577 29.23) is #ff0000 (CSS Color 4).
    const red = oklchToRgb(0.628, 0.2577, 29.23);
    expect(Math.round(red.r)).toBe(255);
    expect(Math.round(red.g)).toBeLessThanOrEqual(1);
    expect(Math.round(red.b)).toBeLessThanOrEqual(1);
  });

  it("positive control: the violet the AI dot shipped in fails on the dark wash", () => {
    const wash = GROUNDS.find((g) => g.name === "dark wash")!.rgb;
    expect(contrastRatio(tailwindColour("violet-600"), wash)).toBeLessThan(
      NON_TEXT,
    );
  });

  it.each(MODES)("%s", (mode) => {
    const ink = tailwindColour(
      processingMeta[mode].hue.ink.replace(/^text-/, ""),
    );
    const failing = GROUNDS.map((g) => ({
      ground: g.name,
      ratio: contrastRatio(ink, g.rgb),
    }))
      .filter((r) => r.ratio < NON_TEXT)
      .map((r) => `${r.ground} ${r.ratio.toFixed(2)}:1`);
    expect(failing).toEqual([]);
  });
});
