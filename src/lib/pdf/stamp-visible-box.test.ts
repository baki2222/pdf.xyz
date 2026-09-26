import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { degrees, PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { cropPdf } from "./crop";
import { addHeaderFooter } from "./header-footer";
import { addPageNumbers } from "./page-numbers";
import { visibleBox } from "./stamp";
import { addWatermark } from "./watermark";
import {
  readAsViewer,
  type SeenPage,
  type SeenRun,
} from "@/tests/pdfjs-viewer";

/**
 * Every text stamp lands inside the part of the page a reader can SEE.
 *
 * The defect (audit 2026-09, header-footer): the three stamping tools sized the
 * page with `page.getSize()`, which is the MediaBox, and anchored at origin
 * 0,0. A viewer shows only CropBox ∩ MediaBox. So on any cropped page —
 * including one cropped by pdf.xyz's own Crop tool — the header sat left of and
 * above the visible area, the footer below it, and the tool said "Header &
 * footer added" over a download with neither. Measured: Letter cropped 72pt,
 * header at x=32/y=750.75 against a visible box of [72 72 540 720].
 *
 * Why nothing caught it: every stamping test used `PDFDocument.create()` pages,
 * whose MediaBox starts at 0,0 and has no CropBox — the one geometry where the
 * two boxes are the same box. The e2e proof uploads an uncropped fixture.
 *
 * WHAT THIS READS: the output bytes, through pdf.js — the reader the product's
 * own viewer and the e2e proof use — never pdf-lib's idea of the page. pdf.js
 * computes the visible box itself (`page.view`) and maps each text run into
 * the viewer's frame with its own viewport, so the geometry here is the
 * consumer's, independently of the code under test. pdf.js 6 also DROPS text
 * outside the view from `getTextContent`, so a stamp in the cropped-away margin
 * does not come back at all; the "every stamp was read back" health check is
 * what turns that disappearance into a red.
 *
 * WHICH TOOLS: discovered, not listed. Any tracked module that calls
 * `placeStamp` or `placeCenteredStamp` is a stamping tool, and must have a
 * driver below — a new one fails the coverage check until it does.
 */

/**
 * The fixture: one page per geometry a real PDF arrives with. Every page but
 * the control has a visible box whose origin is not 0,0, and none of the
 * cropped ones is centred on its MediaBox, so a stamp placed against the wrong
 * box is displaced on both axes rather than merely clipped.
 */
interface Geometry {
  label: string;
  media: [number, number, number, number];
  crop?: [number, number, number, number];
  rotate: 0 | 90 | 180 | 270;
}

const GEOMETRIES: Geometry[] = [
  // Control: the one shape every older test used. Must pass before AND after.
  { label: "plain Letter", media: [0, 0, 612, 792], rotate: 0 },
  // Page 2 is cropped by pdf.xyz's OWN Crop tool below — the composed chain.
  { label: "cropped by cropPdf", media: [0, 0, 612, 792], rotate: 0 },
  {
    label: "offset crop, /Rotate 90",
    media: [0, 0, 612, 792],
    crop: [100, 150, 480, 700],
    rotate: 90,
  },
  {
    label: "offset crop, /Rotate 180",
    media: [0, 0, 612, 792],
    crop: [30, 200, 400, 780],
    rotate: 180,
  },
  {
    label: "offset crop, /Rotate 270",
    media: [0, 0, 612, 792],
    crop: [200, 40, 590, 500],
    rotate: 270,
  },
  {
    label: "MediaBox with an offset origin, no CropBox",
    media: [100, -200, 712, 592],
    rotate: 0,
  },
  {
    // A malformed CropBox that overhangs the MediaBox: a viewer shows the
    // intersection, so anchoring on the raw CropBox is off-page too.
    label: "CropBox larger than the MediaBox",
    media: [0, 0, 612, 792],
    crop: [-300, -300, 400, 500],
    rotate: 0,
  },
];

const CROP_TOOL_PAGE = 1;

async function fixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const g of GEOMETRIES) {
    const page = doc.addPage([612, 792]);
    const [mx1, my1, mx2, my2] = g.media;
    page.setMediaBox(mx1, my1, mx2 - mx1, my2 - my1);
    if (g.crop) {
      const [cx1, cy1, cx2, cy2] = g.crop;
      page.setCropBox(cx1, cy1, cx2 - cx1, cy2 - cy1);
    }
    page.setRotation(degrees(g.rotate));
  }
  return cropPdf(await doc.save(), {
    // Asymmetric on purpose: a symmetric crop keeps the page centre, which
    // would let a MediaBox-centred watermark pass.
    margins: { top: 40, right: 250, bottom: 300, left: 60 },
    pages: [CROP_TOOL_PAGE],
  });
}

const MARGIN = 30;
const FONT = 10;
const NEAR = 1.0; // points; pdf.js and pdf-lib carry different Helvetica metrics

function runOn(page: SeenPage, str: string, label: string): SeenRun {
  const found = page.runs.filter((r) => r.str === str);
  expect(
    found,
    `${label}: pdf.js read back ${found.length} runs of "${str}" (saw ` +
      `${JSON.stringify(page.runs.map((r) => r.str))}). pdf.js drops text ` +
      "outside the visible box, so a missing run is a stamp in the cropped-away margin.",
  ).toHaveLength(1);
  return found[0]!;
}

/** Inside the visible page, reading left-to-right for the viewer. */
function expectVisibleAndLevel(page: SeenPage, run: SeenRun, label: string) {
  const where = `${label}: "${run.str}" at (${run.x.toFixed(1)}, ${run.y.toFixed(1)})→(${run.endX.toFixed(1)}, ${run.endY.toFixed(1)}) on a ${page.width}×${page.height} view`;
  for (const [x, y] of [
    [run.x, run.y],
    [run.endX, run.endY],
  ] as const) {
    expect(x, where).toBeGreaterThanOrEqual(-NEAR);
    expect(x, where).toBeLessThanOrEqual(page.width + NEAR);
    expect(y, where).toBeGreaterThanOrEqual(-NEAR);
    expect(y, where).toBeLessThanOrEqual(page.height + NEAR);
  }
  expect(
    run.endX - run.x,
    `${where} — not reading left to right`,
  ).toBeGreaterThan(0);
  expect(Math.abs(run.endY - run.y), `${where} — not level`).toBeLessThan(NEAR);
}

/**
 * Drive each discovered stamping tool over the fixture and assert, per page,
 * where the reader sees its stamp. Keyed by the module's repo path so the
 * discovery check below can hold the two sets equal.
 */
interface Driver {
  run: (input: Uint8Array) => Promise<Uint8Array>;
  check: (page: SeenPage, index: number, label: string) => void;
}

const WM_SIZE = 24;

const DRIVERS: Record<string, Driver> = {
  "src/lib/pdf/header-footer.ts": {
    run: (input) =>
      addHeaderFooter(input, {
        header: { left: "HL", right: "HR" },
        footer: { center: "FC" },
        fontSize: FONT,
        margin: MARGIN,
      }),
    check: (page, _index, label) => {
      const hl = runOn(page, "HL", label);
      const hr = runOn(page, "HR", label);
      const fc = runOn(page, "FC", label);
      for (const r of [hl, hr, fc]) expectVisibleAndLevel(page, r, label);
      // Anchored to the VISIBLE edges, at exactly the margin.
      expect(hl.x, `${label}: header-left`).toBeCloseTo(MARGIN, 0);
      expect(hr.endX, `${label}: header-right`).toBeCloseTo(
        page.width - MARGIN,
        0,
      );
      expect(hl.y, `${label}: header baseline`).toBeGreaterThan(MARGIN);
      expect(hl.y, `${label}: header baseline`).toBeLessThan(
        MARGIN + FONT + NEAR,
      );
      expect(fc.y, `${label}: footer baseline`).toBeCloseTo(
        page.height - MARGIN,
        0,
      );
      expect((fc.x + fc.endX) / 2, `${label}: footer centre`).toBeCloseTo(
        page.width / 2,
        0,
      );
    },
  },
  "src/lib/pdf/page-numbers.ts": {
    run: (input) =>
      addPageNumbers(input, {
        format: "N{n}",
        position: "bottom-right",
        fontSize: FONT,
        margin: MARGIN,
      }),
    check: (page, index, label) => {
      const run = runOn(page, `N${index + 1}`, label);
      expectVisibleAndLevel(page, run, label);
      expect(run.endX, `${label}: right edge`).toBeCloseTo(
        page.width - MARGIN,
        0,
      );
      expect(run.y, `${label}: baseline`).toBeCloseTo(page.height - MARGIN, 0);
    },
  },
  "src/lib/pdf/watermark.ts": {
    run: (input) =>
      addWatermark(input, "WM", { fontSize: WM_SIZE, rotation: 0 }),
    check: (page, _index, label) => {
      const run = runOn(page, "WM", label);
      expectVisibleAndLevel(page, run, label);
      // The text box's centre is on the visible centre; its baseline midpoint
      // sits half a text-height below it, which is under one font size.
      expect((run.x + run.endX) / 2, `${label}: centre x`).toBeCloseTo(
        page.width / 2,
        0,
      );
      expect(
        Math.abs(run.y - page.height / 2),
        `${label}: centre y`,
      ).toBeLessThan(WM_SIZE);
    },
  },
};

/** The modules that call the placement primitives, from the tracked tree. */
function discoverStampingModules(): string[] {
  const listed = execFileSync(
    "git",
    ["ls-files", "src/**/*.ts", "src/**/*.tsx"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  )
    .split("\n")
    .map((f) => f.trim())
    .filter((f) => f.length > 0 && !f.includes(".test."));
  expect(
    listed.length,
    "git listed implausibly little source — the discovery corpus collapsed",
  ).toBeGreaterThan(200);
  return listed.filter((f) => {
    if (f === "src/lib/pdf/stamp.ts") return false;
    const source = readFileSync(path.join(process.cwd(), f), "utf8");
    return /\bplace(?:Centered)?Stamp\s*\(/.test(source);
  });
}

describe("stamps land inside the visible page (CropBox ∩ MediaBox)", () => {
  it("HEALTH CHECK: every module that places a stamp has a driver here, and only those", () => {
    const discovered = discoverStampingModules().sort();
    // Positive control for the discovery itself: the tool this was found in.
    expect(discovered).toContain("src/lib/pdf/header-footer.ts");
    expect(discovered).toEqual(Object.keys(DRIVERS).sort());
  });

  it("HEALTH CHECK: pdf.js sees the fixture's visible boxes as the geometry intends", async () => {
    const pages = await readAsViewer(await fixture());
    expect(pages).toHaveLength(GEOMETRIES.length);
    // The crop tool really cropped page 2, asymmetrically.
    expect(pages[CROP_TOOL_PAGE]!.view).toEqual([60, 300, 362, 752]);
    // The overhanging CropBox is clipped by pdf.js — the property visibleBox mirrors.
    expect(pages[6]!.view).toEqual([0, 0, 400, 500]);
    expect(pages[5]!.view).toEqual([100, -200, 712, 592]);
    // Rotated pages display with swapped sides.
    expect([pages[2]!.width, pages[2]!.height]).toEqual([550, 380]);
  });

  for (const [module, driver] of Object.entries(DRIVERS)) {
    it(`${module} stamps where the reader can see it, on every geometry`, async () => {
      const pages = await readAsViewer(await driver.run(await fixture()));
      expect(pages).toHaveLength(GEOMETRIES.length);
      // Collected rather than thrown one at a time: which geometries fail is
      // the diagnosis (only the offset ones → an origin defect).
      const failures: string[] = [];
      pages.forEach((page, i) => {
        try {
          driver.check(page, i, `p${i + 1} ${GEOMETRIES[i]!.label}`);
        } catch (error) {
          failures.push(
            (error as Error).message.split(String.fromCharCode(10))[0]!,
          );
        }
      });
      expect(failures, failures.join(String.fromCharCode(10))).toEqual([]);
    });
  }
});

describe("visibleBox", () => {
  it("is the CropBox clipped to the MediaBox, falling back to the MediaBox", async () => {
    const doc = await PDFDocument.create();
    const plain = doc.addPage([612, 792]);
    expect(visibleBox(plain)).toEqual({ x: 0, y: 0, width: 612, height: 792 });

    const cropped = doc.addPage([612, 792]);
    cropped.setCropBox(72, 72, 468, 648);
    expect(visibleBox(cropped)).toEqual({
      x: 72,
      y: 72,
      width: 468,
      height: 648,
    });

    const overhang = doc.addPage([612, 792]);
    overhang.setCropBox(-300, -300, 700, 800);
    expect(visibleBox(overhang)).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 500,
    });

    // Disjoint: nothing to intersect, so the MediaBox (pdf.js does the same).
    const disjoint = doc.addPage([612, 792]);
    disjoint.setCropBox(1000, 1000, 50, 50);
    expect(visibleBox(disjoint)).toEqual({
      x: 0,
      y: 0,
      width: 612,
      height: 792,
    });
  });
});
