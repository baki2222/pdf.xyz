import { PdfEngineError, loadPdf } from "./engine";
import { outputName } from "./files";
import { MAX_PAGE_SIDE_PT } from "./image-page-layout";
import {
  N_UP_MARGINS,
  N_UP_SHEETS,
  orientedSheet,
  type NUpMarginId,
} from "./n-up";
import { placeOverlay } from "./overlay";
import { visiblePageFrame, type Box } from "./page-frame";
import { loadPdfLib } from "./pdf-lib";
import { embedSourcePages } from "./sheet-embed";
import { stampProducer } from "./stamp";

/**
 * Booklet ("saddle-stitch imposition") — the pages of a PDF put two to a
 * side on landscape sheets, in the order that makes a booklet when the
 * sheets are printed on both sides, stacked, folded in half and stapled
 * along the fold.
 *
 * With P = the page count rounded up to a multiple of 4 and S = P / 4
 * sheets, sheet i (0-based, outermost first) carries
 *
 *    front:  P − 2i  |  2i + 1
 *    back:   2i + 2  |  P − 2i − 1
 *
 * and a logical page past the document's last is left blank. The order is
 * pure numbers ({@link bookletOrder}); `booklet.test.ts` checks it against
 * an independent model that folds the stacked sheets and reads the pages
 * off in turn, and reads every output side back with pdf.js.
 *
 * The page drawings are Multiple Pages per Sheet's (`embedSourcePages`):
 * vector, clipped to each page's visible box, with filled form values and
 * annotation appearances baked in, and each placed by `placeOverlay` so a
 * page's own `/Rotate` lands upright. The fold is exactly the middle of the
 * sheet ({@link bookletHalves}).
 */

/** The tool's slug: the n-up runner draws the booklet editor on this page. */
export const BOOKLET_SLUG = "booklet-pdf";

/** The run button's label and its busy label; the page's steps quote them. */
export const BOOKLET_RUN_LABEL = "Create booklet";
export const BOOKLET_BUSY_LABEL = "Creating…";
/** The result panel's title. */
export const BOOKLET_RESULT_TITLE = "Booklet created";

/** "Two pages at full size": each sheet two first pages wide. */
export const BOOKLET_DOUBLE_LABEL = "Two pages at full size";

export type BookletSheetId =
  Exclude<(typeof N_UP_SHEETS)[number]["id"], "source"> | "double";

export interface BookletSheet {
  id: BookletSheetId;
  label: string;
  /** Points, before turning landscape; absent for `double`. */
  size?: { width: number; height: number };
}

/**
 * The sheet sizes: Multiple Pages per Sheet's paper table, always turned
 * landscape, and {@link BOOKLET_DOUBLE_LABEL}.
 */
export const BOOKLET_SHEETS: readonly BookletSheet[] = [
  ...N_UP_SHEETS.flatMap((s) =>
    s.size && s.id !== "source"
      ? [{ id: s.id as BookletSheetId, label: s.label, size: s.size }]
      : [],
  ),
  { id: "double", label: BOOKLET_DOUBLE_LABEL },
];

export type BookletBinding = "left" | "right";

/**
 * The right-bound choice, for books read from right to left (Arabic,
 * Hebrew, manga): the booklet opens from the other side.
 */
export const BOOKLET_RTL_LABEL = "Right edge";

export const BOOKLET_BINDINGS: readonly {
  id: BookletBinding;
  label: string;
}[] = [
  { id: "left", label: "Left edge" },
  { id: "right", label: BOOKLET_RTL_LABEL },
];

export type BookletFlip = "short" | "long";

/**
 * The printer's two-sided setting the sheets are made for. On Long edge the
 * back of every sheet is drawn turned 180°, so it prints the right way up.
 */
export const BOOKLET_FLIPS: readonly { id: BookletFlip; label: string }[] = [
  { id: "short", label: "Short edge" },
  { id: "long", label: "Long edge" },
];

/** The back-cover checkbox: blank pages go before the last page. */
export const BOOKLET_BACK_COVER_LABEL = "Keep the last page as the back cover";

/** Why the back-cover checkbox is off, by the page count. */
export function bookletBackCoverBlocked(pageCount: number): string | null {
  if (pageCount <= 1) return "A one-page PDF has no last page to move.";
  if (pageCount % 4 === 0)
    return "Already a multiple of 4: no blank pages to move.";
  return null;
}

export interface BookletOptions {
  sheet: BookletSheetId;
  binding: BookletBinding;
  flip: BookletFlip;
  margin: NUpMarginId;
  /** Put the blank pages before the last page, which stays the back cover. */
  backCover: boolean;
}

export const DEFAULT_BOOKLET_OPTIONS: Readonly<BookletOptions> = {
  sheet: "a4",
  binding: "left",
  flip: "short",
  margin: "none",
  backCover: false,
};

/** One printed side: the 1-based source page in each half, or null for blank. */
export interface BookletSide {
  /** 0-based sheet, outermost first. */
  sheet: number;
  face: "front" | "back";
  left: number | null;
  right: number | null;
}

/** Logical pages: the count rounded up to a multiple of 4 (at least 4). */
export function bookletPageSlots(pageCount: number): number {
  return Math.max(4, Math.ceil(pageCount / 4) * 4);
}

/**
 * Every side in print order (sheet 1 front, sheet 1 back, sheet 2 front, …)
 * for a document of `pageCount` pages.
 */
export function bookletOrder(
  pageCount: number,
  options: Pick<BookletOptions, "binding" | "backCover">,
): BookletSide[] {
  if (!Number.isInteger(pageCount) || pageCount < 1) return [];
  const slots = bookletPageSlots(pageCount);
  const moveLast =
    options.backCover && bookletBackCoverBlocked(pageCount) === null;
  // Logical page k (1-based) → source page, or null for a blank.
  const source = (k: number): number | null => {
    if (moveLast) {
      if (k === slots) return pageCount;
      return k < pageCount ? k : null;
    }
    return k <= pageCount ? k : null;
  };
  const sides: BookletSide[] = [];
  for (let i = 0; i < slots / 4; i += 1) {
    const faces: ["front" | "back", number, number][] = [
      ["front", slots - 2 * i, 2 * i + 1],
      ["back", 2 * i + 2, slots - 2 * i - 1],
    ];
    for (const [face, l, r] of faces) {
      const [left, right] =
        options.binding === "right"
          ? [source(r), source(l)]
          : [source(l), source(r)];
      sides.push({ sheet: i, face, left, right });
    }
  }
  return sides;
}

/**
 * The two halves of a side, each inset by the margin on every edge, so the
 * gap at the fold is twice the margin and the fold is exactly at W / 2.
 */
export function bookletHalves(
  sheet: { width: number; height: number },
  margin: number,
): [Box, Box] {
  const half = sheet.width / 2;
  const box = (x: number): Box => ({
    x: x + margin,
    y: margin,
    width: half - 2 * margin,
    height: sheet.height - 2 * margin,
  });
  return [box(0), box(half)];
}

/**
 * The sheet, landscape. A paper size is turned landscape; `double` is two
 * first pages (as a viewer shows it) side by side, refused when that is
 * wider than PDF's page-side limit.
 */
export function bookletSheetSize(
  id: BookletSheetId,
  firstPage: { width: number; height: number },
): { width: number; height: number } {
  const paper = BOOKLET_SHEETS.find((s) => s.id === id)?.size;
  if (paper) return orientedSheet(paper, true);
  const size = { width: firstPage.width * 2, height: firstPage.height };
  if (size.width > MAX_PAGE_SIDE_PT || size.height > MAX_PAGE_SIDE_PT) {
    throw new PdfEngineError(
      `Two of this PDF's pages side by side would be ${Math.round(size.width).toLocaleString("en-US")} × ${Math.round(size.height).toLocaleString("en-US")} points, past PDF's limit of ${MAX_PAGE_SIDE_PT.toLocaleString("en-US")} points a side. Choose a paper size instead.`,
    );
  }
  return size;
}

function marginPoints(id: NUpMarginId): number {
  return N_UP_MARGINS.find((m) => m.id === id)?.points ?? 0;
}

/** "A, B or C". */
function choiceList(labels: readonly string[]): string {
  return `${labels.slice(0, -1).join(", ")} or ${labels.at(-1)}`;
}

/** Refuse an option the runner never offers, naming the ones it does. */
function checkOptions(options: BookletOptions): void {
  const bad = (
    table: readonly { id: string; label: string }[],
    id: string,
    what: string,
  ) => {
    if (!table.some((t) => t.id === id))
      throw new PdfEngineError(
        `Choose a ${what}: ${choiceList(table.map((t) => t.label))}.`,
      );
  };
  bad(BOOKLET_SHEETS, options.sheet, "sheet size");
  bad(BOOKLET_BINDINGS, options.binding, "binding");
  bad(BOOKLET_FLIPS, options.flip, "flip");
  bad(N_UP_MARGINS, options.margin, "margin");
}

export interface BookletResult {
  bytes: Uint8Array;
  sourcePages: number;
  /** Blank pages added to reach a multiple of 4. */
  blanks: number;
  sheets: number;
  /** PDF pages: two sides per sheet. */
  sides: number;
  /** The sheet, in points (landscape). */
  sheetSize: { width: number; height: number };
  flip: BookletFlip;
  /**
   * How large the pages are drawn, in whole percent of their own size: the
   * smallest and largest of every placed page. Equal when every page is the
   * same size.
   */
  scalePercent: { min: number; max: number };
  /**
   * Form fields whose value could not be drawn and that have a widget with
   * no stored appearance to bake: left off the booklet.
   */
  undrawnFields: string[];
}

/** What a PDF whose pages pdf-lib cannot draw is told. */
export const BOOKLET_LAYOUT_REFUSAL =
  "The pages of this PDF could not be put into a booklet — it may use features we can't process yet.";

/** Put every page of `bytes` into booklet order on landscape sheets. */
export async function bookletPdf(
  bytes: Uint8Array,
  options: BookletOptions,
): Promise<BookletResult> {
  checkOptions(options);
  // The field-tree repair `drawFieldValues` runs, requested WITH the parse:
  // a chained await is a round trip of its own. A failed load never awaits
  // it, so its rejection is marked handled here.
  const formTree = import("./form-tree");
  formTree.catch(() => {});
  const lib = await loadPdfLib();
  const source = await loadPdf(bytes);
  const pages = source.getPages();
  if (pages.length === 0) {
    throw new PdfEngineError("This PDF has no pages to lay out.");
  }

  const sheetSize = bookletSheetSize(
    options.sheet,
    visiblePageFrame(pages[0]!),
  );
  const halves = bookletHalves(sheetSize, marginPoints(options.margin));

  const out = await lib.PDFDocument.create();
  const { byIndex, undrawnFields } = await embedSourcePages(
    lib,
    source,
    out,
    (await formTree).repairFieldTree,
    BOOKLET_LAYOUT_REFUSAL,
  );

  const order = bookletOrder(pages.length, options);
  let min = Infinity;
  let max = 0;
  for (const side of order) {
    const sheet = out.addPage([sheetSize.width, sheetSize.height]);
    // Long edge: the back is drawn turned 180° about the sheet's centre, so
    // a printer that flips on the long edge prints it the right way up.
    const turn = options.flip === "long" && side.face === "back";
    if (turn) {
      sheet.pushOperators(
        lib.pushGraphicsState(),
        lib.concatTransformationMatrix(
          -1,
          0,
          0,
          -1,
          sheetSize.width,
          sheetSize.height,
        ),
      );
    }
    [side.left, side.right].forEach((pageNumber, h) => {
      if (pageNumber === null) return;
      const page = pages[pageNumber - 1]!;
      const frame = visiblePageFrame(page);
      const place = placeOverlay({
        pageBox: halves[h]!,
        pageRotation: 0,
        formWidth: frame.box.width,
        formHeight: frame.box.height,
        overlayRotation: frame.rotation,
        fit: "fit",
      });
      const scale = place.width / frame.box.width;
      if (Number.isFinite(scale)) {
        min = Math.min(min, scale);
        max = Math.max(max, scale);
      }
      const form = byIndex.get(pageNumber - 1);
      if (form) {
        sheet.drawPage(form, {
          x: place.x,
          y: place.y,
          width: place.width,
          height: place.height,
          rotate: lib.degrees(place.rotate),
        });
      }
    });
    if (turn) sheet.pushOperators(lib.popGraphicsState());
  }

  const title = source.getTitle();
  if (title) out.setTitle(title);
  stampProducer(out);
  const slots = bookletPageSlots(pages.length);
  return {
    bytes: await out.save(),
    sourcePages: pages.length,
    blanks: slots - pages.length,
    sheets: slots / 4,
    sides: order.length,
    sheetSize,
    flip: options.flip,
    scalePercent: {
      min: Math.round((Number.isFinite(min) ? min : 1) * 100),
      max: Math.round((max > 0 ? max : 1) * 100),
    },
    undrawnFields,
  };
}

/** "notes.pdf" → "notes-booklet.pdf". */
export function bookletOutputName(sourceName: string): string {
  return outputName(sourceName, "booklet");
}
