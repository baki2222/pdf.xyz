import type { PDFEmbeddedPage } from "pdf-lib";
import { PdfEngineError, loadPdf } from "./engine";
import { outputName } from "./files";
import { IMAGE_MARGINS, IMAGE_PAGE_SIZES } from "./image-page-layout";
import { bakeAnnotationAppearances, placeOverlay } from "./overlay";
import { visibleBox, visiblePageFrame, type Box } from "./page-frame";
import { loadPdfLib } from "./pdf-lib";
import { stampProducer } from "./stamp";

/**
 * Multiple Pages per Sheet ("n-up") — several pages of a PDF drawn, scaled
 * down, onto each sheet of a new PDF, the way a print dialog's "pages per
 * sheet" does, but saved as a file.
 *
 * Each source page is embedded as a Form XObject (pdf-lib `embedPages`) clipped
 * to its VISIBLE box (CropBox ∩ MediaBox), with the appearance of every
 * visible annotation and form field baked in first, as Overlay PDF does — so a
 * filled form or a stamp shows on the sheet. Links and fields stop being
 * interactive: an embedded page carries drawing only. A page's own `/Rotate`
 * is honoured (placed by `placeOverlay`, the geometry Overlay PDF uses), so a
 * landscape scan lands the way a viewer shows it.
 *
 * The layout is pure numbers ({@link nUpGrid}, {@link nUpCells},
 * {@link chooseSheetOrientation}) so `n-up.test.ts` checks the cell boxes
 * directly, and checks where each page lands by reading the output with pdf.js.
 */

export type NUpCount = 2 | 4 | 6 | 9;

export const N_UP_COUNTS: readonly NUpCount[] = [2, 4, 6, 9];

export type NUpSheetId = "a4" | "letter";

export const N_UP_SHEETS: readonly {
  id: NUpSheetId;
  label: string;
  size: { width: number; height: number };
}[] = (["a4", "letter"] as const).map((id) => {
  const found = IMAGE_PAGE_SIZES.find((s) => s.id === id);
  if (!found?.size) throw new Error(`n-up: no page size "${id}"`);
  return { id, label: found.label, size: found.size };
});

export type NUpOrientation = "auto" | "portrait" | "landscape";

export const N_UP_ORIENTATIONS: readonly {
  id: NUpOrientation;
  label: string;
}[] = [
  { id: "auto", label: "Auto" },
  { id: "portrait", label: "Portrait" },
  { id: "landscape", label: "Landscape" },
];

export type NUpOrder = "across" | "down";

export const N_UP_ORDERS: readonly { id: NUpOrder; label: string }[] = [
  { id: "across", label: "Across, then down" },
  { id: "down", label: "Down, then across" },
];

/** The margin choices — Image to PDF's table, so the two tools agree. */
export const N_UP_MARGINS = IMAGE_MARGINS;
export type NUpMarginId = (typeof IMAGE_MARGINS)[number]["id"];

/** A border's line width, in points. */
export const N_UP_BORDER_PT = 0.5;

export interface NUpOptions {
  perSheet: NUpCount;
  sheet: NUpSheetId;
  orientation: NUpOrientation;
  order: NUpOrder;
  margin: NUpMarginId;
  borders: boolean;
}

export const DEFAULT_N_UP_OPTIONS: Readonly<NUpOptions> = {
  perSheet: 2,
  sheet: "a4",
  orientation: "auto",
  order: "across",
  margin: "small",
  borders: false,
};

/** Columns × rows for a count on a sheet of the given orientation. */
export function nUpGrid(
  perSheet: NUpCount,
  landscape: boolean,
): { cols: number; rows: number } {
  switch (perSheet) {
    case 2:
      return landscape ? { cols: 2, rows: 1 } : { cols: 1, rows: 2 };
    case 4:
      return { cols: 2, rows: 2 };
    case 6:
      return landscape ? { cols: 3, rows: 2 } : { cols: 2, rows: 3 };
    case 9:
      return { cols: 3, rows: 3 };
  }
}

/**
 * The cell boxes of one sheet, in the order pages fill them: "across" fills a
 * row left to right and then moves down; "down" fills a column top to bottom
 * and then moves right. The margin is kept at the sheet's edge AND between
 * cells. Boxes are in PDF space (origin bottom-left).
 */
export function nUpCells(
  sheet: { width: number; height: number },
  grid: { cols: number; rows: number },
  order: NUpOrder,
  margin: number,
): Box[] {
  const { cols, rows } = grid;
  const cellW = (sheet.width - margin * (cols + 1)) / cols;
  const cellH = (sheet.height - margin * (rows + 1)) / rows;
  const cells: Box[] = [];
  for (let i = 0; i < cols * rows; i += 1) {
    const col = order === "across" ? i % cols : Math.floor(i / rows);
    const row = order === "across" ? Math.floor(i / cols) : i % rows;
    cells.push({
      x: margin + col * (cellW + margin),
      y: sheet.height - margin - (row + 1) * cellH - row * margin,
      width: cellW,
      height: cellH,
    });
  }
  return cells;
}

/** How large a `page` (displayed size) is drawn in `cell`. */
function fitScale(
  page: { width: number; height: number },
  cell: { width: number; height: number },
): number {
  return Math.min(cell.width / page.width, cell.height / page.height);
}

/** The sheet, turned to the orientation the options ask for. */
export function orientedSheet(
  size: { width: number; height: number },
  landscape: boolean,
): { width: number; height: number } {
  const short = Math.min(size.width, size.height);
  const long = Math.max(size.width, size.height);
  return landscape
    ? { width: long, height: short }
    : { width: short, height: long };
}

/**
 * "Auto": the orientation that draws the FIRST page largest — portrait
 * pages two to a sheet go side by side on a landscape sheet, four go on a
 * portrait one. A tie keeps portrait.
 */
export function chooseSheetOrientation(
  options: Pick<NUpOptions, "perSheet" | "sheet" | "orientation" | "margin">,
  firstPage: { width: number; height: number },
): "portrait" | "landscape" {
  if (options.orientation !== "auto") return options.orientation;
  const size = N_UP_SHEETS.find((s) => s.id === options.sheet)!.size;
  const margin = marginPoints(options.margin);
  const scaleFor = (landscape: boolean) => {
    const sheet = orientedSheet(size, landscape);
    const cell = nUpCells(
      sheet,
      nUpGrid(options.perSheet, landscape),
      "across",
      margin,
    )[0]!;
    return fitScale(firstPage, cell);
  };
  return scaleFor(true) > scaleFor(false) + 1e-9 ? "landscape" : "portrait";
}

function marginPoints(id: NUpMarginId): number {
  return N_UP_MARGINS.find((m) => m.id === id)?.points ?? 0;
}

export interface NUpResult {
  bytes: Uint8Array;
  sourcePages: number;
  sheets: number;
  orientation: "portrait" | "landscape";
  /** Columns × rows actually used. */
  grid: { cols: number; rows: number };
}

/** Lay every page of `bytes` out `perSheet` to a sheet. */
export async function nUpPdf(
  bytes: Uint8Array,
  options: NUpOptions,
): Promise<NUpResult> {
  if (!N_UP_COUNTS.includes(options.perSheet)) {
    throw new PdfEngineError("Choose 2, 4, 6 or 9 pages per sheet.");
  }
  const lib = await loadPdfLib();
  const source = await loadPdf(bytes);
  const pages = source.getPages();
  if (pages.length === 0) {
    throw new PdfEngineError("This PDF has no pages to lay out.");
  }

  const firstFrame = visiblePageFrame(pages[0]!);
  const orientation = chooseSheetOrientation(options, firstFrame);
  const landscape = orientation === "landscape";
  const sheetSize = orientedSheet(
    N_UP_SHEETS.find((s) => s.id === options.sheet)!.size,
    landscape,
  );
  const grid = nUpGrid(options.perSheet, landscape);
  const cells = nUpCells(
    sheetSize,
    grid,
    options.order,
    marginPoints(options.margin),
  );

  const out = await lib.PDFDocument.create();
  // A page with no content stream draws nothing; it still takes its cell.
  const drawable = pages
    .map((page, index) => {
      bakeAnnotationAppearances(lib, page);
      return { page, index };
    })
    .filter(({ page }) => page.node.Contents() !== undefined);

  let embedded: PDFEmbeddedPage[];
  try {
    embedded = await out.embedPages(
      drawable.map(({ page }) => page),
      drawable.map(({ page }) => {
        const box = visibleBox(page);
        return {
          left: box.x,
          bottom: box.y,
          right: box.x + box.width,
          top: box.y + box.height,
        };
      }),
    );
  } catch {
    throw new PdfEngineError(
      "The pages of this PDF could not be laid out — it may use features we can't process yet.",
    );
  }
  const byIndex = new Map<number, PDFEmbeddedPage>();
  drawable.forEach(({ index }, k) => byIndex.set(index, embedded[k]!));

  const sheets = Math.ceil(pages.length / options.perSheet);
  for (let s = 0; s < sheets; s += 1) {
    const sheet = out.addPage([sheetSize.width, sheetSize.height]);
    for (let slot = 0; slot < options.perSheet; slot += 1) {
      const index = s * options.perSheet + slot;
      const page = pages[index];
      if (!page) break;
      const cell = cells[slot]!;
      const frame = visiblePageFrame(page);
      const place = placeOverlay({
        pageBox: cell,
        pageRotation: 0,
        formWidth: frame.box.width,
        formHeight: frame.box.height,
        overlayRotation: frame.rotation,
        fit: "fit",
      });
      const form = byIndex.get(index);
      if (form) {
        sheet.drawPage(form, {
          x: place.x,
          y: place.y,
          width: place.width,
          height: place.height,
          rotate: lib.degrees(place.rotate),
        });
      }
      if (options.borders) {
        const scale = fitScale(frame, cell);
        const w = frame.width * scale;
        const h = frame.height * scale;
        sheet.drawRectangle({
          x: cell.x + (cell.width - w) / 2,
          y: cell.y + (cell.height - h) / 2,
          width: w,
          height: h,
          borderColor: lib.rgb(0.55, 0.55, 0.55),
          borderWidth: N_UP_BORDER_PT,
        });
      }
    }
  }

  const title = source.getTitle();
  if (title) out.setTitle(title);
  stampProducer(out);
  return {
    bytes: await out.save(),
    sourcePages: pages.length,
    sheets,
    orientation,
    grid,
  };
}

/** "notes.pdf" with 4 per sheet → "notes-4-up.pdf". */
export function nUpOutputName(sourceName: string, perSheet: NUpCount): string {
  return outputName(sourceName, `${perSheet}-up`);
}
