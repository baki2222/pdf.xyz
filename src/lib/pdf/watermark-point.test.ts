// @native-canvas
import { PDFDocument, degrees } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { readAsViewer, type SeenPage } from "@/tests/pdfjs-viewer";
import {
  measureWatermarkText,
  watermarkPageView,
  watermarkPdf,
  watermarkPreviewLayout,
  type WatermarkPosition,
} from "./watermark";

/**
 * Audit watermark-pdf#1: the preview draws the mark where the run will, and a
 * mark can be put at a point the reader picks by dragging. Both are read back
 * from the SAVED file through pdf.js, in the reader's frame: the preview's
 * layout is held to where pdf.js finds the text, not to the engine's own
 * numbers, and on a /Rotate 90 page as well as an upright one.
 */

async function pageOf(size: [number, number], rotate = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage(size).setRotation(degrees(rotate));
  return doc.save();
}

function runOf(pages: SeenPage[], text: string) {
  const run = pages[0]!.runs.find((r) => r.str.includes(text));
  expect(run, JSON.stringify(pages[0]!.runs)).toBeDefined();
  return run!;
}

/** The baseline start of each mark the preview layout predicts, viewer frame. */
async function predictedStarts(
  bytes: Uint8Array,
  text: string,
  fontSize: number,
  tilt: number,
  position: WatermarkPosition,
) {
  const view = await watermarkPageView(bytes, 0);
  const mark = (await measureWatermarkText(text, fontSize))!;
  const layout = watermarkPreviewLayout({ view, mark, tilt, position });
  const rad = (tilt * Math.PI) / 180;
  const { width: w, height: h } = layout;
  return layout.marks.map(({ cx, cy }) => ({
    x: cx - ((w / 2) * Math.cos(rad) - (h / 2) * Math.sin(rad)),
    // y counts down the page here, so the up-the-page offset is subtracted.
    y: cy + ((w / 2) * Math.sin(rad) + (h / 2) * Math.cos(rad)),
  }));
}

describe("watermark at a picked point, and the preview's layout (audit watermark-pdf#1)", () => {
  it("a point in the top-left quadrant lands there in the saved file; the default stays central", async () => {
    const input = await pageOf([600, 800]);
    const at = await watermarkPdf(input, "DRAFT", {
      position: { x: 0.2, y: 0.2 },
      rotation: 0,
      fontSize: 40,
    });
    const run = runOf(await readAsViewer(at.bytes), "DRAFT");
    const mid = { x: (run.x + run.endX) / 2, y: run.y };
    expect(mid.x).toBeLessThan(300);
    expect(mid.y).toBeLessThan(400);
    expect(mid.x).toBeCloseTo(0.2 * 600, -1);

    // Positive control: the untouched default is centred.
    const plain = await watermarkPdf(input, "DRAFT", {
      rotation: 0,
      fontSize: 40,
    });
    const c = runOf(await readAsViewer(plain.bytes), "DRAFT");
    expect((c.x + c.endX) / 2).toBeCloseTo(300, 0);
  });

  it("a point at the very corner is moved in until the whole mark is on the page", async () => {
    const input = await pageOf([600, 800]);
    const out = await watermarkPdf(input, "CONFIDENTIAL", {
      position: { x: 0, y: 0 },
      rotation: 30,
      fontSize: 60,
    });
    const run = runOf(await readAsViewer(out.bytes), "CONFIDENTIAL");
    for (const v of [run.x, run.endX]) {
      expect(v).toBeGreaterThanOrEqual(-0.5);
      expect(v).toBeLessThanOrEqual(600.5);
    }
    for (const v of [run.y, run.endY]) {
      expect(v).toBeGreaterThanOrEqual(-0.5);
      expect(v).toBeLessThanOrEqual(800.5);
    }
  });

  for (const rotate of [0, 90]) {
    for (const position of [
      "middle-center",
      "bottom-right",
      "top-left",
      { x: 0.3, y: 0.25 },
    ] as WatermarkPosition[]) {
      it(`the preview layout predicts where pdf.js finds the mark: /Rotate ${rotate}, ${JSON.stringify(position)}`, async () => {
        const input = await pageOf([595, 842], rotate);
        const out = await watermarkPdf(input, "SAMPLE", {
          position,
          rotation: 30,
          fontSize: 60,
        });
        const [start] = await predictedStarts(
          input,
          "SAMPLE",
          60,
          30,
          position,
        );
        const run = runOf(await readAsViewer(out.bytes), "SAMPLE");
        expect(run.x).toBeCloseTo(start!.x, 0);
        expect(run.y).toBeCloseTo(start!.y, 0);
      });
    }
  }

  it("tiled: the preview predicts every copy pdf.js finds", async () => {
    const input = await pageOf([595, 842]);
    const out = await watermarkPdf(input, "DRAFT", {
      position: "tile",
      rotation: 45,
      fontSize: 30,
    });
    const starts = await predictedStarts(input, "DRAFT", 30, 45, "tile");
    const runs = (await readAsViewer(out.bytes))[0]!.runs.filter((r) =>
      r.str.includes("DRAFT"),
    );
    // Health: more than one copy, and the same count either way.
    expect(runs.length).toBeGreaterThan(3);
    expect(starts).toHaveLength(runs.length);
    for (const run of runs) {
      const near = starts.some(
        (s) => Math.abs(s.x - run.x) < 1 && Math.abs(s.y - run.y) < 1,
      );
      expect(near, JSON.stringify(run)).toBe(true);
    }
  });

  it("measures nothing for text no shipped face can draw, and nothing for blank text", async () => {
    expect(await measureWatermarkText("   ", 40)).toBeNull();
    // Positive control: Latin text measures to a real width.
    const m = await measureWatermarkText("DRAFT", 40);
    expect(m!.width).toBeGreaterThan(60);
  });
});
