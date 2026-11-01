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
import { loadPdfLib } from "./pdf-lib";

/**
 * Split Pages in Half — each page of a scanned two-page spread becomes two
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
    at += 2;
  }

  stamp(out);
  return {
    bytes: await out.save(),
    sourcePages: count,
    splitPages: split.length,
    pageCount: pages.length,
  };
}

/** "book.pdf" → "book-halved.pdf". */
export function splitHalfOutputName(sourceName: string): string {
  return outputName(sourceName, "halved");
}
