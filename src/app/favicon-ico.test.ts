// @vitest-environment node
/**
 * The committed `favicon.ico` still paints the brand mark.
 *
 * ── A DOCUMENTED GAP IS STILL A GAP ─────────────────────────────────────────
 *
 * `e2e/favicon.spec.ts` already said this, in its own words:
 *
 *   "if the brand mark changes, this file does not notice, and that is a known
 *    gap rather than an oversight."
 *
 * The mark changed. Measured 2026-09-20, `src/app/favicon.ico` was still the
 * retired violet tile with its document glyph — 1,783 indigo pixels and ZERO
 * accent pixels at 48px — beside an `icon.svg` that had been rewritten, under
 * a source guard that passed, in a repo where the hole was written down. That
 * is the whole lesson in one file: a comment is not a guard, and naming the
 * risk is what made it feel handled.
 *
 * It is a binary, so no source guard can read it. This one decodes it. The
 * bytes are now a build output — `pnpm icon:favicon` re-renders them from
 * `renderBrandMark`, the same source the Apple and PWA icons use — so a
 * failure here means someone changed the mark and did not rebuild, which is a
 * one-command fix rather than a redrawing.
 *
 * 2026-10-21: the mark changed again, to the brand pack's Folded P — a white
 * P with a cyan fold on a rounded petrol tile — and the previous one (an
 * accent square and trim ticks on an ink tile) joined the retired list below.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CARD } from "@/lib/og";
import { BRAND } from "@/lib/brand";
import { countNear, decodePng, hexToRgb } from "@/lib/png-probe";

const ICO = readFileSync(path.join(process.cwd(), "src/app/favicon.ico"));

const ICO_HEADER_BYTES = 6;
const ICO_ENTRY_BYTES = 16;

/** Every image in the container, decoded. Sizes are read, never assumed. */
function images(): { size: number; png: ReturnType<typeof decodePng> }[] {
  expect(ICO.readUInt16LE(0), "not an ICO: reserved field").toBe(0);
  expect(ICO.readUInt16LE(2), "not an ICO: type field").toBe(1);
  const count = ICO.readUInt16LE(4);

  const out = [];
  for (let i = 0; i < count; i += 1) {
    const at = ICO_HEADER_BYTES + i * ICO_ENTRY_BYTES;
    const size = ICO.readUInt8(at) || 256;
    const length = ICO.readUInt32LE(at + 8);
    const offset = ICO.readUInt32LE(at + 12);
    out.push({
      size,
      png: decodePng(new Uint8Array(ICO.subarray(offset, offset + length))),
    });
  }
  return out;
}

describe("the browser tab icon", () => {
  const decoded = images();

  it("holds the sizes a browser asks for (health check)", () => {
    // Bounded both ways. An empty container would make every colour assertion
    // below vacuously true, and a container of one would quietly stop covering
    // the size that ships in a bookmark bar.
    expect(decoded.map((image) => image.size)).toEqual([16, 32, 48]);
    for (const image of decoded) {
      expect([image.png.width, image.png.height]).toEqual([
        image.size,
        image.size,
      ]);
    }
  });

  it.each(decoded)("$size px is the white P on petrol", ({ png, size }) => {
    // The tile is most of the icon and the P about a fifth of it; the floors
    // are deliberately low — the states being caught are ZERO, which is what
    // the previous ink tile scores for petrol, and a blank or inverted tile
    // for white. Measured 2026-10-21: 186 petrol and 30 white of 256 at
    // 16px, 1,715 and 406 of 2,304 at 48px.
    const area = size * size;
    const petrol = countNear(png, hexToRgb(BRAND.petrol), 40);
    const white = countNear(png, hexToRgb(BRAND.white), 40);
    expect(petrol, `${size}px has no petrol tile`).toBeGreaterThan(area / 3);
    expect(white, `${size}px has no white P`).toBeGreaterThan(area / 12);
    expect(white, `${size}px is more white than a P`).toBeLessThan(area / 3);
  });

  it.each(decoded.filter((image) => image.size >= 32))(
    "$size px keeps the cyan fold",
    ({ png }) => {
      // At 16px the fold is antialiased into its neighbours — one pixel
      // within tolerance, measured — so it is held from 32 up (6 at 32px,
      // 27 at 48px).
      expect(countNear(png, hexToRgb(BRAND.cyan), 40)).toBeGreaterThan(2);
    },
  );

  it.each(decoded)("$size px paints none of the retired marks", ({ png }) => {
    // The violet document tile, and then the registration mark: the dark
    // accent square and ticks on an ink tile.
    for (const hex of ["#8b5cf6", "#6366f1", "#3b82f6"]) {
      expect(countNear(png, hexToRgb(hex), 40), hex).toBe(0);
    }
    expect(countNear(png, hexToRgb(CARD.accent), 24), "accent square").toBe(0);
    expect(countNear(png, hexToRgb(BRAND.ink), 24), "ink tile").toBe(0);
  });

  it("is the same mark the other icon surfaces render", () => {
    // Not a pixel comparison — 16px rasterisation is not 512px rasterisation.
    // The binding is that one command regenerates this from the same function
    // `apple-icon.tsx` and the manifest icons call, so there is no second
    // drawing to keep in step.
    const script = readFileSync(
      path.join(process.cwd(), "scripts/build-favicon.ts"),
      "utf8",
    );
    expect(script).toContain('renderBrandMark(size, "favicon")');
    const pkg = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(pkg.scripts["icon:favicon"]).toContain("scripts/build-favicon.ts");
  });
});
