/**
 * The PDFs the wave-3 Extract Tables and PDF to Excel deployment proofs send
 * (`scripts/worker-prove-tools.ts`), drawn from the constants their verdicts
 * read (`@/lib/workers/table-extract/options-proof`,
 * `@/lib/workers/ooxml/number-cells-proof`): one source for the page and its
 * answer. Generated, deterministic, small; no user document.
 *
 * Here rather than beside the verdicts because the scan is rasterised by
 * pdf.js (`./pdf-render`), which a pure verdict module must not load.
 */
import { PDFDocument, type PDFFont, type PDFPage } from "pdf-lib";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";
import { NUMBER_CELL_ROWS } from "@/lib/workers/ooxml/number-cells-proof";
import {
  CLOSING_ROWS,
  OCR_PROSE_LINES,
  OCR_TABLE_ROWS,
  STATEMENT_BRANCHES,
  STATEMENT_PAGE_1,
  STATEMENT_PAGE_2,
  STATEMENT_PROSE,
} from "@/lib/workers/table-extract/options-proof";
import { encodePng } from "@/lib/pdf/extract-images";
import { drawRasterImage, embedRasterImage } from "@/lib/pdf/pdf-lib";
import { renderPdfPages } from "./pdf-render";
import { awaitPdfjsDocument } from "@/lib/pdf/pdfjs";
import { PDFJS_DOCUMENT_DEFAULTS } from "@/lib/pdf/wasm-assets";
import { wordsOfItem } from "@/lib/pdf/pdf-to-markdown-tables";
import type { TextItemLike } from "@/lib/pdf/text";
import type { PdfLayout } from "@/lib/workers/table-extract/engine";

type Grid = readonly (readonly string[])[];
const LETTER: [number, number] = [612, 792];
const A4: [number, number] = [595, 842];
const SIZE = 11;

/**
 * Draw `rows` from `top` down, `pitch` apart: column `c` starts at `left[c]`,
 * or, where `right[c]` is set, its BODY cells end there (amounts set flush
 * right) while its header stays flush left.
 */
function drawGrid(
  page: PDFPage,
  rows: Grid,
  top: number,
  left: readonly number[],
  right: readonly (number | null)[],
  font: PDFFont,
  size = SIZE,
  pitch = 16,
): void {
  rows.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (!cell) return;
      const edge = right[c];
      const x =
        r > 0 && edge != null
          ? edge - font.widthOfTextAtSize(cell, size)
          : left[c]!;
      page.drawText(cell, { x, y: top - r * pitch, size, font });
    }),
  );
}

/**
 * Three Letter pages: the number-cells table (label flush left, value flush
 * right), a BLANK page, and the closing table. PDF to Excel's "one sheet per
 * page" must give the blank page an empty sheet; Extract Tables' defaults
 * must give two tables, on pages 1 and 3.
 */
export async function numberCellsPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await embedDrawingFont(doc, [
    ...NUMBER_CELL_ROWS.flat(),
    ...CLOSING_ROWS.flat(),
  ]);
  drawGrid(
    doc.addPage(LETTER),
    NUMBER_CELL_ROWS,
    700,
    [60, 260],
    [null, 380],
    font,
  );
  doc.addPage(LETTER);
  drawGrid(
    doc.addPage(LETTER),
    CLOSING_ROWS,
    700,
    [60, 260],
    [null, 380],
    font,
  );
  return doc.save();
}

/**
 * Five Letter pages: the statement's table on page 1, carried on under the
 * same header on page 2, prose on 3, a different table on 4, prose on 5.
 */
export async function repeatedHeaderPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await embedDrawingFont(doc, [
    ...[STATEMENT_PAGE_1, STATEMENT_PAGE_2, STATEMENT_BRANCHES].flat(2),
    ...STATEMENT_PROSE,
  ]);
  const statementCols = { left: [60, 160, 380], right: [null, null, 460] };
  const prose = (line: string) =>
    doc.addPage(LETTER).drawText(line, { x: 60, y: 700, size: SIZE, font });
  drawGrid(
    doc.addPage(LETTER),
    STATEMENT_PAGE_1,
    700,
    statementCols.left,
    statementCols.right,
    font,
  );
  drawGrid(
    doc.addPage(LETTER),
    STATEMENT_PAGE_2,
    700,
    statementCols.left,
    statementCols.right,
    font,
  );
  prose(STATEMENT_PROSE[0]);
  drawGrid(
    doc.addPage(LETTER),
    STATEMENT_BRANCHES,
    700,
    [60, 200],
    [null, 260],
    font,
  );
  prose(STATEMENT_PROSE[1]);
  return doc.save();
}

/**
 * The SCAN: two A4 pages with no text layer — the table large and plain on
 * page 1, two lines of prose on page 2 — typed in Helvetica, rasterised by
 * pdf.js at ~200 DPI with its standard font data, composited over white and
 * placed back as each page's only content: the recipe of the PDF to Word OCR
 * proof's `scanOfFirstPage`, over every page.
 */
export async function scannedTablePdf(): Promise<Uint8Array> {
  const typed = await typedScanPages();
  const rendered = await renderPdfPages(typed, 2339, { standardFonts: true });
  if (rendered.length !== 2) throw new Error("the typed pages did not render");
  const scan = await PDFDocument.create();
  for (const page of rendered) {
    const gray = new Uint8Array(page.width * page.height);
    for (let i = 0; i < gray.length; i++) {
      const a = page.data[i * 4 + 3]! / 255;
      const luma =
        0.299 * page.data[i * 4]! +
        0.587 * page.data[i * 4 + 1]! +
        0.114 * page.data[i * 4 + 2]!;
      // A transparent canvas pixel is paper, not ink.
      gray[i] = Math.round(255 * (1 - a) + a * luma);
    }
    const img = await embedRasterImage(
      scan,
      encodePng(page.width, page.height, "gray8", gray),
      "png",
    );
    await drawRasterImage(scan.addPage(A4), img, {
      x: 0,
      y: 0,
      width: A4[0],
      height: A4[1],
    });
  }
  return scan.save();
}

/**
 * The two pages {@link scannedTablePdf} rasterises, still TYPED: what a
 * perfect OCR text layer would hold. The unit tests run the real table
 * engine over this as OCR's stand-in, so the verdicts' positive controls are
 * a layout the detector really splits, not a hand-made ZIP.
 */
export async function typedScanPages(): Promise<Uint8Array> {
  const typed = await PDFDocument.create();
  const font = await embedDrawingFont(typed, [
    ...OCR_TABLE_ROWS.flat(),
    ...OCR_PROSE_LINES,
  ]);
  drawGrid(
    typed.addPage(A4),
    OCR_TABLE_ROWS,
    720,
    [60, 240, 400],
    [],
    font,
    18,
    32,
  );
  const prose = typed.addPage(A4);
  OCR_PROSE_LINES.forEach((line, i) =>
    prose.drawText(line, { x: 60, y: 720 - i * 30, size: 18, font }),
  );
  return typed.save();
}

/**
 * A PDF's positioned words as pdf.js reads them, split by Extract Tables'
 * own browser-side splitter (`wordsOfItem`) — a stand-in for poppler's
 * `-bbox-layout` where none is installed (Git for Windows ships Xpdf). The
 * deployment proof runs the real poppler; this lets the verdicts' positive
 * controls come from the real engine over these very fixtures.
 */
export async function pdfjsLayout(bytes: Uint8Array): Promise<PdfLayout> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    isOffscreenCanvasSupported: false,
    ...PDFJS_DOCUMENT_DEFAULTS,
  });
  const doc = await awaitPdfjsDocument(task);
  const pages: PdfLayout["pages"] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const [, , width, height] = page.view as number[];
    const content = await page.getTextContent();
    pages.push({
      pageNumber: n,
      width: width ?? 0,
      height: height ?? 0,
      items: content.items.flatMap((item) =>
        "str" in item ? wordsOfItem(item as TextItemLike) : [],
      ),
    });
  }
  return { pageCount: doc.numPages, pages };
}
