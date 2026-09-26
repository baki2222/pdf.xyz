import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withoutComments } from "@/lib/tools/copy-surface";
import {
  RASTER_RESOLUTIONS,
  lowerResolutionThan,
  rasterCapNote,
  zipFailureFallback,
} from "./pdf-to-image";
import { RASTER_MAX_DEVICE_PX, rasterPageScale } from "./render-utils";

/**
 * "Print · 300 DPI" is a promise about the pixels. The rasterizer keeps both
 * sides of a page under RASTER_MAX_DEVICE_PX, so a page longer than
 * 5000 / 300 = 16.7 in comes out BELOW the DPI the chip and the result summary
 * named — tabloid at ~294, A2 at ~213, ARCH D at ~138 — and nothing said so.
 * The clamp happened inside `renderDimensions`, which returned a scale and no
 * verdict, so no layer above it COULD say so.
 *
 * The fix makes the engine report its own decision (`dpi`, `dpiCapped` on
 * every RasterPage), and this file checks that decision against a second,
 * independent computation from physical paper sizes — a constant cannot be
 * checked by the structure around it, only by a bound it did not write.
 */

/** ISO 216 and ANSI/ARCH paper sizes, in PDF points (1/72 in). */
const PAPER: Record<string, readonly [number, number]> = {
  Letter: [612, 792],
  Legal: [612, 1008],
  Tabloid: [792, 1224],
  A4: [595.28, 841.89],
  A3: [841.89, 1190.55],
  A2: [1190.55, 1683.78],
  A1: [1683.78, 2383.94],
  "ARCH D": [1728, 2592],
};

describe("rasterPageScale — the engine reports the DPI it actually renders at", () => {
  it("A2 at Print is capped near 213 DPI; Letter at Print is not capped (control)", () => {
    const print = RASTER_RESOLUTIONS.find((r) => r.id === "print")!;
    const [a2w, a2h] = PAPER.A2!;
    const a2 = rasterPageScale(a2w, a2h, print.dpi);
    expect(a2.dpiCapped).toBe(true);
    expect(Math.floor(a2.dpi)).toBe(213);

    const [lw, lh] = PAPER.Letter!;
    const letter = rasterPageScale(lw, lh, print.dpi);
    expect(letter.dpiCapped).toBe(false);
    expect(letter.dpi).toBeCloseTo(print.dpi, 9);
  });

  it("for every preset and paper size, `dpiCapped` is exactly 'the requested DPI would exceed the cap'", () => {
    let capped = 0;
    let uncapped = 0;
    for (const res of RASTER_RESOLUTIONS) {
      for (const [name, [w, h]] of Object.entries(PAPER)) {
        for (const [pw, ph] of [
          [w, h],
          [h, w],
        ] as const) {
          const got = rasterPageScale(pw, ph, res.dpi);
          // The independent bound, from inches and dots alone.
          const longestInches = Math.max(pw, ph) / 72;
          const wanted = longestInches * res.dpi;
          const label = `${name} ${pw}x${ph} at ${res.label}`;
          expect(got.dpiCapped, label).toBe(wanted > RASTER_MAX_DEVICE_PX);
          expect(
            Math.floor(Math.max(pw, ph) * got.scale),
            label,
          ).toBeLessThanOrEqual(RASTER_MAX_DEVICE_PX);
          expect(got.dpi, label).toBeCloseTo(got.scale * 72, 9);
          if (got.dpiCapped) {
            capped += 1;
            expect(got.dpi, label).toBeLessThan(res.dpi);
            expect(got.dpi * longestInches, label).toBeCloseTo(
              RASTER_MAX_DEVICE_PX,
              6,
            );
          } else {
            uncapped += 1;
            expect(got.dpi, label).toBeCloseTo(res.dpi, 9);
          }
        }
      }
    }
    // Health: the corpus exercises both branches, or the loop proved nothing.
    expect(capped, "no size was capped").toBeGreaterThan(0);
    expect(uncapped, "no size was left alone").toBeGreaterThan(0);
  });

  it("the rasterizer takes its scale from rasterPageScale, and nothing re-declares the cap", () => {
    // `rasterizePdf` needs a real canvas, which this suite does not have, so
    // the seam is pinned here: the engine calls the helper this file tests,
    // and `RasterPage` REQUIRES `dpi` and `dpiCapped`, so omitting them from
    // the page it builds is a type error, not a silent drop.
    const render = withoutComments(
      readFileSync(path.join(process.cwd(), "src/lib/pdf/render.ts"), "utf8"),
    );
    expect(render).toMatch(/rasterPageScale\s*\(/);
    const pdfDir = path.join(process.cwd(), "src/lib/pdf");
    const declares = readdirSync(pdfDir)
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))
      .filter((f) =>
        /RASTER_MAX_DEVICE_PX\s*=/.test(
          readFileSync(path.join(pdfDir, f), "utf8"),
        ),
      );
    expect(declares).toEqual(["render-utils.ts"]);
  });
});

describe("rasterCapNote — what the result panel says about capped pages", () => {
  const page = (dpi: number, dpiCapped: boolean) => ({ dpi, dpiCapped });

  it("says nothing when no page was capped (control)", () => {
    expect(
      rasterCapNote(
        [page(300, false), page(300, false)],
        300,
        RASTER_MAX_DEVICE_PX,
      ),
    ).toBeNull();
  });

  it("names the count, the lowest DPI actually delivered, and the reason", () => {
    const note = rasterCapNote(
      [page(300, false), page(213.8, true), page(138.9, true)],
      300,
      RASTER_MAX_DEVICE_PX,
    );
    expect(note).toContain("2 of 3 pages");
    expect(note).toContain("300 DPI");
    // Floored, never rounded up: 138.9 is not 139 DPI of pixels.
    expect(note).toContain("as low as 138 DPI");
    expect(note).toContain(RASTER_MAX_DEVICE_PX.toLocaleString("en-US"));
  });

  it("a single capped page reads as that page", () => {
    const note = rasterCapNote([page(213.8, true)], 300, RASTER_MAX_DEVICE_PX);
    expect(note).toMatch(/^This page is too large for 300 DPI/);
    expect(note).toContain("rendered at 213 DPI");
  });
});

describe("zipFailureFallback — only offers what the page can do", () => {
  it("offers a lower preset only when one exists", () => {
    const lowest = RASTER_RESOLUTIONS[0]!;
    expect(lowerResolutionThan(lowest.id)).toBeUndefined();
    for (let i = 1; i < RASTER_RESOLUTIONS.length; i++) {
      expect(lowerResolutionThan(RASTER_RESOLUTIONS[i]!.id)).toBe(
        RASTER_RESOLUTIONS[i - 1],
      );
    }
  });

  it("offers per-page downloads only when every page has a button", () => {
    expect(
      zipFailureFallback({ lowerResolution: "High", everyPageHasButton: true }),
    ).toBe(
      "If it keeps failing, re-render at High resolution for a smaller ZIP, or download the pages one at a time below.",
    );
    expect(
      zipFailureFallback({
        lowerResolution: "High",
        everyPageHasButton: false,
      }),
    ).not.toMatch(/one at a time/);
    expect(
      zipFailureFallback({
        lowerResolution: undefined,
        everyPageHasButton: true,
      }),
    ).toBe("If it keeps failing, download the pages one at a time below.");
    expect(
      zipFailureFallback({
        lowerResolution: undefined,
        everyPageHasButton: false,
      }),
    ).toBeUndefined();
  });
});
