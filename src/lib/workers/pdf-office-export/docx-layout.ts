/**
 * Where each picture of a page goes among the page's paragraphs, for PDF to
 * Word: the reading-order paragraphs poppler gives (`../pdf-text/flow`) and
 * the pictures the page reader finds (`./page-scan`, pictures only), merged
 * into one sequence per page.
 *
 * ── THE RULE, and why it does not move the text ─────────────────────────────
 *
 * The text keeps poppler's reading order exactly; pictures are inserted into
 * it, never the other way round. A picture taking part in the column cut
 * would change the TEXT's order: a figure across both columns of a page
 * removes the gutter that lets the page be read a column at a time, and the
 * left column's sentence would then continue in the right column. So for
 * each picture, by the paragraphs' bounds:
 *
 *  1. before the first paragraph, in reading order, that starts at or below
 *     the picture's top and overlaps it across the page — the text under it,
 *     in its own column (a label printed ON a screenshot counts: it follows
 *     the screenshot);
 *  2. else after the last such paragraph above it — a picture at the foot of
 *     its column;
 *  3. else (no paragraph shares its column — a picture in a margin, beside a
 *     title) before the first paragraph that starts at or below its top;
 *  4. else at the end of the page.
 *
 * Each paragraph's words carry their own formatting (since 2026-11-15):
 * `./docx-run-style` labels poppler's words with the page reader's runs, and
 * adjacent words of one style are written as one run. The TEXT of every run
 * is poppler's, and a cell whose runs would not concatenate to its text is
 * written as one plain run instead.
 *
 * Pictures that land at the same place keep the page's order: top to
 * bottom, then left to right. A page with no paragraphs (a scan) holds its
 * pictures in that order. Where the paragraphs carry no bounds (a reading
 * built by hand, not from a layout), every picture goes after the page's
 * text: a stated fallback, not a guess.
 *
 * ── THE FRAME ───────────────────────────────────────────────────────────────
 *
 * The page reader's boxes are pdf.js's: the crop box, as displayed. poppler's
 * are the media box's. Each picture's box is mapped through the page's
 * `mediaFrame` (`./page-inventory`, `mediaFrames`) before it is compared, so
 * a page whose crop box is inset from its media box (a scanned book page, a
 * trimmed print file) does not put its pictures a margin too high.
 *
 * ── SIZE ────────────────────────────────────────────────────────────────────
 *
 * Each picture keeps the size the page shows it at, unless that is wider or
 * taller than the Word page's text area ({@link docxPageOf}), in which case
 * it is scaled down — both sides by one factor — until it fits. The page is
 * the PDF's first page when that page is portrait, with an inch of margin
 * (a tenth of the shorter side on a page under five inches); a LANDSCAPE
 * first page — a slide, a printout — gets A4 portrait instead. A Word
 * document flows down its page, and on a landscape one each slide's picture
 * and the text under it break across pages: measured 2026-10-17 in Word 16
 * on the owner's 33-page 4:3 tutorial, 84 Word pages on its own 720 × 540
 * page (60 with half-inch margins), 33 on a portrait page.
 */
import type { FlowBox, PdfFlowText } from "../pdf-text/flow";
import { runKey, runStylesOf, type DocxRunStyle } from "./docx-run-style";
import { mapBox } from "./media-frame";
import type {
  PdfPageScan,
  ScannedMedia,
  ScannedPage,
  ScannedPicture,
  ScannedTextLine,
} from "./page-scan";

export interface DocxTextBlock {
  kind: "text";
  /**
   * One cell is a paragraph; two or more a tab-separated row — since #28
   * slice 2 only a lone wide-gapped line or a table kept as tabs: a
   * recognised table is a {@link DocxTableBlock}.
   */
  cells: readonly string[];
  /**
   * Each cell as runs of one formatting (`./docx-run-style`), adjacent words
   * of one style coalesced: `runs[c]`'s texts concatenate to `cells[c]`,
   * EXACTLY — a cell where they would not is written as one plain run, and
   * counted ({@link DocxFormatting.runsDropped}). Absent for a page built by
   * hand (no poppler words), which falls back to {@link paragraphStyle}.
   */
  runs?: readonly (readonly DocxStyledRun[])[];
  /** Every line of it is drawn in a bold face ({@link paragraphStyle}). */
  bold?: true;
  /** Every line of it is drawn in an italic face. */
  italic?: true;
}

/** A run of text in one formatting; null is Word's default style. */
export interface DocxStyledRun {
  text: string;
  style: DocxRunStyle | null;
}

/** How each page's words were formatted, for the result's note. */
export interface DocxFormatting {
  pages: {
    pageNumber: number;
    matched: number;
    total: number;
    capped: boolean;
    textUnread: boolean;
  }[];
  /** Cells whose runs did not concatenate to their text (never expected). */
  runsDropped: number;
}

export interface DocxPictureBlock {
  kind: "picture";
  media: ScannedMedia;
  /** Its extent in the document, points: the shown size, fitted. */
  width: number;
  height: number;
  /** Fractions of the media cut from each side (`a:srcRect`). */
  crop?: { left: number; top: number; right: number; bottom: number };
  /** Clockwise degrees about its centre; 0 upright. */
  rotation: number;
  flipH: boolean;
  flipV: boolean;
}

/**
 * A Word table (#28 slice 2): one recognised table (a grid segment of
 * `../pdf-text/flow`), on its grid. `columns` are each grid column's width
 * in twips; each row has one slot per column — null for an empty one (the
 * row has no value there), else the slot's source cells (one, or more when
 * cells chain into one column), each as runs, in xMin order.
 */
export interface DocxTableBlock {
  kind: "table";
  columns: readonly number[];
  rows: readonly {
    slots: readonly (readonly (readonly DocxStyledRun[])[] | null)[];
  }[];
}

export type DocxBlock = DocxTextBlock | DocxPictureBlock | DocxTableBlock;

/** The Word page: its size and its text area, points. */
export interface DocxPage {
  width: number;
  height: number;
  margin: number;
}

export interface DocxDocument {
  page: DocxPage;
  /** One entry per PDF page, in order; an empty one adds nothing. */
  pages: DocxBlock[][];
  /** Present when any page carried poppler's words (`pieces`). */
  formatting?: DocxFormatting;
  /**
   * #28 slice 2: Word tables written, and recognised tables kept as tabbed
   * rows — the flow's `tablesAsTabs` plus any this layout or the engine's
   * size fallback converted back. Present when either is above 0. For
   * tests and logs; no result note reads it yet.
   */
  tables?: { written: number; asTabs: number };
}

/** Word's own page-size limits: 0.1 to 22 inches a side. */
const PAGE_MIN_PT = 7.2;
const PAGE_MAX_PT = 1584;
/** An inch of margin, or a tenth of the shorter side on a small page. */
const MARGIN_PT = 72;
const SMALL_PAGE_PT = 360;

/** A4 portrait, points (11,906 × 16,838 twips, Word's own A4). */
export const A4_PORTRAIT = { width: 595.3, height: 841.9 } as const;

/**
 * The Word page for a PDF whose first page is `width` × `height` points:
 * that page, or A4 upright when it is landscape — scaled, its shape kept,
 * into Word's limits when it is larger (or smaller) than Word allows. Until
 * the review of 2026-10-17 each side was clamped on its own, and an A0
 * poster's page came out a 22-inch square.
 */
export function docxPageOf(width: number, height: number): DocxPage {
  const finite = (v: number) => (Number.isFinite(v) && v > 0 ? v : 612);
  const clamp = (v: number) => Math.min(PAGE_MAX_PT, Math.max(PAGE_MIN_PT, v));
  const landscape = finite(width) > finite(height);
  let w = landscape ? A4_PORTRAIT.width : finite(width);
  let h = landscape ? A4_PORTRAIT.height : finite(height);
  const down = Math.min(1, PAGE_MAX_PT / Math.max(w, h));
  w *= down;
  h *= down;
  const up = Math.max(1, PAGE_MIN_PT / Math.min(w, h));
  // A shape too extreme for both limits keeps the long side's.
  w = clamp(w * up);
  h = clamp(h * up);
  const shorter = Math.min(w, h);
  return {
    width: w,
    height: h,
    margin: shorter >= SMALL_PAGE_PT ? MARGIN_PT : shorter / 10,
  };
}

/** The factor that fits `width` × `height` inside the text area, at most 1. */
export function fitToText(
  page: DocxPage,
  width: number,
  height: number,
): number {
  const textW = page.width - 2 * page.margin;
  const textH = page.height - 2 * page.margin;
  return Math.min(
    1,
    textW / Math.max(width, 1e-9),
    textH / Math.max(height, 1e-9),
  );
}

type Box = readonly [number, number, number, number];

/**
 * Where each picture box goes: the index of the paragraph it is placed
 * BEFORE (`paragraphs.length` for the end), by the rule in the docblock.
 */
export function insertionPoints(
  paragraphs: readonly (FlowBox | undefined)[],
  pictures: readonly Box[],
): number[] {
  const overlaps = (q: FlowBox, p: Box) =>
    Math.min(q[2], p[2]) - Math.max(q[0], p[0]) > 1;
  return pictures.map((p) => {
    const boxes = paragraphs.map((q, i) => ({ q, i }));
    if (boxes.some(({ q }) => !q)) return paragraphs.length;
    const below = boxes.find(({ q }) => overlaps(q!, p) && q![1] >= p[1] - 0.5);
    if (below) return below.i;
    const above = boxes.filter(({ q }) => overlaps(q!, p) && q![1] < p[1]);
    if (above.length) return above[above.length - 1]!.i + 1;
    const lower = boxes.find(({ q }) => q![1] >= p[1] - 0.5);
    return lower ? lower.i : paragraphs.length;
  });
}

function pictureBlock(page: DocxPage, pic: ScannedPicture): DocxPictureBlock {
  // A turned picture's extent is its own, unturned size: Word turns it.
  const s = fitToText(page, pic.width, pic.height);
  return {
    kind: "picture",
    media: pic.media,
    width: pic.width * s,
    height: pic.height * s,
    ...(pic.crop ? { crop: pic.crop } : {}),
    rotation:
      Math.min(pic.rotation, 360 - pic.rotation) < 0.01 ? 0 : pic.rotation,
    flipH: pic.flipH,
    flipV: pic.flipV,
  };
}

/**
 * Bold and italic for one paragraph, from the page reader's fonts: bold when
 * EVERY visible run of every line the reader drew inside the paragraph's
 * box is in a bold face, italic likewise; nothing when the reader drew no
 * visible line there. A whole paragraph or none: a bold word inside a
 * sentence is not carried, since poppler's words and pdf.js's runs are not
 * matched one to one. A title, a heading, a caption set in bold — what a
 * slide-like PDF is mostly made of — is. Lines are matched by their centre,
 * mapped into poppler's frame (`mediaFrame`).
 *
 * Since 2026-11-15 the FALLBACK only: a page that carries poppler's words
 * (`pieces`, every page read from a layout) gets each word's own style from
 * `./docx-run-style` instead; this serves a page built by hand.
 */
export function paragraphStyle(
  box: FlowBox | undefined,
  page: ScannedPage | undefined,
): { bold?: true; italic?: true } {
  if (!box || !page) return {};
  const lines = page.items.filter(
    (i): i is ScannedTextLine => i.kind === "text",
  );
  const runs = lines
    .filter((l) => {
      const [x0, y0, x1, y1] = mapBox(page.mediaFrame, [
        l.x,
        l.y,
        l.x + l.width,
        l.y + l.height,
      ]);
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      return (
        cx >= box[0] - 1 &&
        cx <= box[2] + 1 &&
        cy >= box[1] - 1 &&
        cy <= box[3] + 1
      );
    })
    .flatMap((l) => l.runs)
    .filter((r) => !r.invisible && r.text.trim());
  if (runs.length === 0) return {};
  return {
    ...(runs.every((r) => r.bold) ? { bold: true as const } : {}),
    ...(runs.every((r) => r.italic) ? { italic: true as const } : {}),
  };
}

/** The pictures a page reader found on `page`, in the order placed. */
export function scannedPictures(
  page: ScannedPage | undefined,
): ScannedPicture[] {
  return (page?.items ?? []).filter(
    (i): i is ScannedPicture => i.kind === "picture" && i.role === "image",
  );
}

/**
 * Each grid column's width in twips (#28 slice 2): from one column's start
 * to the next's — the last, its own span — scaled into the page's text area
 * when the table is wider, at least 1. Proportional, never a position: Word
 * may still wrap a cell, since its default font is not the PDF's.
 */
export function tableColumns(
  spans: readonly (readonly [number, number])[],
  page: DocxPage,
): number[] {
  const widths = spans.map((span, k) =>
    k + 1 < spans.length ? spans[k + 1]![0] - span[0] : span[1] - span[0],
  );
  let total = 0;
  for (const w of widths) total += w;
  const s = Math.min(1, (page.width - 2 * page.margin) / Math.max(total, 1e-9));
  return widths.map((w) => Math.max(1, Math.round(w * s * 20)));
}

/**
 * The document: every PDF page's paragraphs in poppler's order, with the
 * page's pictures placed among them by {@link insertionPoints}.
 *
 * TABLES (since #28 slice 2, 2026-11-15). Consecutive paragraphs the flow
 * marks as rows of one table (`PdfFlowTextPage.tables`) are gathered into
 * one {@link DocxTableBlock}: cell c of a row goes into the slot of its
 * column, `col[c]`, appended in order, so a row missing a value leaves that
 * slot empty and the values after it stay in their columns. Every cell's
 * runs are made exactly as a paragraph's are (coalesced, the cell's text
 * checked, a plain run where they would not match). A picture whose place
 * falls between two rows of one table goes after the table's last row: a
 * paragraph cannot stand inside a row. With `tables: false` (the engine's
 * size fallback) every table is written as its tabbed rows and counted.
 */
export function docxDocumentOf(
  flow: PdfFlowText,
  scan: PdfPageScan,
  options: { tables?: boolean } = {},
): DocxDocument {
  const first = scan.pages[0];
  const page = docxPageOf(first?.width ?? 612, first?.height ?? 792);
  const count = Math.max(flow.pageCount, scan.pageCount);
  const pages: DocxBlock[][] = [];
  // One lookup each, not a search per page: a 2,000-page document searched
  // its pages 2,000 times over.
  const flowPages = new Map(flow.pages.map((p) => [p.pageNumber, p]));
  const scanPages = new Map(scan.pages.map((p) => [p.pageNumber, p]));
  const formatting: DocxFormatting = { pages: [], runsDropped: 0 };
  let worded = false;
  const tables = { written: 0, asTabs: 0 };
  for (let n = 1; n <= count; n++) {
    const text = flowPages.get(n);
    const scanned = scanPages.get(n);
    const paragraphs = text?.paragraphs ?? [];
    const styled = text?.pieces ? runStylesOf(text, scanned) : null;
    if (styled) {
      worded = true;
      formatting.pages.push({
        pageNumber: n,
        matched: styled.matched,
        total: styled.total,
        capped: styled.capped,
        textUnread: scanned?.textUnread === true,
      });
    }
    const boxes = paragraphs.map((_, i) => text?.boxes?.[i]);
    const pictures = scannedPictures(scanned)
      .map((pic) => ({
        pic,
        box: mapBox(scanned?.mediaFrame, [
          pic.x,
          pic.y,
          pic.x + pic.width,
          pic.y + pic.height,
        ]),
      }))
      .sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0]);
    // The table rows this page writes as Word tables: by id, only where its
    // rows are consecutive (true by construction; otherwise tabbed rows,
    // counted, never a throw).
    tables.asTabs += text?.tablesAsTabs ?? 0;
    const rowOf = (i: number) =>
      options.tables === false ? undefined : text?.tables?.[i];
    const runIds = new Set<number>();
    const broken = new Set<number>();
    for (let i = 0; i < paragraphs.length; i++) {
      const row = rowOf(i);
      if (!row) continue;
      if (rowOf(i - 1)?.table === row.table) continue;
      if (runIds.has(row.table)) broken.add(row.table);
      runIds.add(row.table);
    }
    if (options.tables === false) {
      const ids = new Set(
        (text?.tables ?? []).flatMap((r) => (r ? [r.table] : [])),
      );
      tables.asTabs += ids.size;
    }
    tables.asTabs += broken.size;
    const tableAt = (i: number) => {
      const row = rowOf(i);
      return row && !broken.has(row.table) ? row : undefined;
    };
    const sameTable = (i: number) =>
      i > 0 &&
      i < paragraphs.length &&
      tableAt(i) !== undefined &&
      tableAt(i - 1)?.table === tableAt(i)!.table;
    const at = insertionPoints(
      boxes,
      pictures.map((p) => p.box),
    ).map((i) => {
      // Never between two rows of one table: after its last row.
      let j = i;
      while (sameTable(j)) j += 1;
      return j;
    });
    const runsOf = (i: number): (readonly DocxStyledRun[])[] | null => {
      const cells = paragraphs[i]!;
      const pieces = text?.pieces?.[i];
      if (!(styled && pieces)) return null;
      return cells.map((cell, c) => {
        const out = coalesce(
          (pieces[c] ?? []).map((piece, k) => ({
            text: piece.text,
            style: styled.styles[i]?.[c]?.[k] ?? null,
          })),
        );
        if (out.map((r) => r.text).join("") === cell) return out;
        // Never write different text: the cell goes out as one plain
        // run, and the engine's conservation check reads it back.
        formatting.runsDropped += 1;
        return [{ text: cell, style: null }];
      });
    };
    const blocks: DocxBlock[] = [];
    let table = null as { id: number; block: DocxTableBlock } | null;
    for (let i = 0; i <= paragraphs.length; i++) {
      pictures.forEach((p, k) => {
        if (at[k] === i) blocks.push(pictureBlock(page, p.pic));
      });
      if (i < paragraphs.length) {
        const cells = paragraphs[i]!;
        const runs = runsOf(i);
        const row = tableAt(i);
        if (row) {
          if (table?.id !== row.table) {
            table = {
              id: row.table,
              block: {
                kind: "table",
                columns: tableColumns(row.spans, page),
                rows: [],
              },
            };
            blocks.push(table.block);
            tables.written += 1;
          }
          const slots: (DocxStyledRun[][] | null)[] = row.spans.map(() => null);
          cells.forEach((cell, c) => {
            const k = row.col[c]!;
            (slots[k] ??= []).push([
              ...(runs?.[c] ?? [{ text: cell, style: null }]),
            ]);
          });
          (table.block.rows as DocxTableBlock["rows"][number][]).push({
            slots,
          });
          continue;
        }
        table = null;
        if (runs) blocks.push({ kind: "text", cells, runs });
        else
          blocks.push({
            kind: "text",
            cells,
            ...paragraphStyle(boxes[i], scanned),
          });
      }
    }
    pages.push(blocks);
  }
  return {
    page,
    pages,
    ...(worded ? { formatting } : {}),
    ...(tables.written > 0 || tables.asTabs > 0 ? { tables } : {}),
  };
}

/** Adjacent runs of one style, as one run. */
function coalesce(runs: readonly DocxStyledRun[]): DocxStyledRun[] {
  const out: DocxStyledRun[] = [];
  for (const run of runs) {
    const last = out[out.length - 1];
    if (last && runKey(last.style) === runKey(run.style))
      out[out.length - 1] = { text: last.text + run.text, style: last.style };
    else out.push({ ...run });
  }
  return out;
}
