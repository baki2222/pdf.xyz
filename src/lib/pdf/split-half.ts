import type { PDFDict, PDFPage } from "pdf-lib";
import { insetBox, toContentMargins, type CropMargins } from "./crop";
import { PdfEngineError, loadPdf, stamp } from "./engine";
import { outputName } from "./files";
import { assemblePages } from "./page-copy";
import {
  visiblePageFrame,
  type Box,
  type VisiblePageFrame,
} from "./page-frame";
import { MIN_CROP_DIMENSION } from "./page-geometry";
import { loadPdfLib, type PdfLibModule } from "./pdf-lib";

/**
 * Split PDF Pages in Half — each page of a scanned two-page spread becomes two
 * pages, one per half, in the browser.
 *
 * Every split page is copied TWICE through `assemblePages` (the one way page
 * tools copy pages; its duplicate path is Organize's), and each copy gets a
 * CropBox that is one half of the page AS A READER SEES IT. The halves are
 * not a second geometry: a half is the page's visible frame
 * (`visiblePageFrame`: CropBox clipped to MediaBox, turned by `/Rotate`)
 * inset at the cut position (`position`, the middle unless set) of its
 * displayed width or height, the inset given in the
 * displayed frame and mapped into content space by Crop PDF's own
 * `toContentMargins`, then applied by Crop PDF's own `insetBox`. On a
 * `/Rotate 90` page the displayed left half is therefore the content's TOP
 * half, and it is what a viewer shows on the left.
 *
 * Only the CropBox is written, exactly as Crop PDF writes it: the MediaBox,
 * the `/Rotate` and the content streams are left as they were, so the half
 * a page does not show is hidden, not deleted (`crop-disclosure.ts` says so on
 * the page). The two copies of a page share its content streams and
 * resources — the duplicate is a second page object, not a second copy of the
 * drawing — so the file holds each page's drawing once.
 *
 * The proof is pdf.js reading the SAVED file (`split-half.test.ts`): page
 * count, each half's displayed size, and the rendered pixels of each half.
 */

/** Which way each page is cut. */
export type SplitDirection = "left-right" | "top-bottom";

/**
 * Which half comes first in the output. The ids name the left and right cut;
 * on a top and bottom cut `left-first` is the top half first and
 * `right-first` the bottom half first (`SPLIT_ORDER_CHOICES` labels each).
 *
 * `booklet` (audit split-pdf-pages-in-half#2, 2026-11-22) is a folded
 * booklet scanned sheet by sheet: for 8 pages the sheets read 8|1, 2|7, 6|3,
 * 4|5, and the halves are put back in reading order, 1 to 8
 * (`bookletPageNumber`). Until then the output was always in source order.
 */
export type SplitOrder = "left-first" | "right-first" | "booklet";

export const SPLIT_DIRECTIONS: readonly {
  id: SplitDirection;
  label: string;
  hint: string;
}[] = [
  {
    id: "left-right",
    label: "Left and right",
    hint: "A vertical cut down the middle: each page becomes its left half and its right half.",
  },
  {
    id: "top-bottom",
    label: "Top and bottom",
    hint: "A horizontal cut across the middle: each page becomes its top half and its bottom half.",
  },
];

export const SPLIT_ORDERS: readonly { id: SplitOrder; label: string }[] = [
  { id: "left-first", label: "Left page first" },
  { id: "right-first", label: "Right page first" },
];

/** The booklet order's choice, offered on both cuts. */
export const BOOKLET_ORDER = {
  id: "booklet",
  label: "Booklet scan",
} as const satisfies { id: SplitOrder; label: string };

/** What the booklet order does, said under the control and on the page. */
export const BOOKLET_ORDER_HINT =
  "For a folded booklet scanned one sheet at a time (for 8 pages: 8 and 1, 2 and 7, 6 and 3, 4 and 5): the halves are put back in reading order.";

/**
 * The Page order choices as the runner labels them for each cut. Until
 * 2026-11-08 a top and bottom cut ignored the order and the runner hid the
 * control, so a sheet whose lower page is read first could not be split in
 * reading order.
 */
export const SPLIT_ORDER_CHOICES: Readonly<
  Record<SplitDirection, readonly { id: SplitOrder; label: string }[]>
> = {
  "left-right": [...SPLIT_ORDERS, BOOKLET_ORDER],
  "top-bottom": [
    { id: "left-first", label: "Top half first" },
    { id: "right-first", label: "Bottom half first" },
    BOOKLET_ORDER,
  ],
};

/** The hint under Page order, for each choice. */
export function orderHint(
  direction: SplitDirection,
  order: SplitOrder,
): string {
  if (order === BOOKLET_ORDER.id) return BOOKLET_ORDER_HINT;
  return direction === "left-right"
    ? "Right page first suits books read right to left."
    : "Bottom half first suits a sheet whose lower page is read first.";
}

/**
 * Where the cut falls, as a percentage of the displayed width (left and
 * right) or height (top and bottom), from the left or the top. Until audit
 * split-pdf-pages-in-half#1 (2026-11-22) it was always the middle.
 */
export const SPLIT_POSITION = { min: 10, max: 90, middle: 50 } as const;

/** The shape option's label for each cut, as the runner shows it. */
export const ONLY_WIDER_LABELS: Readonly<Record<SplitDirection, string>> = {
  "left-right": "Only split pages wider than tall",
  "top-bottom": "Only split pages taller than wide",
};

/** The run button's label, here so the page's steps quote the runner's word. */
export const SPLIT_HALF_RUN_LABEL = "Split pages";

export interface SplitHalfOptions {
  direction: SplitDirection;
  /** Which half comes first, on either cut (see {@link SplitOrder}). */
  order: SplitOrder;
  /** 0-based pages to split; omitted means every page. */
  pages?: number[];
  /** Leave the document's first page whole (a front cover). */
  keepFirstWhole?: boolean;
  /** Leave the document's last page whole (a back cover). */
  keepLastWhole?: boolean;
  /**
   * Where the cut falls, in percent of the displayed width or height from
   * the left or top (`SPLIT_POSITION`); omitted, the middle.
   */
  position?: number;
  /**
   * Split only the pages whose displayed shape suits the cut: wider than
   * tall for left and right, taller than wide for top and bottom. Single
   * pages among the spreads stay whole (audit split-pdf-pages-in-half#3).
   */
  onlyWider?: boolean;
}

export interface SplitHalfResult {
  bytes: Uint8Array;
  /** Pages in the source. */
  sourcePages: number;
  /** Source pages that were split in two. */
  splitPages: number;
  /** Pages in the output: `sourcePages + splitPages`. */
  pageCount: number;
}

type Half = "left" | "right" | "top" | "bottom";

/** The halves of a page in output order. */
export function halvesInOrder(
  direction: SplitDirection,
  order: SplitOrder,
): [Half, Half] {
  if (direction === "top-bottom")
    return order === "right-first" ? ["bottom", "top"] : ["top", "bottom"];
  return order === "right-first" ? ["right", "left"] : ["left", "right"];
}

/**
 * The inset, in the DISPLAYED frame, that leaves only `half` of the page,
 * cut at `position` percent of the width or height from the left or top.
 */
export function halfMargins(
  half: Half,
  displayed: { width: number; height: number },
  position: number = SPLIT_POSITION.middle,
): CropMargins {
  const none: CropMargins = { top: 0, right: 0, bottom: 0, left: 0 };
  const at = position / 100;
  switch (half) {
    case "left":
      return { ...none, right: displayed.width * (1 - at) };
    case "right":
      return { ...none, left: displayed.width * at };
    case "top":
      return { ...none, bottom: displayed.height * (1 - at) };
    case "bottom":
      return { ...none, top: displayed.height * at };
  }
}

/** A cut position kept inside `SPLIT_POSITION`; anything else is the middle. */
export function clampSplitPosition(position: number | undefined): number {
  if (position === undefined || !Number.isFinite(position))
    return SPLIT_POSITION.middle;
  return Math.min(SPLIT_POSITION.max, Math.max(SPLIT_POSITION.min, position));
}

/**
 * The CropBox (content space) that shows `half` of the page a reader sees, or
 * null when that half would be smaller than Crop PDF's floor.
 */
export function halfBox(
  frame: VisiblePageFrame,
  half: Half,
  position: number = SPLIT_POSITION.middle,
): Box | null {
  return insetBox(
    frame.box,
    toContentMargins(halfMargins(half, frame, position), frame.rotation),
  );
}

/** Does a page of this displayed shape suit the cut? */
export function suitsCut(
  direction: SplitDirection,
  shape: { width: number; height: number },
): boolean {
  return direction === "left-right"
    ? shape.width > shape.height
    : shape.height > shape.width;
}

/**
 * The page number (1-based, in reading order) of one half of a booklet
 * scanned sheet by sheet: sheet `sheet` (0-based) of `sheets`, its first
 * half (left, or top) or its second. For 4 sheets: 8|1, 2|7, 6|3, 4|5.
 */
export function bookletPageNumber(
  sheet: number,
  sheets: number,
  first: boolean,
): number {
  const outer = 2 * sheets - sheet;
  const inner = sheet + 1;
  // An even sheet shows its outer page first, an odd one its inner page.
  return (sheet % 2 === 0) === first ? outer : inner;
}

/** The 0-based pages that will be split, ascending. */
export function pagesToSplit(
  count: number,
  options: Pick<
    SplitHalfOptions,
    "pages" | "keepFirstWhole" | "keepLastWhole" | "onlyWider"
  > & { direction?: SplitDirection },
  /** Each page's DISPLAYED shape, read when `onlyWider` is set. */
  shapes?: readonly { width: number; height: number }[],
): number[] {
  const chosen = new Set<number>();
  const from = options.pages ?? Array.from({ length: count }, (_, i) => i);
  for (const i of from) {
    if (Number.isInteger(i) && i >= 0 && i < count) chosen.add(i);
  }
  if (options.keepFirstWhole) chosen.delete(0);
  if (options.keepLastWhole) chosen.delete(count - 1);
  if (options.onlyWider) {
    if (!shapes) throw new Error("pagesToSplit: onlyWider needs the shapes");
    const direction = options.direction ?? "left-right";
    for (const i of [...chosen]) {
      const shape = shapes[i];
      if (!shape || !suitsCut(direction, shape)) chosen.delete(i);
    }
  }
  return [...chosen].sort((a, b) => a - b);
}

/** Split the chosen pages of a PDF into halves. */
export async function splitPagesInHalf(
  bytes: Uint8Array,
  options: SplitHalfOptions,
): Promise<SplitHalfResult> {
  const lib = await loadPdfLib();
  const src = await loadPdf(bytes);
  const count = src.getPageCount();
  const frames = Array.from({ length: count }, (_, i) =>
    visiblePageFrame(src.getPage(i)),
  );
  const split = pagesToSplit(count, options, frames);
  if (split.length === 0) {
    throw new PdfEngineError(
      options.onlyWider
        ? `No page has the right shape to split: with “${ONLY_WIDER_LABELS[options.direction]}” ticked, every page stays whole.`
        : count === 1
          ? "This PDF has one page and it is set to stay whole, so there is nothing to split."
          : "No page is left to split. Choose at least one page that is not kept whole.",
    );
  }
  const position = clampSplitPosition(options.position);
  const halves = halvesInOrder(options.direction, options.order);
  const splitSet = new Set(split);
  const boxes = new Map<number, [Box, Box]>();
  for (const index of split) {
    const frame = frames[index]!;
    const first = halfBox(frame, halves[0], position);
    const second = halfBox(frame, halves[1], position);
    if (!first || !second) {
      throw new PdfEngineError(
        `Page ${index + 1} is too small to split there: one half would be under ${MIN_CROP_DIMENSION} points.`,
      );
    }
    boxes.set(index, [first, second]);
  }

  // The output, one entry per page: its source page, and which of that
  // page's two halves it shows (none for a page kept whole).
  const plan: { index: number; half?: 0 | 1 }[] = [];
  if (options.order === "booklet") {
    plan.push(...bookletPlan(count, split));
  } else {
    for (let i = 0; i < count; i += 1) {
      if (splitSet.has(i))
        plan.push({ index: i, half: 0 }, { index: i, half: 1 });
      else plan.push({ index: i });
    }
  }
  const { out, pages } = await assemblePages(
    lib,
    [{ doc: src, indices: plan.map((p) => p.index) }],
    { documentState: "subset" },
  );

  const pairs = new Map<number, (PDFPage | undefined)[]>();
  plan.forEach(({ index, half }, at) => {
    if (half === undefined) return;
    const box = boxes.get(index)![half];
    pages[at]!.setCropBox(box.x, box.y, box.width, box.height);
    const pair = pairs.get(index) ?? [undefined, undefined];
    pair[half] = pages[at];
    pairs.set(index, pair);
  });
  for (const [index, [first, second]] of pairs)
    keepAnnotationsOnTheirHalf(lib, [first!, second!], boxes.get(index)!);
  // The source's labels counted its sheets, which the split replaces: each
  // copy took its sheet's label, so both halves of sheet 2 read "2" and a
  // typed page number landed on the left half (audit #43). With no labels a
  // viewer numbers every page, one number each.
  out.catalog.delete(lib.PDFName.of("PageLabels"));

  stamp(out);
  return {
    bytes: await out.save(),
    sourcePages: count,
    splitPages: split.length,
    pageCount: pages.length,
  };
}

/**
 * The booklet order's output: a front cover kept whole first, then every
 * half of the split sheets by its page number (`bookletPageNumber`), then a
 * back cover kept whole. A page left whole anywhere else has no place in a
 * booklet's reading order, so it is refused rather than guessed at.
 */
function bookletPlan(
  count: number,
  split: readonly number[],
): { index: number; half?: 0 | 1 }[] {
  const first = split[0]!;
  const last = split[split.length - 1]!;
  const gaps = last - first + 1 - split.length;
  if (first > 1 || last < count - 2 || gaps > 0) {
    throw new PdfEngineError(
      `${BOOKLET_ORDER.label} puts every half in reading order, so every page between the covers must be split. Split every page, keeping only the first or last page whole, or choose another page order.`,
    );
  }
  const halves = split.flatMap((index, sheet) =>
    ([0, 1] as const).map((half) => ({
      index,
      half,
      n: bookletPageNumber(sheet, split.length, half === 0),
    })),
  );
  halves.sort((a, b) => a.n - b.n);
  return [
    ...(first === 1 ? [{ index: 0 }] : []),
    ...halves.map(({ index, half }) => ({ index, half })),
    ...(last === count - 2 ? [{ index: count - 1 }] : []),
  ];
}

/**
 * Leave each annotation only on the half its `/Rect` meets. Both copies of a
 * split page come out of `assemblePages` with every annotation of the page
 * (the second as clones, its widgets joined to the same fields), so a note on
 * the right half also sat, out of view, on the left half's page: twice in a
 * viewer's comment list, and a second widget for each field (audit #43).
 *
 * One that meets both halves (across the fold) stays on both; one that meets
 * neither (outside the visible box) stays on the first, as one copy of the
 * page would hold it. A popup goes where its parent goes. A widget taken off
 * a page is taken out of its field's `/Kids` too.
 */
function keepAnnotationsOnTheirHalf(
  lib: PdfLibModule,
  pages: [PDFPage, PDFPage],
  boxes: [Box, Box],
): void {
  const { PDFArray, PDFDict, PDFName, PDFNumber } = lib;
  const context = pages[0].doc.context;
  const meets = (annot: PDFDict, box: Box): boolean => {
    const rect = annot.lookupMaybe(PDFName.of("Rect"), PDFArray);
    const nums = rect
      ?.asArray()
      .map((v) => context.lookup(v))
      .map((v) => (v instanceof PDFNumber ? v.asNumber() : NaN));
    if (!nums || nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) {
      return true;
    }
    const [x0, y0, x1, y1] = nums as [number, number, number, number];
    return (
      Math.max(x0, x1) > box.x &&
      Math.min(x0, x1) < box.x + box.width &&
      Math.max(y0, y1) > box.y &&
      Math.min(y0, y1) < box.y + box.height
    );
  };
  pages.forEach((page, n) => {
    const own = boxes[n]!;
    const other = boxes[1 - n]!;
    const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) return;
    const belongs = (annot: PDFDict): boolean => {
      const isPopup = annot.get(PDFName.of("Subtype")) === PDFName.of("Popup");
      const parent = isPopup
        ? annot.lookupMaybe(PDFName.of("Parent"), PDFDict)
        : undefined;
      const judged = parent ?? annot;
      return meets(judged, own) || (n === 0 && !meets(judged, other));
    };
    const kept = annots.asArray().filter((entry) => {
      const annot = context.lookup(entry);
      if (!(annot instanceof PDFDict) || belongs(annot)) return true;
      if (annot.get(PDFName.of("Subtype")) === PDFName.of("Widget")) {
        const kids = annot
          .lookupMaybe(PDFName.of("Parent"), PDFDict)
          ?.lookupMaybe(PDFName.of("Kids"), PDFArray);
        const at = kids?.indexOf(entry);
        if (kids && at !== undefined) kids.remove(at);
      }
      return false;
    });
    page.node.set(PDFName.of("Annots"), context.obj(kept));
  });
}

/** "book.pdf" → "book-halved.pdf". */
export function splitHalfOutputName(sourceName: string): string {
  return outputName(sourceName, "halved");
}
