import { describe, expect, it } from "vitest";
import { degrees, PDFDocument } from "pdf-lib";
import {
  displaysLandscape,
  fixtureVerdict,
  orientationVerdict,
  pageOrientations,
  rotationProofPdf,
} from "./rotation-proof";

type Shape = { size: [number, number]; rotate: number };

/** A PDF of these pages, read back through `pageOrientations`: the chain the proofs run. */
async function readBack(pages: readonly Shape[]) {
  const doc = await PDFDocument.create();
  for (const p of pages) doc.addPage(p.size).setRotation(degrees(p.rotate));
  return pageOrientations(await doc.save({ useObjectStreams: false }));
}

/**
 * The fixture, and what Ghostscript 10.00.0 wrote for it in a throwaway
 * container of the production worker image (2026-11-06), /Rotate and MediaBox
 * shape as read back with pdf-lib. Every output page was also rendered with gs
 * at 24 dpi against its input page: BAKED renders the same (mean |diff| at most
 * 0.21 out of 255 through PDF/A, 0.55 through the deep step, which re-encodes
 * the photo); every page the TURNED outputs changed renders with its width and
 * height swapped.
 */
const INPUT: Shape[] = [
  { size: [612, 792], rotate: 90 },
  { size: [792, 612], rotate: 0 },
  { size: [792, 612], rotate: 0 },
  { size: [612, 792], rotate: 0 },
];
/**
 * With -dAutoRotatePages=/None, the PDF/A runner and the deep step alike: the
 * /Rotate 90 portrait came back unrotated landscape, its turn moved into the
 * page content.
 */
const BAKED: Shape[] = [
  { size: [792, 612], rotate: 0 },
  { size: [792, 612], rotate: 0 },
  { size: [792, 612], rotate: 0 },
  { size: [612, 792], rotate: 0 },
];
/** The PDF/A argv with no flag (`/PageByPage`): the three sideways pages turned upright. */
const PDFA_TURNED: Shape[] = [
  { size: [792, 612], rotate: 270 },
  { size: [792, 612], rotate: 90 },
  { size: [792, 612], rotate: 90 },
  { size: [612, 792], rotate: 0 },
];
/** The deep step with no flag (`/All`): every page turned, the upright page 4 included. */
const DEEP_TURNED: Shape[] = [
  { size: [792, 612], rotate: 90 },
  { size: [792, 612], rotate: 90 },
  { size: [792, 612], rotate: 90 },
  { size: [612, 792], rotate: 90 },
];

describe("orientationVerdict — the orientation a reader sees, not how the file spells it", () => {
  it("health check: the fixture reads back as the INPUT these shapes were measured from", async () => {
    expect(await pageOrientations(await rotationProofPdf())).toEqual(
      await readBack(INPUT),
    );
  });

  it("PASSES the measured output with the fix: a page whose /Rotate was baked into its content", async () => {
    // WAS a FAIL. The verdict compared /Rotate and MediaBox shape as stored,
    // and the options proof, run by hand in the production image with the fix
    // in place, printed `FAIL rotation kept: input 90P 0L 0P, output 0L 0L 0P`
    // (the three-page fixture of the time).
    const verdict = orientationVerdict(
      await readBack(INPUT),
      await readBack(BAKED),
    );
    expect(verdict.ok, verdict.detail).toBe(true);
  });

  it.each([
    ["PDF/A, /PageByPage: the sideways pages turned upright", PDFA_TURNED],
    ["the deep step, /All: every page turned", DEEP_TURNED],
  ])("FAILS the measured output without the flag — %s", async (_l, turned) => {
    const verdict = orientationVerdict(
      await readBack(INPUT),
      await readBack(turned),
    );
    expect(verdict.ok, verdict.detail).toBe(false);
  });

  it("FAILS each turned page on its own, the upright page /All turned included", async () => {
    // One page at a time, so the verdict cannot be passing on one page's luck.
    for (const i of INPUT.keys()) {
      const output = INPUT.map((p, j) => (j === i ? DEEP_TURNED[i]! : p));
      const verdict = orientationVerdict(
        await readBack(INPUT),
        await readBack(output),
      );
      expect(verdict.ok, `page ${i + 1}: ${verdict.detail}`).toBe(false);
    }
  });

  it("FAILS a /Rotate set back to 0 with the box left portrait (the options proof's played re-orientation)", async () => {
    const output = [
      { size: [612, 792], rotate: 0 } as Shape,
      ...INPUT.slice(1),
    ];
    expect(
      orientationVerdict(await readBack(INPUT), await readBack(output)).ok,
    ).toBe(false);
  });

  it("FAILS a lost page", async () => {
    expect(
      orientationVerdict(
        await readBack(INPUT),
        await readBack(INPUT.slice(0, -1)),
      ).ok,
    ).toBe(false);
  });

  it("KNOWN BLIND SPOT: a 180° turn keeps the displayed shape, and passes", async () => {
    // Stated as a test, not a comment. The fixture has no upside-down text, so
    // the heuristic has nothing to turn 180°: what it does to this fixture is
    // the 90° turns above, which change the shape. A verdict that sees 180°
    // needs the pages rendered; if one is written, invert this.
    expect(
      orientationVerdict(
        await readBack([{ size: [612, 792], rotate: 0 }]),
        await readBack([{ size: [612, 792], rotate: 180 }]),
      ).ok,
    ).toBe(true);
  });

  it("displaysLandscape is the MediaBox turned by /Rotate", () => {
    const shown = (rotate: number, landscape: boolean) =>
      displaysLandscape({ rotate, landscape });
    expect([0, 90, 180, 270].map((r) => shown(r, false))).toEqual([
      false,
      true,
      false,
      true,
    ]);
    expect([0, 90, 180, 270].map((r) => shown(r, true))).toEqual([
      true,
      false,
      true,
      false,
    ]);
  });
});

describe("fixtureVerdict — the fixture holds every shape the verdict is about", () => {
  it("passes the real fixture", async () => {
    const verdict = fixtureVerdict(
      await pageOrientations(await rotationProofPdf()),
    );
    expect(verdict.ok, verdict.detail).toBe(true);
  });

  it("fails a fixture missing any one of its three shapes", async () => {
    const kinds: [string, (s: Shape) => boolean][] = [
      ["the /Rotate 90 portrait", (s) => s.rotate === 90],
      ["the landscapes", (s) => s.rotate === 0 && s.size[0] > s.size[1]],
      ["the plain portrait", (s) => s.rotate === 0 && s.size[0] < s.size[1]],
    ];
    for (const [name, isKind] of kinds) {
      const without = INPUT.filter((s) => !isKind(s));
      // Health check: the filter removed something, and not everything.
      expect(without.length, name).toBeLessThan(INPUT.length);
      expect(without.length, name).toBeGreaterThan(0);
      const verdict = fixtureVerdict(await readBack(without));
      expect(verdict.ok, `without ${name}: ${verdict.detail}`).toBe(false);
    }
  });
});
