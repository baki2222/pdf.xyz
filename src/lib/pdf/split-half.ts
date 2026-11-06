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
 * inset by half its displayed width or height, the inset given in the
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

/** Left and right only: which half comes first in the output. */
export type SplitOrder = "left-first" | "right-first";

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
    hint: "A horizontal cut across the middle: each page becomes its top half, then its bottom half.",
  },
];

export const SPLIT_ORDERS: readonly { id: SplitOrder; label: string }[] = [
  { id: "left-first", label: "Left page first" },
  { id: "right-first", label: "Right page first" },
];

/** The run button's label, here so the page's steps quote the runner's word. */
export const SPLIT_HALF_RUN_LABEL = "Split pages";

export interface SplitHalfOptions {
  direction: SplitDirection;
  /** Ignored for top and bottom, whose top half always comes first. */
  order: SplitOrder;
  /** 0-based pages to split; omitted means every page. */
  pages?: number[];
  /** Leave the document's first page whole (a front cover). */
  keepFirstWhole?: boolean;
  /** Leave the document's last page whole (a back cover). */
  keepLastWhole?: boolean;
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
  if (direction === "top-bottom") return ["top", "bottom"];
  return order === "right-first" ? ["right", "left"] : ["left", "right"];
}

/** The inset, in the DISPLAYED frame, that leaves only `half` of the page. */
export function halfMargins(
  half: Half,
  displayed: { width: number; height: number },
): CropMargins {
  const none: CropMargins = { top: 0, right: 0, bottom: 0, left: 0 };
  switch (half) {
    case "left":
      return { ...none, right: displayed.width / 2 };
    case "right":
      return { ...none, left: displayed.width / 2 };
    case "top":
      return { ...none, bottom: displayed.height / 2 };
    case "bottom":
      return { ...none, top: displayed.height / 2 };
  }
}

/**
 * The CropBox (content space) that shows `half` of the page a reader sees, or
 * null when that half would be smaller than Crop PDF's floor.
 */
export function halfBox(frame: VisiblePageFrame, half: Half): Box | null {
  return insetBox(
    frame.box,
    toContentMargins(halfMargins(half, frame), frame.rotation),
  );
}

/** The 0-based pages that will be split, ascending. */
export function pagesToSplit(
  count: number,
  options: Pick<SplitHalfOptions, "pages" | "keepFirstWhole" | "keepLastWhole">,
): number[] {
  const chosen = new Set<number>();
  const from = options.pages ?? Array.from({ length: count }, (_, i) => i);
  for (const i of from) {
    if (Number.isInteger(i) && i >= 0 && i < count) chosen.add(i);
  }
  if (options.keepFirstWhole) chosen.delete(0);
  if (options.keepLastWhole) chosen.delete(count - 1);
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
  const split = pagesToSplit(count, options);
  if (split.length === 0) {
    throw new PdfEngineError(
      count === 1
        ? "This PDF has one page and it is set to stay whole, so there is nothing to split."
        : "No page is left to split. Choose at least one page that is not kept whole.",
    );
  }
  const halves = halvesInOrder(options.direction, options.order);
  const splitSet = new Set(split);
  const boxes = new Map<number, [Box, Box]>();
  for (const index of split) {
    const frame = visiblePageFrame(src.getPage(index));
    const first = halfBox(frame, halves[0]);
    const second = halfBox(frame, halves[1]);
    if (!first || !second) {
      throw new PdfEngineError(
        `Page ${index + 1} is too small to split: each half would be under ${MIN_CROP_DIMENSION} points.`,
      );
    }
    boxes.set(index, [first, second]);
  }

  const indices: number[] = [];
  for (let i = 0; i < count; i += 1) {
    indices.push(i);
    if (splitSet.has(i)) indices.push(i);
  }
  const { out, pages } = await assemblePages(lib, [{ doc: src, indices }], {
    documentState: "subset",
  });

  let at = 0;
  for (let i = 0; i < count; i += 1) {
    const pair = boxes.get(i);
    if (!pair) {
      at += 1;
      continue;
    }
    pair.forEach((box, n) => {
      pages[at + n]!.setCropBox(box.x, box.y, box.width, box.height);
    });
    keepAnnotationsOnTheirHalf(lib, [pages[at]!, pages[at + 1]!], pair);
    at += 2;
  }
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
