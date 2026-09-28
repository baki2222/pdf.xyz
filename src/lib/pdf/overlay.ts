import type { PDFDocument, PDFEmbeddedPage, PDFPage } from "pdf-lib";
import { PdfEncryptedError, PdfEngineError } from "./engine";
import { outputName } from "./files";
import { loadPdfLib, type PdfLibModule } from "./pdf-lib";
import { loadPdf, stampProducer } from "./stamp";
import type { OverlayFit } from "./offered-kinds";

/**
 * Overlay one PDF onto another, entirely in-browser with pdf-lib. The
 * overlay/stamp document's page(s) are embedded as Form XObjects into the base
 * document and drawn on each base page — on top, behind the page's own content,
 * or on top with a Multiply blend — as real vector content, not a raster, so
 * text and graphics in both documents stay crisp and selectable.
 *
 * GEOMETRY CONTRACT — both pages as a VIEWER shows them:
 *  - the base page's frame is its visible box (CropBox ∩ MediaBox, the box
 *    pdf.js and Acrobat display) turned by its `/Rotate`;
 *  - the overlay is what a viewer shows of the overlay page: only its visible
 *    box, turned by ITS `/Rotate`, plus the appearance of any visible
 *    annotation or form field on it (a viewer paints those; a bare page embed
 *    would not).
 * So a letterhead lands upright at the top of a `/Rotate 90` page, inside a
 * page cropped by the Crop tool, and a stamp cropped out of a scan brings only
 * the stamp. `overlay-output.test.ts` holds this against pdf.js renders of the
 * output bytes, for bases and overlays made by our own Crop and Rotate tools.
 *
 * The geometry and page-mapping are pure functions ({@link placeOverlay},
 * {@link fitOverlayRect}, {@link overlayPageIndexFor}) so they can also be
 * unit-tested with plain numbers.
 */

// The offered scale modes live in the offered-kinds leaf, where the tool page's
// answer reads them too; re-exported so existing importers keep working.
export type { OverlayFit, OverlayFitOption } from "./offered-kinds";
export { OVERLAY_FITS } from "./offered-kinds";

/** Which overlay page is used for each base page. */
export type OverlayPaging = "repeat" | "cycle";

/** Where the overlay goes relative to the base page's own content. */
export type OverlayLayer = "front" | "back" | "multiply";

export interface OverlayLayerOption {
  id: OverlayLayer;
  label: string;
  hint: string;
  /** Opening phrase for the result summary: "<done> all N pages". */
  done: string;
}

/** The layering modes offered in the UI; `front` is the default. */
export const OVERLAY_LAYERS: readonly OverlayLayerOption[] = [
  {
    id: "front",
    label: "On top",
    hint: "Draw the overlay over the page, for stamps and marks. An opaque overlay hides what is under it.",
    done: "Placed on top of",
  },
  {
    id: "back",
    label: "Behind content",
    hint: "Draw the overlay under the page's own content, for letterheads and backgrounds. If your base PDF paints its own opaque background (a scan, for example), that background hides the overlay: use Multiply instead.",
    done: "Placed behind the content of",
  },
  {
    id: "multiply",
    label: "Multiply",
    hint: "Draw on top, but let the overlay's white areas drop out so the page shows through. Works for letterheads over scanned pages.",
    done: "Blended (multiply) onto",
  },
] as const;

/** A download name for an overlaid document, derived from the base file. */
export function overlayOutputName(sourceName: string): string {
  return outputName(sourceName || "document", "overlay");
}

/** Clamp an opacity into pdf-lib's meaningful [0, 1] range; NaN → fully opaque. */
export function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

export interface OverlayRectInput {
  /** Overlay width as a viewer shows it, in points. */
  overlayWidth: number;
  /** Overlay height as a viewer shows it, in points. */
  overlayHeight: number;
  /** Base page width as a viewer shows it, in points. */
  pageWidth: number;
  /** Base page height as a viewer shows it, in points. */
  pageHeight: number;
  fit: OverlayFit;
}

export interface OverlayRect {
  /** Bottom-left x in the base page's VIEWER frame (origin at its bottom-left). */
  x: number;
  /** Bottom-left y in the base page's viewer frame. */
  y: number;
  width: number;
  height: number;
}

/**
 * Compute where and how large to draw an overlay page on a base page.
 *  - `fit`     : scale down/up to fit inside the page, preserving aspect ratio,
 *                centered — the safe default (no cropping, no distortion).
 *  - `stretch` : scale each axis independently to exactly cover the page.
 *  - `actual`  : keep the overlay's own size, centered (may overhang the page).
 */
export function fitOverlayRect(input: OverlayRectInput): OverlayRect {
  const {
    overlayWidth: ow,
    overlayHeight: oh,
    pageWidth: pw,
    pageHeight: ph,
    fit,
  } = input;
  // Degenerate sizes can't be scaled sensibly — fall back to covering the page.
  if (ow <= 0 || oh <= 0 || pw <= 0 || ph <= 0) {
    return { x: 0, y: 0, width: Math.max(0, pw), height: Math.max(0, ph) };
  }
  if (fit === "stretch") {
    return { x: 0, y: 0, width: pw, height: ph };
  }
  if (fit === "actual") {
    return { x: (pw - ow) / 2, y: (ph - oh) / 2, width: ow, height: oh };
  }
  const scale = Math.min(pw / ow, ph / oh);
  const width = ow * scale;
  const height = oh * scale;
  return { x: (pw - width) / 2, y: (ph - height) / 2, width, height };
}

/** A rectangle in PDF user space: bottom-left corner plus size. */
export interface PdfBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A `/Rotate` value as a viewer applies it: a multiple of 90 normalized into
 * [0, 360); anything else is ignored (treated as 0), which is what pdf.js does.
 */
export function viewerRotation(angle: number): 0 | 90 | 180 | 270 {
  if (!Number.isFinite(angle) || angle % 90 !== 0) return 0;
  return (((angle % 360) + 360) % 360) as 0 | 90 | 180 | 270;
}

export interface PlaceOverlayInput {
  /** The base page's visible box (CropBox ∩ MediaBox), in content space. */
  pageBox: PdfBox;
  /** The base page's `/Rotate`, degrees clockwise. */
  pageRotation: number;
  /** Width of the embedded overlay form (its visible box, unrotated). */
  formWidth: number;
  /** Height of the embedded overlay form (its visible box, unrotated). */
  formHeight: number;
  /** The overlay page's own `/Rotate`, degrees clockwise. */
  overlayRotation: number;
  fit: OverlayFit;
}

/** The arguments for pdf-lib's `drawPage`, in the base page's content space. */
export interface OverlayPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Counter-clockwise degrees about (x, y). */
  rotate: number;
}

/**
 * Place an embedded overlay page so it looks, in the base page's viewer frame,
 * exactly as the overlay page looks in its own.
 *
 * 1. Fit the overlay's VISUAL size (swapped for a 90/270 overlay) into the
 *    page's VISUAL size (swapped for a 90/270 page) — a rect in the viewer
 *    frame.
 * 2. The unrotated form must be turned clockwise by the overlay's own
 *    rotation to look right; find the corner of that rect its local origin
 *    lands on.
 * 3. Map that corner into content space (the convention `placeStamp` uses)
 *    and turn the form by `pageRotation − overlayRotation` counter-clockwise:
 *    the page rotation cancels the viewer's turn, the overlay rotation
 *    re-applies the overlay's.
 */
export function placeOverlay(input: PlaceOverlayInput): OverlayPlacement {
  const r = viewerRotation(input.pageRotation);
  const o = viewerRotation(input.overlayRotation);
  const { x: cx, y: cy, width: cw, height: ch } = input.pageBox;
  const pageSwap = r === 90 || r === 270;
  const overlaySwap = o === 90 || o === 270;
  const v = fitOverlayRect({
    overlayWidth: overlaySwap ? input.formHeight : input.formWidth,
    overlayHeight: overlaySwap ? input.formWidth : input.formHeight,
    pageWidth: pageSwap ? ch : cw,
    pageHeight: pageSwap ? cw : ch,
    fit: input.fit,
  });
  // The corner of the viewer rect the form's own origin ends up on.
  const ux = v.x + (o === 180 || o === 270 ? v.width : 0);
  const uy = v.y + (o === 90 || o === 180 ? v.height : 0);
  const width = overlaySwap ? v.height : v.width;
  const height = overlaySwap ? v.width : v.height;
  const rotate = (((r - o) % 360) + 360) % 360;
  switch (r) {
    case 90:
      return { x: cx + cw - uy, y: cy + ux, width, height, rotate };
    case 180:
      return { x: cx + cw - ux, y: cy + ch - uy, width, height, rotate };
    case 270:
      return { x: cx + uy, y: cy + ch - ux, width, height, rotate };
    default:
      return { x: cx + ux, y: cy + uy, width, height, rotate };
  }
}

/**
 * The 0-based overlay page to use for a given base page.
 *  - `repeat`: always the first overlay page.
 *  - `cycle` : walk the overlay pages in order, wrapping around.
 * Returns -1 when there are no overlay pages.
 */
export function overlayPageIndexFor(
  baseIndex: number,
  overlayCount: number,
  paging: OverlayPaging,
): number {
  if (overlayCount <= 0) return -1;
  if (paging === "repeat") return 0;
  const i = baseIndex % overlayCount;
  return i < 0 ? i + overlayCount : i;
}

/**
 * The distinct overlay page indices we must embed to overlay `baseCount` pages.
 *  - `repeat`: just page 0.
 *  - `cycle` : the first `min(overlayCount, baseCount)` pages — every index the
 *    cyclic mapping can actually reach, and no more.
 */
export function neededOverlayIndices(
  baseCount: number,
  overlayCount: number,
  paging: OverlayPaging,
): number[] {
  if (overlayCount <= 0 || baseCount <= 0) return [];
  if (paging === "repeat") return [0];
  const count = Math.min(overlayCount, baseCount);
  return Array.from({ length: count }, (_, k) => k);
}

export interface OverlayOptions {
  /** Overlay opacity in [0, 1]; defaults to fully opaque. */
  opacity?: number;
  /** How the overlay is sized onto each page; defaults to `fit`. */
  fit?: OverlayFit;
  /** Which overlay page maps to each base page; defaults to `repeat`. */
  paging?: OverlayPaging;
  /** On top, behind the page's content, or multiplied on top; defaults to `front`. */
  layer?: OverlayLayer;
}

export interface OverlayResult {
  bytes: Uint8Array;
  /** Base page count (equal to the output page count). */
  pageCount: number;
  /** Number of pages in the overlay document. */
  overlayPageCount: number;
  fit: OverlayFit;
  paging: OverlayPaging;
  opacity: number;
  layer: OverlayLayer;
  /**
   * 1-based overlay pages the mapping used that show nothing (no content
   * stream and no visible annotation), so the base pages mapped to them were
   * left as they were. The runner names them; a silent skip reads as a bug.
   */
  skippedBlankOverlayPages: number[];
  /** Base pages that actually received an overlay (fewer when some were skipped). */
  overlaidPageCount: number;
}

const GENERIC_APPLY_FAILURE =
  "The overlay PDF couldn't be applied — it may use features we can't process yet.";

/**
 * Overlay `overlayBytes` onto every page of `baseBytes`. The base document's
 * page count and page sizes are preserved; only overlaid content is added.
 */
export async function overlayPdf(
  baseBytes: Uint8Array,
  overlayBytes: Uint8Array,
  options: OverlayOptions = {},
): Promise<OverlayResult> {
  const opacity = clampOpacity(options.opacity ?? 1);
  const fit = options.fit ?? "fit";
  const paging = options.paging ?? "repeat";
  const layer = options.layer ?? "front";

  const base = await loadPdf(baseBytes);
  const baseCount = base.getPageCount();
  if (baseCount === 0) {
    throw new PdfEngineError("The base PDF has no pages to overlay.");
  }

  // Validate the overlay and read its page count up front, with clear copy.
  const overlayDoc = await loadOverlay(overlayBytes);
  const overlayCount = overlayDoc.getPageCount();
  if (overlayCount === 0) {
    throw new PdfEngineError("The overlay PDF has no pages.");
  }

  const lib = await loadPdfLib();
  const indices = neededOverlayIndices(baseCount, overlayCount, paging);
  const embedded = await embedOverlayPages(
    lib,
    base,
    overlayDoc,
    indices,
    paging,
  );
  const skippedBlankOverlayPages = indices
    .filter((i) => !embedded.has(i))
    .map((i) => i + 1);
  if (embedded.size === 0) {
    throw new PdfEngineError(
      skippedBlankOverlayPages.length === 1
        ? `Overlay page ${skippedBlankOverlayPages[0]} is blank, so there is nothing to overlay.`
        : `The overlay pages used here (${skippedBlankOverlayPages.join(", ")}) are all blank, so there is nothing to overlay.`,
    );
  }

  // Draw each base page with its mapped overlay. The same embedded page is
  // reused across base pages, so a repeated stamp is stored once.
  try {
    const pages = base.getPages();
    let overlaidPageCount = 0;
    for (let i = 0; i < baseCount; i += 1) {
      const page = pages[i];
      if (!page) continue;
      const entry = embedded.get(overlayPageIndexFor(i, overlayCount, paging));
      // A blank overlay page draws nothing on the base pages mapped to it.
      if (!entry) continue;
      const place = placeOverlay({
        pageBox: visibleBox(page),
        pageRotation: page.getRotation().angle,
        formWidth: entry.page.width,
        formHeight: entry.page.height,
        overlayRotation: entry.rotation,
        fit,
      });
      page.drawPage(entry.page, {
        x: place.x,
        y: place.y,
        width: place.width,
        height: place.height,
        rotate: lib.degrees(place.rotate),
        opacity,
        ...(layer === "multiply" ? { blendMode: lib.BlendMode.Multiply } : {}),
      });
      if (layer === "back") sendNewestStreamToBack(lib, page);
      overlaidPageCount += 1;
    }

    stampProducer(base);
    const bytes = await base.save();
    return {
      bytes,
      pageCount: baseCount,
      overlayPageCount: overlayCount,
      fit,
      paging,
      opacity,
      layer,
      skippedBlankOverlayPages,
      overlaidPageCount,
    };
  } catch (err) {
    if (err instanceof PdfEngineError) throw err;
    throw new PdfEngineError(GENERIC_APPLY_FAILURE);
  }
}

interface EmbeddedOverlay {
  page: PDFEmbeddedPage;
  /** The overlay page's own `/Rotate`, as a viewer applies it. */
  rotation: number;
}

/**
 * Embed the overlay pages the mapping needs, each clipped to its visible box
 * and carrying its visible annotations. Blank pages are left out of the map.
 *
 * Embedding is forced page by page, here, rather than left to `save()`: pdf-lib
 * embeds lazily, so a page it cannot read used to fail at write time inside one
 * catch-all, and the user was told the overlay was unusable without being told
 * which page — or that another paging mode would work.
 */
async function embedOverlayPages(
  lib: PdfLibModule,
  base: PDFDocument,
  overlayDoc: PDFDocument,
  indices: number[],
  paging: OverlayPaging,
): Promise<Map<number, EmbeddedOverlay>> {
  const drawable = indices.filter((i) => {
    const page = overlayDoc.getPage(i);
    bakeAnnotationAppearances(lib, page);
    return page.node.Contents() !== undefined;
  });

  let pages: PDFEmbeddedPage[];
  try {
    // One call, so resources shared between overlay pages are copied once.
    pages = await base.embedPages(
      drawable.map((i) => overlayDoc.getPage(i)),
      drawable.map((i) => {
        const box = visibleBox(overlayDoc.getPage(i));
        return {
          left: box.x,
          bottom: box.y,
          right: box.x + box.width,
          top: box.y + box.height,
        };
      }),
    );
  } catch {
    throw new PdfEngineError(GENERIC_APPLY_FAILURE);
  }

  const out = new Map<number, EmbeddedOverlay>();
  for (let k = 0; k < drawable.length; k += 1) {
    const index = drawable[k]!;
    const page = pages[k]!;
    try {
      await page.embed();
    } catch {
      throw new PdfEngineError(
        `Overlay page ${index + 1} couldn't be applied — it may use features we can't process yet.` +
          (paging === "cycle" && index > 0
            ? " Try “First page on all” to use only the overlay's first page."
            : ""),
      );
    }
    out.set(index, {
      page,
      rotation: viewerRotation(overlayDoc.getPage(index).getRotation().angle),
    });
  }
  return out;
}

/**
 * The box a viewer shows: CropBox ∩ MediaBox (PDF 32000 §14.11.2), falling
 * back to the MediaBox when they do not overlap — the rule pdf.js applies.
 * Rectangles are normalized first, since either corner may come first.
 */
function visibleBox(page: PDFPage): PdfBox {
  const media = normalizeBox(page.getMediaBox());
  const crop = normalizeBox(page.getCropBox());
  const x0 = Math.max(media.x, crop.x);
  const y0 = Math.max(media.y, crop.y);
  const x1 = Math.min(media.x + media.width, crop.x + crop.width);
  const y1 = Math.min(media.y + media.height, crop.y + crop.height);
  if (x1 <= x0 || y1 <= y0) return media;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function normalizeBox(box: PdfBox): PdfBox {
  return {
    x: Math.min(box.x, box.x + box.width),
    y: Math.min(box.y, box.y + box.height),
    width: Math.abs(box.width),
    height: Math.abs(box.height),
  };
}

/**
 * Move the content stream `drawPage` just appended to the FRONT of the page's
 * `/Contents`, so it paints before (under) the page's own content.
 *
 * pdf-lib's first draw on a loaded page wraps the existing streams as
 * `[q, …base, Q]` and appends its own self-contained `q … Q` stream, so the
 * result is `[overlay, q, …base, Q]`: the overlay is drawn from the default
 * graphics state and the base content still starts from it too. Each base page
 * is drawn exactly once per run, so the newest stream is always ours.
 */
function sendNewestStreamToBack(lib: PdfLibModule, page: PDFPage): void {
  const contents = page.node.Contents();
  if (!(contents instanceof lib.PDFArray) || contents.size() < 2) return;
  const last = contents.size() - 1;
  const newest = contents.get(last);
  contents.remove(last);
  contents.insert(0, newest);
}

/** Annotation flags (PDF 32000 §12.5.3) that stop a viewer painting one. */
const ANNOT_HIDDEN = 1 << 1;
const ANNOT_NO_VIEW = 1 << 5;

/**
 * Paint every visible annotation's normal appearance into the page's own
 * content, the way a viewer composites it (PDF 32000 §12.5.5: the appearance
 * BBox, transformed by its Matrix, is mapped onto the annotation's Rect).
 *
 * An embedded page carries only its content stream, so without this a filled
 * form field or an Acrobat stamp annotation — the very things people keep as
 * stamp PDFs — vanished from the overlay, and a page holding nothing else had
 * no content stream at all and failed the whole job. Runs on the in-memory
 * overlay document only; the user's file is untouched.
 */
function bakeAnnotationAppearances(lib: PdfLibModule, page: PDFPage): void {
  const { PDFArray, PDFDict, PDFName, PDFNumber, PDFRef, PDFStream } = lib;
  const annots = page.node.Annots();
  if (!annots) return;
  const context = page.doc.context;
  const num = (value: unknown) =>
    value instanceof PDFNumber ? value.asNumber() : undefined;
  const numbers = (arr: unknown, size: number): number[] | undefined => {
    if (!(arr instanceof PDFArray) || arr.size() !== size) return undefined;
    const out: number[] = [];
    for (let i = 0; i < size; i += 1) {
      const n = num(arr.lookup(i));
      if (n === undefined || !Number.isFinite(n)) return undefined;
      out.push(n);
    }
    return out;
  };
  // An appearance may be a ref or a direct stream; drawing it needs a ref.
  const streamRef = (raw: unknown) => {
    if (raw instanceof PDFRef) {
      return context.lookup(raw) instanceof PDFStream ? raw : undefined;
    }
    return raw instanceof PDFStream ? context.register(raw) : undefined;
  };

  for (let i = 0; i < annots.size(); i += 1) {
    const annot = annots.lookup(i);
    if (!(annot instanceof PDFDict)) continue;
    if (annot.lookup(PDFName.of("Subtype")) === PDFName.of("Popup")) continue;
    const flags = num(annot.lookup(PDFName.of("F"))) ?? 0;
    if (flags & (ANNOT_HIDDEN | ANNOT_NO_VIEW)) continue;
    const ap = annot.lookup(PDFName.of("AP"));
    if (!(ap instanceof PDFDict)) continue;
    let raw: unknown = ap.get(PDFName.of("N"));
    const resolved = raw instanceof PDFRef ? context.lookup(raw) : raw;
    if (resolved instanceof PDFDict) {
      // A stateful appearance (check box, radio): pick the current state.
      const state = annot.lookup(PDFName.of("AS"));
      if (!(state instanceof PDFName)) continue;
      raw = resolved.get(state);
    }
    const ref = streamRef(raw);
    if (!ref) continue;
    const stream = context.lookup(ref, PDFStream);
    const rect = numbers(annot.lookup(PDFName.of("Rect")), 4);
    const bbox = numbers(stream.dict.lookup(PDFName.of("BBox")), 4);
    if (!rect || !bbox) continue;
    const [a, b, c, d, e, f] = numbers(
      stream.dict.lookup(PDFName.of("Matrix")),
      6,
    ) ?? [1, 0, 0, 1, 0, 0];
    const [bx0, by0, bx1, by1] = bbox as [number, number, number, number];
    const corners: [number, number][] = [
      [bx0, by0],
      [bx1, by0],
      [bx0, by1],
      [bx1, by1],
    ];
    const xs = corners.map(([x, y]) => a! * x + c! * y + e!);
    const ys = corners.map(([x, y]) => b! * x + d! * y + f!);
    const tx = Math.min(...xs);
    const ty = Math.min(...ys);
    const tw = Math.max(...xs) - tx;
    const th = Math.max(...ys) - ty;
    const [r0, r1, r2, r3] = rect as [number, number, number, number];
    const rx = Math.min(r0, r2);
    const ry = Math.min(r1, r3);
    const rw = Math.abs(r2 - r0);
    const rh = Math.abs(r3 - r1);
    if (tw <= 0 || th <= 0 || rw <= 0 || rh <= 0) continue;
    // `Do` needs a Form XObject; some writers leave Subtype off appearances.
    if (!stream.dict.has(PDFName.of("Subtype"))) {
      stream.dict.set(PDFName.of("Subtype"), PDFName.of("Form"));
    }
    const sx = rw / tw;
    const sy = rh / th;
    const name = page.node.newXObject("Annot", ref);
    page.pushOperators(
      lib.pushGraphicsState(),
      lib.concatTransformationMatrix(sx, 0, 0, sy, rx - tx * sx, ry - ty * sy),
      lib.drawObject(name),
      lib.popGraphicsState(),
    );
  }
}

/** Load the overlay document, mapping pdf-lib failures to overlay-specific copy. */
async function loadOverlay(bytes: Uint8Array) {
  try {
    return await loadPdf(bytes);
  } catch (err) {
    // Same verdict as the base file would get, said about the right file.
    if (err instanceof PdfEncryptedError) {
      throw new PdfEncryptedError(
        err.verdict,
        err.message.replace(/^This PDF/, "The overlay PDF"),
      );
    }
    throw new PdfEngineError(
      "The overlay file couldn't be read as a PDF — it may be corrupted or not a PDF.",
    );
  }
}
