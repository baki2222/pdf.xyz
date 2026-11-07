// @native-canvas
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import {
  PDFBool,
  PDFDocument,
  PDFHexString,
  PDFName,
  StandardFonts,
  degrees,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import { getToolBySlug } from "@/lib/tools";
import { getToolContent } from "@/lib/tools/content";
import { getGuideBySlug } from "@/lib/guides";
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
  rtl: false,
  ...over,
});

const A4 = N_UP_SHEETS.find((s) => s.id === "a4")!.size!;

describe("nUpGrid and nUpCells", () => {
  it("has a grid for every count, whose cells number the count", () => {
    // 3, 8, 12 and 16 added 2026-11-07 (audit n-up-pdf#2): 8 and 16 are
    // the handout and proof-sheet counts both competitors with this tool offer.
    expect(N_UP_COUNTS).toEqual([2, 3, 4, 6, 8, 9, 12, 16]);
    for (const n of N_UP_COUNTS) {
      for (const landscape of [false, true]) {
        const g = nUpGrid(n, landscape);
        expect(g.cols * g.rows).toBe(n);
      }
    }
  });

  it("the catalogue's card names the most pages per sheet, never a range that skips counts", () => {
    // The tagline and description are typed in the catalogue, which cannot
    // import this module; they said "2, 4, 6 or 9" until 2026-11-07, then
    // "2 to 16", which reads as any count in between while 5, 7, 10, 11 and
    // 13-15 are not offered (review of audit n-up-pdf#2). "Up to 16" is true.
    const tool = getToolBySlug("n-up-pdf")!;
    const most = `up to ${N_UP_COUNTS.at(-1)}`;
    expect(tool.tagline.toLowerCase()).toContain(most);
    expect(tool.description.toLowerCase()).toContain(most);
    // "N to M" is a claim that every count from N to M is offered.
    const skipped = (text: string): number[] =>
      [...text.matchAll(/\b(\d+) to (\d+)\b/g)].flatMap(([, a, b]) =>
        Array.from(
          { length: Number(b) - Number(a) + 1 },
          (_, k) => Number(a) + k,
        ).filter((n) => !(N_UP_COUNTS as readonly number[]).includes(n)),
      );
    expect(
      skipped("Put 2 to 16 pages on one sheet."),
      "positive control",
    ).not.toEqual([]);
    const surfaces = [
      tool.tagline,
      tool.description,
      getToolContent("n-up-pdf")!.metaDescription,
      getGuideBySlug("how-to-print-multiple-pages-per-sheet")!.description,
    ];
    expect(
      surfaces.every((t) => t.length > 0),
      "health check",
    ).toBe(true);
    for (const text of surfaces) expect(skipped(text), text).toEqual([]);
    // …and every paper size the Sheet size chips offer (since 2026-11-07,
    // audit n-up-pdf#3; it named A4 and US Letter only).
    for (const sheet of N_UP_SHEETS.filter((s) => s.size))
      expect(tool.description).toContain(sheet.label);
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

  it("8, 12 and 16 per sheet fit that many pages on one sheet, in reading order", async () => {
    for (const perSheet of [8, 12, 16] as const) {
      const result = await nUpPdf(
        await labelledPdf(perSheet + 1),
        opts({ perSheet, orientation: "portrait" }),
      );
      expect(result.sheets).toBe(2);
      expect(result.grid.cols * result.grid.rows).toBe(perSheet);
      const sheets = await readSheets(result.bytes);
      expect(sheets[0]!.labels).toHaveLength(perSheet);
      expect(sheets[1]!.labels.map((l) => l.text)).toEqual([
        `P${perSheet + 1}`,
      ]);
      const at = Object.fromEntries(sheets[0]!.labels.map((l) => [l.text, l]));
      // Across, then down: P2 right of P1 on the same row; the first page
      // of row two sits under P1.
      const next = `P${result.grid.cols + 1}`;
      expect(at.P2!.x).toBeGreaterThan(at.P1!.x);
      expect(at.P2!.y).toBeCloseTo(at.P1!.y, 1);
      expect(at[next]!.x).toBeCloseTo(at.P1!.x, 1);
      expect(at[next]!.y).toBeGreaterThan(at.P1!.y);
    }
  });

  it("3 per sheet stacks three portrait pages, or sets them side by side on landscape", async () => {
    expect(nUpGrid(3, false)).toEqual({ cols: 1, rows: 3 });
    expect(nUpGrid(3, true)).toEqual({ cols: 3, rows: 1 });
    const result = await nUpPdf(
      await labelledPdf(3),
      opts({ perSheet: 3, orientation: "auto" }),
    );
    expect(result.sheets).toBe(1);
    expect((await readSheets(result.bytes))[0]!.labels).toHaveLength(3);
  });

  it("offers A3, A5 and US Legal sheets beside A4 and US Letter, and the original page size", async () => {
    expect(N_UP_SHEETS.map((s) => s.id)).toEqual([
      "a4",
      "letter",
      "legal",
      "a3",
      "a5",
      "source",
    ]);
    // A3 is the proof sheet for 4-up A4: each A4 page lands at full A4 size
    // in its quarter.
    const a3 = N_UP_SHEETS.find((s) => s.id === "a3")!.size!;
    expect(a3.width).toBeCloseTo(841.89, 1);
    expect(a3.height).toBeCloseTo(1190.55, 1);
    const result = await nUpPdf(await labelledPdf(4), opts({ sheet: "a3" }));
    const [sheet] = await readSheets(result.bytes);
    expect(sheet!.width).toBeCloseTo(a3.width, 1);
    expect(sheet!.height).toBeCloseTo(a3.height, 1);
    expect(sheet!.labels).toHaveLength(4);
  });

  it("'Original page size' makes each sheet the size of the first page", async () => {
    // 300 x 400 pages, 2 per sheet on Auto: the sheet is 300 x 400 turned
    // landscape, so the two pages sit side by side at half scale.
    const result = await nUpPdf(
      await labelledPdf(4),
      opts({ sheet: "source", perSheet: 2, orientation: "auto" }),
    );
    expect(result.orientation).toBe("landscape");
    const sheets = await readSheets(result.bytes);
    expect(sheets).toHaveLength(2);
    expect(sheets[0]!.width).toBeCloseTo(400, 1);
    expect(sheets[0]!.height).toBeCloseTo(300, 1);
    const portrait = await nUpPdf(
      await labelledPdf(4),
      opts({ sheet: "source", perSheet: 4, orientation: "portrait" }),
    );
    const [p] = await readSheets(portrait.bytes);
    expect(p!.width).toBeCloseTo(300, 1);
    expect(p!.height).toBeCloseTo(400, 1);
  });

  it("right to left mirrors the columns: P1 top-right, P2 to its left", async () => {
    // An Arabic, Hebrew or manga handout read right to left: page 2 must sit
    // to the LEFT of page 1, or the sheet reads backwards.
    const across = await nUpPdf(await labelledPdf(4), opts({ rtl: true }));
    const [sheet] = await readSheets(across.bytes);
    const at = Object.fromEntries(sheet!.labels.map((l) => [l.text, l]));
    const halfW = A4.width / 2;
    const halfH = A4.height / 2;
    expect(at.P1!.x).toBeGreaterThan(halfW);
    expect(at.P1!.y).toBeLessThan(halfH);
    expect(at.P2!.x).toBeLessThan(halfW);
    expect(at.P2!.y).toBeLessThan(halfH);
    expect(at.P3!.x).toBeGreaterThan(halfW);
    expect(at.P3!.y).toBeGreaterThan(halfH);
    // Down, then across: P2 under P1 in the right column, P3 starts the left.
    const down = await nUpPdf(
      await labelledPdf(4),
      opts({ rtl: true, order: "down" }),
    );
    const [d] = await readSheets(down.bytes);
    const dat = Object.fromEntries(d!.labels.map((l) => [l.text, l]));
    expect(dat.P2!.x).toBeCloseTo(dat.P1!.x, 1);
    expect(dat.P2!.y).toBeGreaterThan(dat.P1!.y);
    expect(dat.P3!.x).toBeLessThan(dat.P1!.x);
    // Control: left to right keeps P2 to the right of P1.
    expect(
      nUpCells(A4, { cols: 2, rows: 1 }, "across", 0, false)[1]!.x,
    ).toBeGreaterThan(0);
    expect(nUpCells(A4, { cols: 2, rows: 1 }, "across", 0, true)[1]!.x).toBe(0);
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

/**
 * Filled form values with NO appearance stream (audit #24). A form filled by
 * pdftk without flatten, by some browser and macOS fills, or by a server
 * carries its value only in `/V`, with `/NeedAppearances true`: a viewer
 * builds the appearance itself. Until 2026-11-06 the bake step skipped any
 * widget with no `/AP`, so such a value vanished from the sheets with no
 * warning, while the FAQ promises "a filled form ... looks the same".
 */
describe("filled form values reach the sheet", () => {
  /** Every text run pdf.js reads off every sheet. */
  async function sheetText(bytes: Uint8Array): Promise<string> {
    const lib = await pdfjs();
    const task = lib.getDocument({ data: bytes.slice(), verbosity: 0 });
    const doc = await task.promise;
    const runs: string[] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const text = await (await doc.getPage(n)).getTextContent();
      for (const item of text.items) if ("str" in item) runs.push(item.str);
    }
    await task.destroy();
    return runs.join("|");
  }

  /** A 2-page labelled PDF whose page 1 holds a text field set to `value`. */
  async function filledForm(
    value: string,
    { appearance }: { appearance: boolean },
  ): Promise<Uint8Array> {
    const doc = await PDFDocument.load(await labelledPdf(2));
    const form = doc.getForm();
    const field = form.createTextField("applicant.name");
    field.addToPage(doc.getPage(0), { x: 20, y: 200, width: 200, height: 30 });
    if (appearance) {
      field.setText(value);
      return doc.save();
    }
    // What pdftk fill_form leaves: the value in /V, no /AP, and the form
    // telling the viewer to draw it.
    field.acroField.dict.set(PDFName.of("V"), PDFHexString.fromText(value));
    for (const widget of field.acroField.getWidgets()) {
      widget.dict.delete(PDFName.of("AP"));
    }
    form.acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.True);
    return doc.save({ updateFieldAppearances: false });
  }

  it("CONTROL: a value with an appearance stream is drawn on the sheet", async () => {
    const pdf = await filledForm("FILLEDVALUE", { appearance: true });
    const result = await nUpPdf(pdf, opts({ perSheet: 2 }));
    expect(await sheetText(result.bytes)).toContain("FILLEDVALUE");
  });

  it("a value with no appearance stream (NeedAppearances) is drawn on the sheet", async () => {
    const pdf = await filledForm("FILLEDVALUE", { appearance: false });
    const result = await nUpPdf(pdf, opts({ perSheet: 2 }));
    expect(await sheetText(result.bytes)).toContain("FILLEDVALUE");
    expect(result.undrawnFields).toEqual([]);
  });

  it("a value the form's font cannot draw is reported by field name, not dropped silently", async () => {
    const pdf = await filledForm("আমার", { appearance: false });
    const result = await nUpPdf(pdf, opts({ perSheet: 2 }));
    expect(result.undrawnFields).toEqual(["applicant.name"]);
  });

  it("a value the font cannot redraw, but with a stored appearance, is drawn from that appearance and not named", async () => {
    // What many fillers leave: an /AP drawn with their own embedded font,
    // a /V the form's default font cannot encode, and /NeedAppearances set.
    // The redraw fails; the stored appearance is still baked onto the sheet,
    // so naming the field as "not on the sheets" would be false.
    const doc = await PDFDocument.load(await labelledPdf(2));
    const form = doc.getForm();
    const field = form.createTextField("bn.name");
    field.addToPage(doc.getPage(0), { x: 20, y: 200, width: 200, height: 30 });
    field.setText("STOREDAP");
    form.updateFieldAppearances();
    field.acroField.dict.set(PDFName.of("V"), PDFHexString.fromText("আমার"));
    form.acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.True);
    const pdf = await doc.save({ updateFieldAppearances: false });

    const result = await nUpPdf(pdf, opts({ perSheet: 2 }));
    expect(result.undrawnFields).toEqual([]);
    expect(await sheetText(result.bytes)).toContain("STOREDAP");
  });
});
