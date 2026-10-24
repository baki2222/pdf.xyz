// @native-canvas
import { describe, expect, it } from "vitest";
import { PDFDocument, degrees } from "pdf-lib";
import { viewerFrame } from "../page-frame";
import { PDFJS_DOCUMENT_DEFAULTS } from "../wasm-assets";
import { awaitPdfjsDocument } from "../pdfjs";
import {
  CSS_PX_PER_PT,
  clampZoom,
  fitWidthZoom,
  rectAnchor,
  scaleForZoom,
  screenToViewer,
  snapPoint,
  snapRect,
  fitPageWidth,
  viewerToContent,
  viewerToScreen,
  type ExportFrame,
} from "./geometry";

/**
 * SCREEN → VIEWER → CONTENT, composed, held to pdf.js.
 *
 * The overlay turns a click into viewer points (÷ scale); the export turns
 * viewer points into content space (y-flip + `viewToContent`). Each half is a
 * few lines of arithmetic, and a pair of hand-derived formulas checked against
 * themselves is how Edit PDF once placed text sideways on rotated pages. So
 * the oracle here is pdf.js: the canvas the editor shows IS
 * `page.getViewport({ scale, rotation: page.rotate })`, and that viewport's
 * own `convertToPdfPoint` says which content-space point sits under any
 * screen pixel. None of our code is on that path.
 */

type Box = [number, number, number, number];

async function pageWith(opts: {
  rotate: number;
  crop?: Box;
  media?: Box;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  if (opts.media) page.setMediaBox(...opts.media);
  if (opts.crop) page.setCropBox(...opts.crop);
  page.setRotation(degrees(opts.rotate));
  return doc.save();
}

async function frameOf(bytes: Uint8Array): Promise<ExportFrame> {
  const doc = await PDFDocument.load(bytes);
  return viewerFrame(doc.getPage(0));
}

async function pdfjsPage(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    ...PDFJS_DOCUMENT_DEFAULTS,
    data: bytes.slice(),
    useWorkerFetch: false,
    disableFontFace: true,
  });
  const doc = await awaitPdfjsDocument(task);
  return { page: await doc.getPage(1), task };
}

const GEOMETRIES: { name: string; crop?: Box; media?: Box }[] = [
  { name: "plain" },
  { name: "cropped", crop: [40, 55, 520, 690] },
  { name: "offset MediaBox", media: [100, 50, 500, 700] },
];
const ROTATIONS = [0, 90, 180, 270];
const ZOOMS = [0.5, 1, 1.75, 4];

describe("a screen pixel maps to the content point pdf.js draws under it", () => {
  for (const g of GEOMETRIES) {
    for (const rotate of ROTATIONS) {
      it(`${g.name}, /Rotate ${rotate}`, async () => {
        const bytes = await pageWith({ rotate, crop: g.crop, media: g.media });
        const frame = await frameOf(bytes);
        const { page, task } = await pdfjsPage(bytes);
        try {
          let checked = 0;
          for (const zoom of ZOOMS) {
            const scale = scaleForZoom(zoom);
            const viewport = page.getViewport({
              scale,
              rotation: page.rotate,
            });
            // The canvas the editor shows is the displayed page at `scale`.
            expect(viewport.width).toBeCloseTo(frame.width * scale, 6);
            expect(viewport.height).toBeCloseTo(frame.height * scale, 6);
            for (const [fx, fy] of [
              [0, 0],
              [1, 0],
              [0, 1],
              [1, 1],
              [0.25, 0.7],
              [0.6, 0.15],
            ] as const) {
              const px = fx * viewport.width;
              const py = fy * viewport.height;
              const v = screenToViewer(px, py, scale);
              const ours = viewerToContent(v.x, v.y, frame);
              const [ox, oy] = viewport.convertToPdfPoint(px, py) as number[];
              expect(ours.x, `x at (${fx}, ${fy}) zoom ${zoom}`).toBeCloseTo(
                ox!,
                6,
              );
              expect(ours.y, `y at (${fx}, ${fy}) zoom ${zoom}`).toBeCloseTo(
                oy!,
                6,
              );
              // And back: viewer → screen is the inverse.
              const back = viewerToScreen(v.x, v.y, scale);
              expect(back.x).toBeCloseTo(px, 9);
              expect(back.y).toBeCloseTo(py, 9);
              checked += 1;
            }
          }
          // Health: the loops ran.
          expect(checked).toBe(ZOOMS.length * 6);
        } finally {
          await task.destroy();
        }
      });
    }
  }

  it("control: ignoring /Rotate disagrees with pdf.js on a rotated page", async () => {
    // A mapping that forgets the rotation is the shipped defect this suite
    // exists to catch; it must FAIL the same comparison, or the comparison is
    // blind.
    const bytes = await pageWith({ rotate: 90 });
    const frame = await frameOf(bytes);
    const naive: ExportFrame = { ...frame, rotation: 0 };
    const { page, task } = await pdfjsPage(bytes);
    try {
      const viewport = page.getViewport({ scale: 1, rotation: page.rotate });
      const [ox, oy] = viewport.convertToPdfPoint(100, 50) as number[];
      const ours = viewerToContent(100, 50, frame);
      const wrong = viewerToContent(100, 50, naive);
      expect(ours.x).toBeCloseTo(ox!, 6);
      expect(ours.y).toBeCloseTo(oy!, 6);
      expect(Math.hypot(wrong.x - ox!, wrong.y - oy!)).toBeGreaterThan(10);
    } finally {
      await task.destroy();
    }
  });
});

describe("rect anchors", () => {
  it("anchors a rect at its VISUAL bottom-left corner on every rotation", async () => {
    for (const rotate of ROTATIONS) {
      const frame = await frameOf(await pageWith({ rotate }));
      const rect = { x: 50, y: 60, width: 30, height: 20 };
      expect(rectAnchor(rect, frame)).toEqual(viewerToContent(50, 80, frame));
    }
  });
});

describe("zoom", () => {
  it("clamps to 50–400% and maps 100% to physical size", () => {
    expect(clampZoom(0.1)).toBe(0.5);
    expect(clampZoom(9)).toBe(4);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(scaleForZoom(1)).toBeCloseTo(CSS_PX_PER_PT, 9);
    expect(fitWidthZoom(816, 612)).toBeCloseTo(1, 9);
    expect(fitWidthZoom(100000, 612)).toBe(4);
    // Fit may go below the manual minimum: a Letter page on a phone.
    expect(fitWidthZoom(328, 612)).toBeCloseTo(328 / 816, 9);
    expect(scaleForZoom(0.3)).toBeCloseTo(0.3 * CSS_PX_PER_PT, 9);
    expect(clampZoom(0.3)).toBe(0.5);
    // Fit width fits the WIDEST page. Inverted 2026-10-24: these three once
    // pinned the median (612, 612, 792), which left one landscape page cut
    // off at the right at "Fit width".
    expect(fitPageWidth([612, 792])).toBe(792);
    expect(fitPageWidth([612, 612, 792])).toBe(792);
    expect(fitPageWidth([792, 792, 612])).toBe(792);
    expect(fitPageWidth([])).toBe(0);
  });
});

describe("snapping", () => {
  it("snaps an edge or the centre to the page's edges and centre lines", () => {
    // Centre of a 100-wide box at x=253 is 303; the page centre is 306.
    const snap = snapRect(
      { x: 253, y: 40, width: 100, height: 50 },
      612,
      792,
      4,
    );
    expect(snap.dx).toBeCloseTo(3, 9);
    expect(snap.guides).toContainEqual({ axis: "x", at: 306 });
    // Left edge near 0.
    expect(
      snapRect({ x: 2, y: 300, width: 10, height: 10 }, 612, 792, 4).dx,
    ).toBe(-2);
    // Nothing near: no correction, no guide (negative control).
    const none = snapRect(
      { x: 100, y: 100, width: 10, height: 10 },
      612,
      792,
      4,
    );
    expect(none).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it("snaps to another object's edges and centre, with a guide on its line", () => {
    // Far from the page's own lines (0, 306, 612 across; 0, 396, 792 down).
    const other = { x: 200, y: 500, width: 80, height: 40 };
    // Left edge 2 pt right of the other's left edge.
    const left = snapRect(
      { x: 202, y: 100, width: 30, height: 20 },
      612,
      792,
      4,
      [other],
    );
    expect(left.dx).toBeCloseTo(-2, 9);
    expect(left.guides).toContainEqual({ axis: "x", at: 200 });
    // Vertical centre 3 pt above the other's centre line (520).
    const mid = snapRect(
      { x: 10, y: 507, width: 30, height: 20 },
      612,
      792,
      4,
      [other],
    );
    expect(mid.dy).toBeCloseTo(3, 9);
    expect(mid.guides).toContainEqual({ axis: "y", at: 520 });
    // The same rect with no other objects does not snap there (control).
    expect(
      snapRect({ x: 202, y: 100, width: 30, height: 20 }, 612, 792, 4).dx,
    ).toBe(0);
    // A handle (a point) snaps to another object's edge...
    const p = snapPoint({ x: 278, y: 10 }, 612, 792, 4, [other]);
    expect(p.x).toBe(280);
    expect(p.guides).toContainEqual({ axis: "x", at: 280 });
    // ...but not to the page's centre line (a box being sized is not centred).
    expect(snapPoint({ x: 304, y: 10 }, 612, 792, 4, [other]).x).toBe(304);
  });
});
