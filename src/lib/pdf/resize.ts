import type { PDFDocument, PDFPage } from "pdf-lib";
import { PdfEngineError, loadPdf } from "./engine";
import { outputName } from "./files";
import { IMAGE_PAGE_SIZES } from "./image-page-layout";
import { visiblePageFrame, type Box, type PageRotation } from "./page-frame";
import { loadPdfLib, type PdfLibModule } from "./pdf-lib";
import { stampProducer } from "./stamp";

/**
 * Resize PDF — give pages a new size, two ways:
 *
 *  - "fit": the page becomes the target size and its visible content is
 *    scaled (down or up, proportions kept) to fit it, centred. Done IN PLACE —
 *    the page's own content stream is wrapped in one `cm`, and every
 *    annotation's points (`Rect`, `QuadPoints`, `L`, `Vertices`, `CL`,
 *    `InkList`) go through the same matrix, once per annotation, as does
 *    every explicit destination that opens the page (bookmarks, links,
 *    named destinations) — so links, comments, form fields and the places
 *    bookmarks jump to stay on the page, at the right spot. `/RD` (the inset
 *    of a Square, Circle or FreeText border inside its Rect) is NOT scaled:
 *    a viewer draws the stored appearance stream regardless, and only a
 *    viewer that regenerates the appearance would read an unscaled inset.
 *    Until audit #26
 *    (2026-11-06) only `Rect` and `QuadPoints` moved, and destinations not
 *    at all.
 *    (Embedding the page as a form XObject would scale the drawing and leave
 *    every annotation behind.)
 *  - "canvas": the content keeps its size; only the page box changes, centred
 *    on what the reader saw. A bigger target adds blank margin; a smaller one
 *    hides what falls outside — hidden, not deleted, like a crop.
 *
 * Every size is the size a reader SEES: on a page carrying `/Rotate 90` the
 * box is laid out swapped, so the displayed page is the target. `resize.test.ts`
 * re-opens outputs with pdf.js and checks displayed sizes and where a mark on
 * the page lands.
 */

export type ResizeMode = "fit" | "canvas";

export const RESIZE_MODES: readonly {
  id: ResizeMode;
  label: string;
  hint: string;
}[] = [
  {
    id: "fit",
    label: "Scale content to fit",
    hint: "The page takes the new size and its content is scaled to fit, centred.",
  },
  {
    id: "canvas",
    label: "Change canvas only",
    hint: "The content keeps its size; the page grows or shrinks around it, centred.",
  },
];

export type ResizeSizeId = "a4" | "letter" | "legal" | "a3" | "a5" | "custom";

/** The named targets — the same table Image to PDF draws its pages from. */
export const RESIZE_SIZES: readonly {
  id: Exclude<ResizeSizeId, "custom">;
  label: string;
  size: { width: number; height: number };
}[] = (["a4", "letter", "legal", "a3", "a5"] as const).map((id) => {
  const found = IMAGE_PAGE_SIZES.find((s) => s.id === id);
  if (!found?.size) throw new Error(`resize: no page size "${id}"`);
  return { id, label: found.label, size: found.size };
});

export type ResizeOrientation = "match" | "portrait" | "landscape";

export const RESIZE_ORIENTATIONS: readonly {
  id: ResizeOrientation;
  label: string;
}[] = [
  { id: "match", label: "Match each page" },
  { id: "portrait", label: "Portrait" },
  { id: "landscape", label: "Landscape" },
];

/** The smallest and largest side accepted, in points (1 in; PDF's 200 in). */
export const MIN_RESIZE_SIDE_PT = 72;
export const MAX_RESIZE_SIDE_PT = 14_400;

export interface ResizeOptions {
  /** Target size in points, portrait or landscape as given. */
  width: number;
  height: number;
  orientation: ResizeOrientation;
  mode: ResizeMode;
  /** 0-based pages to resize; omitted means every page. */
  pages?: number[];
}

export interface ResizeResult {
  bytes: Uint8Array;
  pageCount: number;
  resizedPages: number;
}

/** The size, turned to the orientation asked for (or the page's own). */
export function orientedTarget(
  target: { width: number; height: number },
  orientation: ResizeOrientation,
  displayed: { width: number; height: number },
): { width: number; height: number } {
  const short = Math.min(target.width, target.height);
  const long = Math.max(target.width, target.height);
  const landscape =
    orientation === "landscape" ||
    (orientation === "match" && displayed.width > displayed.height);
  return landscape
    ? { width: long, height: short }
    : { width: short, height: long };
}

/** A displayed size in the page's unrotated content space. */
function contentSize(
  displayed: { width: number; height: number },
  rotation: PageRotation,
): { width: number; height: number } {
  return rotation === 90 || rotation === 270
    ? { width: displayed.height, height: displayed.width }
    : displayed;
}

export interface FitTransform {
  /** Uniform scale applied to the content. */
  scale: number;
  /** Translation after scaling, in the new page's content space. */
  tx: number;
  ty: number;
}

/**
 * The `cm` that maps the old visible box onto a `width` × `height` page
 * (content space, origin 0,0): proportions kept, centred.
 */
export function fitTransform(
  box: Box,
  width: number,
  height: number,
): FitTransform {
  const scale = Math.min(width / box.width, height / box.height);
  return {
    scale,
    tx: (width - box.width * scale) / 2 - box.x * scale,
    ty: (height - box.height * scale) / 2 - box.y * scale,
  };
}

/** The new page box for "canvas": the target size, centred on the old box. */
export function canvasBox(box: Box, width: number, height: number): Box {
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  };
}

function sanitizeIndices(indices: number[], count: number): number[] {
  const set = new Set<number>();
  for (const i of indices) {
    if (Number.isInteger(i) && i >= 0 && i < count) set.add(i);
  }
  return [...set].sort((a, b) => a - b);
}

/** Print-production boxes; none is inheritable, so deleting them is enough. */
const PRINT_BOXES = ["BleedBox", "TrimBox", "ArtBox"] as const;

/**
 * Make `box` the page: MediaBox and CropBox both (a CropBox can be inherited
 * from the page tree, so it is SET, not deleted), print boxes dropped.
 */
function setPageBox(lib: PdfLibModule, page: PDFPage, box: Box): void {
  page.setMediaBox(box.x, box.y, box.width, box.height);
  page.setCropBox(box.x, box.y, box.width, box.height);
  for (const name of PRINT_BOXES) page.node.delete(lib.PDFName.of(name));
}

/** Wrap the page's content in `q <cm> … Q`, as streams of their own. */
function wrapContent(
  lib: PdfLibModule,
  doc: PDFDocument,
  page: PDFPage,
  t: FitTransform,
): void {
  const { PDFArray, PDFName } = lib;
  const n = (v: number) => Number(v.toFixed(6)).toString();
  const enc = new TextEncoder();
  const head = doc.context.register(
    doc.context.stream(
      enc.encode(
        `q ${n(t.scale)} 0 0 ${n(t.scale)} ${n(t.tx)} ${n(t.ty)} cm\n`,
      ),
    ),
  );
  const tail = doc.context.register(doc.context.stream(enc.encode("\nQ\n")));
  const key = PDFName.of("Contents");
  const existing = page.node.get(key);
  const resolved = existing ? doc.context.lookup(existing) : undefined;
  const items =
    resolved instanceof PDFArray
      ? resolved.asArray()
      : existing
        ? [existing]
        : [];
  page.node.set(key, doc.context.obj([head, ...items, tail]));
}

/** Put a flat x,y,x,y… number array through the fit transform. */
function transformPoints(values: number[], t: FitTransform): number[] {
  return values.map((v, i) =>
    i % 2 === 0 ? v * t.scale + t.tx : v * t.scale + t.ty,
  );
}

/**
 * The annotation keys that hold points in the page's user space, flat
 * x,y,x,y…: the box, text-markup quads, a line's ends, a polygon's or
 * polyline's vertices, a free-text callout. `InkList` holds arrays of them.
 */
const POINT_KEYS = ["Rect", "QuadPoints", "L", "Vertices", "CL"] as const;

function transformAnnotations(
  lib: PdfLibModule,
  doc: PDFDocument,
  page: PDFPage,
  t: FitTransform,
  done: Set<unknown>,
): void {
  const { PDFArray, PDFDict, PDFName, PDFNumber } = lib;
  const annots = page.node.Annots();
  if (!annots) return;
  /** The numbers of `raw`, or undefined when it is not all numbers. */
  const numbersOf = (raw: unknown): number[] | undefined => {
    const arr = raw ? doc.context.lookup(raw as never) : undefined;
    if (!(arr instanceof PDFArray)) return undefined;
    const nums = arr
      .asArray()
      .map((v) => doc.context.lookup(v))
      .map((v) => (v instanceof PDFNumber ? v.asNumber() : NaN));
    return nums.some((v) => !Number.isFinite(v)) ? undefined : nums;
  };
  for (let i = 0; i < annots.size(); i += 1) {
    const annot = doc.context.lookup(annots.get(i));
    if (!(annot instanceof PDFDict)) continue;
    // Two pages may list one annotation object: it is moved once.
    if (done.has(annot)) continue;
    done.add(annot);
    for (const name of POINT_KEYS) {
      const key = PDFName.of(name);
      const nums = numbersOf(annot.get(key));
      if (nums) annot.set(key, doc.context.obj(transformPoints(nums, t)));
    }
    const ink = annot.lookupMaybe(PDFName.of("InkList"), PDFArray);
    if (ink) {
      const paths = ink.asArray().map((path) => numbersOf(path));
      if (paths.every((p) => p !== undefined)) {
        annot.set(
          PDFName.of("InkList"),
          doc.context.obj(paths.map((p) => transformPoints(p, t))),
        );
      }
    }
  }
}

/**
 * The coordinates an explicit destination holds, by position after the page
 * and the fit type (ISO 32000-2 table 151): "x" or "y" in the page's user
 * space. `/Fit` and `/FitB` hold none; `/XYZ`'s third number is a zoom.
 */
const DESTINATION_COORDINATES: Record<string, ("x" | "y")[]> = {
  XYZ: ["x", "y"],
  FitH: ["y"],
  FitBH: ["y"],
  FitV: ["x"],
  FitBV: ["x"],
  FitR: ["x", "y", "x", "y"],
};

/**
 * Put every explicit destination that opens a resized page through that
 * page's fit transform: bookmarks, links, GoTo actions, named destinations,
 * the open action — wherever one sits. They are found by SHAPE (an array
 * whose first item is a resized page and whose second is a fit type), over
 * every object in the file, rather than by walking a list of the places a
 * destination may hang, so one in a place nobody listed still moves. A `null`
 * coordinate ("keep the current one") stays null.
 */
function transformDestinations(
  lib: PdfLibModule,
  doc: PDFDocument,
  byPage: Map<unknown, FitTransform>,
): void {
  const { PDFArray, PDFDict, PDFName, PDFNumber, PDFRef, PDFStream } = lib;
  const context = doc.context;
  const seen = new Set<unknown>();
  const visit = (obj: unknown, depth: number): void => {
    if (depth > 64 || seen.has(obj)) return;
    if (obj instanceof PDFArray) {
      seen.add(obj);
      const page = obj.get(0);
      const kind = obj.size() > 1 ? obj.get(1) : undefined;
      const t = page instanceof PDFRef ? byPage.get(page) : undefined;
      const slots =
        kind instanceof PDFName
          ? DESTINATION_COORDINATES[kind.decodeText()]
          : undefined;
      if (t && slots) {
        slots.forEach((axis, k) => {
          const value = context.lookup(obj.get(k + 2));
          if (!(value instanceof PDFNumber)) return;
          const v = value.asNumber();
          obj.set(
            k + 2,
            PDFNumber.of(
              axis === "x" ? v * t.scale + t.tx : v * t.scale + t.ty,
            ),
          );
        });
        return;
      }
      obj.asArray().forEach((item) => visit(item, depth + 1));
    } else if (obj instanceof PDFDict) {
      seen.add(obj);
      for (const [, value] of obj.entries()) visit(value, depth + 1);
    } else if (obj instanceof PDFStream) {
      seen.add(obj);
      visit(obj.dict, depth);
    }
  };
  for (const [, obj] of context.enumerateIndirectObjects()) visit(obj, 0);
}

/** Resize the chosen pages of a PDF. */
export async function resizePdf(
  bytes: Uint8Array,
  options: ResizeOptions,
): Promise<ResizeResult> {
  const { width, height } = options;
  for (const side of [width, height]) {
    if (
      !Number.isFinite(side) ||
      side < MIN_RESIZE_SIDE_PT ||
      side > MAX_RESIZE_SIDE_PT
    ) {
      throw new PdfEngineError(
        `Each side of the new page size must be between ${MIN_RESIZE_SIDE_PT} and ${MAX_RESIZE_SIDE_PT.toLocaleString("en-US")} points (1 to 200 inches).`,
      );
    }
  }
  const lib = await loadPdfLib();
  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  const scoped =
    options.pages === undefined
      ? pages.map((_, i) => i)
      : sanitizeIndices(options.pages, pages.length);
  if (scoped.length === 0) {
    throw new PdfEngineError("Select at least one page to resize.");
  }

  const moved = new Set<unknown>();
  const fitted = new Map<unknown, FitTransform>();
  for (const index of scoped) {
    const page = pages[index];
    if (!page) continue;
    const frame = visiblePageFrame(page);
    const displayed = orientedTarget(
      { width, height },
      options.orientation,
      frame,
    );
    const content = contentSize(displayed, frame.rotation);
    if (options.mode === "canvas") {
      setPageBox(
        lib,
        page,
        canvasBox(frame.box, content.width, content.height),
      );
      continue;
    }
    const t = fitTransform(frame.box, content.width, content.height);
    wrapContent(lib, doc, page, t);
    transformAnnotations(lib, doc, page, t, moved);
    fitted.set(page.ref, t);
    setPageBox(lib, page, {
      x: 0,
      y: 0,
      width: content.width,
      height: content.height,
    });
  }

  if (fitted.size > 0) transformDestinations(lib, doc, fitted);

  stampProducer(doc);
  return {
    bytes: await doc.save(),
    pageCount: pages.length,
    resizedPages: scoped.length,
  };
}

/** "report.pdf" → "report-resized.pdf". */
export function resizeOutputName(sourceName: string): string {
  return outputName(sourceName, "resized");
}
