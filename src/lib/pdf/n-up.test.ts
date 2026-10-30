// @native-canvas
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  N_UP_COUNTS,
  N_UP_MARGINS,
  N_UP_SHEETS,
  chooseSheetOrientation,
  nUpCells,
  nUpGrid,
  nUpOutputName,
  nUpPdf,
  type NUpOptions,
} from "./n-up";

/**
 * Multiple Pages per Sheet, checked two ways: the cell boxes as numbers, and
 * the OUTPUT read by pdf.js — which sheet each page's label landed on, where
 * on that sheet (in the reader's frame), and that it reads upright.
 */

const require = createRequire(import.meta.url);
type Pdfjs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<Pdfjs> | null = null;
function pdfjs(): Promise<Pdfjs> {
  pdfjsPromise ??= import(
    /* @vite-ignore */ pathToFileURL(
      require.resolve("pdfjs-dist/legacy/build/pdf.mjs"),
    ).href
  ) as Promise<Pdfjs>;
  return pdfjsPromise;
}

interface Label {
  text: string;
  /** Displayed position, top-left origin. */
  x: number;
  y: number;
  /** The glyph run's direction on screen, as a rounded unit vector. */
  dir: [number, number];
}

interface Sheet {
  width: number;
  height: number;
  labels: Label[];
  strokes: number;
}

async function readSheets(bytes: Uint8Array): Promise<Sheet[]> {
  const lib = await pdfjs();
  const task = lib.getDocument({ data: bytes.slice(), verbosity: 0 });
  const doc = await task.promise;
  const sheets: Sheet[] = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const text = await page.getTextContent();
    const labels: Label[] = [];
    for (const item of text.items) {
      if (!("str" in item) || !/^P\d+$/.test(item.str)) continue;
      const [a, b, , , e, f] = item.transform as number[];
      const [x, y] = viewport.convertToViewportPoint(e!, f!);
      const [x2, y2] = viewport.convertToViewportPoint(e! + a!, f! + b!);
      const dx = x2! - x!;
      const dy = y2! - y!;
      const len = Math.hypot(dx, dy) || 1;
      labels.push({
        text: item.str,
        x: x!,
        y: y!,
        dir: [Math.round(dx / len) + 0, Math.round(dy / len) + 0],
      });
    }
    const ops = await page.getOperatorList();
    const strokes = ops.fnArray.filter(
      (fn) => fn === lib.OPS.stroke || fn === lib.OPS.constructPath,
    ).length;
    sheets.push({
      width: viewport.width,
      height: viewport.height,
      labels,
      strokes,
    });
  }
  await task.destroy();
  return sheets;
}

/** `count` 300 × 400 pages, each labelled "P<n>" near its top-left corner. */
async function labelledPdf(
  count: number,
  { rotate = 0 }: { rotate?: number } = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= count; i += 1) {
    const page = doc.addPage([300, 400]);
    page.drawText(`P${i}`, { x: 20, y: 360, size: 24, font });
    page.setRotation(degrees(rotate));
  }
  return doc.save();
}

const opts = (over: Partial<NUpOptions> = {}): NUpOptions => ({
  perSheet: 4,
  sheet: "a4",
  orientation: "portrait",
  order: "across",
  margin: "none",
  borders: false,
  ...over,
});

const A4 = N_UP_SHEETS.find((s) => s.id === "a4")!.size;

describe("nUpGrid and nUpCells", () => {
  it("has a grid for every count, whose cells number the count", () => {
    expect(N_UP_COUNTS).toEqual([2, 4, 6, 9]);
    for (const n of N_UP_COUNTS) {
      for (const landscape of [false, true]) {
        const g = nUpGrid(n, landscape);
        expect(g.cols * g.rows).toBe(n);
      }
    }
  });

  it("tiles the sheet exactly, margin at the edges and between cells", () => {
    const margin = 18;
    const cells = nUpCells(A4, { cols: 2, rows: 3 }, "across", margin);
    expect(cells).toHaveLength(6);
    // Top-left cell first.
    expect(cells[0]!.x).toBeCloseTo(margin);
    expect(cells[0]!.y + cells[0]!.height).toBeCloseTo(A4.height - margin);
    // Last cell bottom-right.
    expect(cells[5]!.x + cells[5]!.width).toBeCloseTo(A4.width - margin);
    expect(cells[5]!.y).toBeCloseTo(margin);
    // The gap between neighbours is the margin.
    expect(cells[1]!.x - (cells[0]!.x + cells[0]!.width)).toBeCloseTo(margin);
  });

  it("orders across-then-down and down-then-across", () => {
    const across = nUpCells(A4, { cols: 2, rows: 2 }, "across", 0);
    const down = nUpCells(A4, { cols: 2, rows: 2 }, "down", 0);
    // Slot 1: right of slot 0 (across) or below it (down).
    expect(across[1]!.x).toBeGreaterThan(across[0]!.x);
    expect(across[1]!.y).toBeCloseTo(across[0]!.y);
    expect(down[1]!.x).toBeCloseTo(down[0]!.x);
    expect(down[1]!.y).toBeLessThan(down[0]!.y);
  });

  it("auto puts two portrait pages side by side, four on a portrait sheet", () => {
    const page = { width: 595, height: 842 };
    const auto = {
      sheet: "a4" as const,
      orientation: "auto" as const,
      margin: "none" as const,
    };
    expect(chooseSheetOrientation({ ...auto, perSheet: 2 }, page)).toBe(
      "landscape",
    );
    expect(chooseSheetOrientation({ ...auto, perSheet: 4 }, page)).toBe(
      "portrait",
    );
    expect(
      chooseSheetOrientation(
        { ...auto, perSheet: 2 },
        { width: 842, height: 595 },
      ),
    ).toBe("portrait");
  });

  it("reuses Image to PDF's margin table (health)", () => {
    expect(N_UP_MARGINS.map((m) => m.id)).toEqual(["none", "small", "large"]);
  });
});

describe("nUpPdf, read back by pdf.js", () => {
  it("control: each source page carries its own label", async () => {
    const sheets = await readSheets(await labelledPdf(5));
    expect(sheets.map((s) => s.labels.map((l) => l.text))).toEqual([
      ["P1"],
      ["P2"],
      ["P3"],
      ["P4"],
      ["P5"],
    ]);
  });

  it("4 per sheet, across: P1 P2 on top, P3 P4 below; P5 starts sheet 2", async () => {
    const result = await nUpPdf(await labelledPdf(5), opts());
    expect(result.sheets).toBe(2);
    const sheets = await readSheets(result.bytes);
    expect(sheets).toHaveLength(2);
    expect(sheets[0]!.width).toBeCloseTo(A4.width, 1);
    expect(sheets[0]!.height).toBeCloseTo(A4.height, 1);
    const at = Object.fromEntries(sheets[0]!.labels.map((l) => [l.text, l]));
    expect(Object.keys(at).sort()).toEqual(["P1", "P2", "P3", "P4"]);
    const halfW = A4.width / 2;
    const halfH = A4.height / 2;
    expect(at.P1!.x).toBeLessThan(halfW);
    expect(at.P1!.y).toBeLessThan(halfH);
    expect(at.P2!.x).toBeGreaterThan(halfW);
    expect(at.P2!.y).toBeLessThan(halfH);
    expect(at.P3!.x).toBeLessThan(halfW);
    expect(at.P3!.y).toBeGreaterThan(halfH);
    expect(at.P4!.x).toBeGreaterThan(halfW);
    expect(at.P4!.y).toBeGreaterThan(halfH);
    expect(sheets[1]!.labels.map((l) => l.text)).toEqual(["P5"]);
  });

  it("places each label exactly where the cell's fit puts it", async () => {
    const result = await nUpPdf(await labelledPdf(4), opts());
    const [sheet] = await readSheets(result.bytes);
    const p2 = sheet!.labels.find((l) => l.text === "P2")!;
    // Independent oracle: cell 1 of a 2 × 2 grid with no margin.
    const cellW = A4.width / 2;
    const cellH = A4.height / 2;
    const s = Math.min(cellW / 300, cellH / 400);
    const ox = cellW + (cellW - 300 * s) / 2;
    const oy = (cellH - 400 * s) / 2;
    expect(p2.x).toBeCloseTo(ox + 20 * s, 1);
    expect(p2.y).toBeCloseTo(oy + (400 - 360) * s, 1);
  });

  it("4 per sheet, down: P2 under P1, P3 beside it", async () => {
    const result = await nUpPdf(await labelledPdf(4), opts({ order: "down" }));
    const [sheet] = await readSheets(result.bytes);
    const at = Object.fromEntries(sheet!.labels.map((l) => [l.text, l]));
    expect(at.P2!.x).toBeCloseTo(at.P1!.x, 1);
    expect(at.P2!.y).toBeGreaterThan(at.P1!.y);
    expect(at.P3!.y).toBeCloseTo(at.P1!.y, 1);
    expect(at.P3!.x).toBeGreaterThan(at.P1!.x);
  });

  it("2 per sheet on auto turns the sheet landscape and halves the sheet count", async () => {
    const result = await nUpPdf(
      await labelledPdf(4),
      opts({ perSheet: 2, orientation: "auto" }),
    );
    expect(result.orientation).toBe("landscape");
    const sheets = await readSheets(result.bytes);
    expect(sheets).toHaveLength(2);
    expect(sheets[0]!.width).toBeCloseTo(A4.height, 1);
    const [first, second] = sheets[0]!.labels;
    expect(first!.text).toBe("P1");
    expect(second!.x).toBeGreaterThan(first!.x);
  });

  it("6 and 9 per sheet fit 6 and 9 pages on one US Letter sheet", async () => {
    for (const perSheet of [6, 9] as const) {
      const result = await nUpPdf(
        await labelledPdf(perSheet),
        opts({ perSheet, sheet: "letter" }),
      );
      const sheets = await readSheets(result.bytes);
      expect(sheets).toHaveLength(1);
      expect(sheets[0]!.width).toBeCloseTo(612, 1);
      expect(sheets[0]!.labels).toHaveLength(perSheet);
    }
  });

  it("draws a page carrying /Rotate 90 the way a viewer shows it", async () => {
    // In a viewer a /Rotate 90 page's label runs top to bottom. On the sheet
    // it must run the same way: an embed that ignored /Rotate would lay it
    // left to right.
    const plain = await readSheets(await labelledPdf(1));
    expect(plain[0]!.labels[0]!.dir).toEqual([1, 0]);
    const source = await labelledPdf(2, { rotate: 90 });
    const alone = await readSheets(source);
    expect(alone[0]!.labels[0]!.dir).toEqual([0, 1]);
    const result = await nUpPdf(
      source,
      opts({ perSheet: 2, orientation: "portrait" }),
    );
    const [sheet] = await readSheets(result.bytes);
    expect(sheet!.labels).toHaveLength(2);
    for (const label of sheet!.labels) expect(label.dir).toEqual([0, 1]);
  });

  it("draws borders only when asked", async () => {
    const pdf = await labelledPdf(4);
    const plain = await readSheets((await nUpPdf(pdf, opts())).bytes);
    const framed = await readSheets(
      (await nUpPdf(pdf, opts({ borders: true }))).bytes,
    );
    expect(framed[0]!.strokes).toBeGreaterThan(plain[0]!.strokes);
    expect(framed[0]!.strokes - plain[0]!.strokes).toBeGreaterThanOrEqual(4);
  });

  it("names the copy after the source and the count", () => {
    expect(nUpOutputName("notes.pdf", 4)).toBe("notes-4-up.pdf");
  });
});
