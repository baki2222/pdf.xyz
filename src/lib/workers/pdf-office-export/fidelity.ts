/**
 * ROUND-TRIP FIDELITY: does a .pptx look like the PDF it came from?
 *
 * ── WHY THIS INSTRUMENT ─────────────────────────────────────────────────────
 *
 * PDF to PowerPoint shipped decks with no pictures for its whole life, and
 * every check was green: the package walked, the chain resolved, one slide per
 * page, each page's text present. All of them read what the AUTHOR wrote. The
 * defect was in what a READER sees, and only an instrument that looks at the
 * slides can see it. This one does: the deck is turned back into a PDF by a
 * real presentation engine (LibreOffice on the worker, the importer
 * PowerPoint to PDF uses), both PDFs are rasterised by the same renderer at
 * the same resolution, and the pages are compared.
 *
 * ── THE SCORE ───────────────────────────────────────────────────────────────
 *
 * Per page, on grey (Rec. 601 luma), after a Gaussian blur (σ =
 * {@link FIDELITY_BLUR_PT} points) that forgives anti-aliasing and the
 * difference between a font and its metric-compatible clone, but not a
 * picture that moved, vanished or changed:
 *
 *   score = mean |source − candidate| / mean |source − white|
 *
 * 0 is identical. 1 is exactly as far from the page as a BLANK page is, by
 * construction — so a blank deck scores 1.0 on every page with ink, which is
 * one of the two controls the bound must fail. A candidate page of another
 * shape is compared through the mapping the export documents: the page fitted
 * inside the slide, centred, aspect kept.
 *
 * ── THE BOUND, AND ITS CONTROLS ─────────────────────────────────────────────
 *
 * {@link FIDELITY_BOUND} is calibrated, not chosen: it must PASS the faithful
 * export on every committed fixture, and FAIL both controls — a blank deck and
 * the text-only deck this tool shipped until 2026-10-10
 * (`src/tests/pptx-text-only-2026-10-10.ts`). A bound that passes either
 * control cannot see the defect it was built for. The calibration runs are
 * recorded beside the constant.
 *
 * ── WHAT IT IS NOT ──────────────────────────────────────────────────────────
 *
 * It does not say the deck opens in PowerPoint (the renderer is LibreOffice;
 * PowerPoint is `scripts/prove-pptx-opens.ts`), that text is editable, or that
 * fonts match. It says the slides LOOK like the pages, within a stated
 * tolerance, through one real importer.
 *
 * ── NOT THE SAME EYES AS THE ENGINE (since 2026-10-11) ──────────────────────
 *
 * Until 2026-10-11 the source was rasterised through the engine's own reader
 * (`openNodePdf`, with its 64-megapixel ceiling), so a picture the engine's
 * pdf.js dropped was dropped from the SOURCE too: the review's 124 MP scan
 * scored 0.000 for the blank deck and for the defective one alike, both
 * PASS. Now this module opens every PDF with its own options (a pixel
 * ceiling of its own, {@link COMPARISON_MAX_IMAGE_PIXELS}, twice the
 * engine's and above every fixture picture), and asks the file itself — `./page-inventory`, pdf-lib, not
 * pdf.js — what each source page paints. A page that paints a picture or
 * visible text, yet scores a blank slide within the bound, is a comparison
 * that CANNOT CONCLUDE, and the verdict fails it.
 *
 * ── PICTURES ARE SCORED ON THEIR OWN (since 2026-10-11) ─────────────────────
 *
 * The page score averages over the page, so a defect confined to one picture
 * is diluted by everything around it, and the page bound was set just above
 * the font noise of text pages. Measured by the review: a picture stretched
 * 10% or cropped 15% on one slide passed the whole deck. So every picture the
 * source paints (its box from the inventory) is also scored on its own
 * region, normalised by the region's own DETAIL — its mean grey change from
 * one point to the next — so the score reads roughly as how many points the
 * picture's content is out of place, against {@link FIDELITY_BOUND}'s
 * `picture`. (Normalised by contrast instead, a screenshot with large flat
 * areas scored a 10% stretch BELOW a competitor's faithful deck; by detail
 * the two are 4× apart. The calibration is beside the constant.)
 */
import { inventoryPages, type PageInventory } from "./page-inventory";
import {
  canvasFactoryOf,
  loadNodePdfjs,
  MAX_DECODED_IMAGE_PIXELS,
  nodePdfjsAssetDirs,
  type NodeCanvasAndContext,
  type NodePdfDocument,
} from "./pdfjs-node";
import { awaitPdfjsDocument } from "@/lib/pdf/pdfjs";
import { PDFJS_DOCUMENT_DEFAULTS } from "@/lib/pdf/wasm-assets";

/** Raster resolution of the comparison. 72 dpi: one pixel per point. */
export const FIDELITY_DPI = 72;
/** Blur radius (σ) in points: forgives anti-aliasing and font clones. */
export const FIDELITY_BLUR_PT = 2;

/**
 * The bound a faithful deck must meet: every page at most `page`, the
 * document's mean at most `mean`, every picture at most `picture`.
 *
 * CALIBRATED 2026-10-10 (page, mean), with the deck turned back into a PDF by
 * PowerPoint 16.0 build 20430 (COM, read-only, `SaveAs` PDF) and both PDFs
 * rasterised by this module — `pnpm measure:pptx-fidelity --renderer
 * powerpoint`:
 *
 *   owner's 33-page sample   page max   mean
 *     this export             0.204     0.034
 *     a competitor's export   0.366     0.070
 *     text-only (≤ 2026-10-10) 1.399    1.039   (lowest page 0.983)
 *     blank deck              1.000     1.000
 *   committed fixtures       0.007 – 0.018 a page
 *
 * So the GROSS controls sit at ≥ 0.98 and the faithful export at ≤ 0.21.
 *
 * `picture` CALIBRATED 2026-10-11, the same route, because the review found
 * the page and mean bounds licensed a wrong picture: a 10% stretch or a 15%
 * crop of ONE picture on one slide passed the whole deck (page 0.093 and
 * 0.128 on the sample), since a page score averages a defect over its page.
 * Each picture's region, scored alone ("points out of place", see
 * `PictureScore`), max over all pictures:
 *
 *   faithful decks: owner's sample 0.522; committed fixtures 0.000 – 0.335
 *     (the 65.6 MP drawing 0.199, the turned photo 0.190)
 *   a competitor's deck of the sample: 0.770
 *   PARTIAL CONTROLS, one picture on one slide moved 18 pt / stretched 10% /
 *     cropped 15%: sample slides 4, 7, 32 through PowerPoint 3.43 / 3.05 /
 *     3.73 at the least; mixedSizesPdf slides 1, 2, 4 through PowerPoint
 *     4.69 / 2.38 / 3.58 at the least; and drawn as PDFs, with no
 *     presentation engine (`fidelity.test.ts`), 4.69 / 2.38 / 3.56
 *   gross controls: blank 8.76 and up, text-only 65.8 on the sample
 *
 * 1.5 is about three times the worst faithful deck and 1.6 times under the
 * weakest partial control. NONE of these is calibrated on LibreOffice — no
 * LibreOffice was available where they were set — and LibreOffice is what
 * the worker and `pnpm worker:pptx-fidelity-proof` use, with the Carlito and
 * Liberation clones in place of Calibri and Arial. That proof prints every
 * page's and picture's score, and runs the partial controls; its first run
 * in the worker image is the LibreOffice calibration, and a failure there is
 * to be read from those numbers before the bound is moved, never by moving
 * it until green.
 */
export const FIDELITY_BOUND = {
  page: 0.25,
  mean: 0.15,
  picture: 1.5,
} as const;

/** The bound's shape: every page, the mean, every picture. */
export interface FidelityBound {
  page: number;
  mean: number;
  /** Every source picture's region; absent, pictures are not scored. */
  picture?: number;
}

/** Pictures smaller than this on either side (points) are not scored alone. */
export const MIN_PICTURE_PT = 24;
/**
 * A region's detail — its mean grey change per point — is never taken below
 * this: a flat picture has none, and any difference over it would be
 * infinite.
 */
export const DETAIL_FLOOR = 1;

export interface GrayPage {
  /** Pixels, row-major, top row first; 0 black … 255 white. */
  gray: Float32Array;
  width: number;
  height: number;
  /** The page's displayed size in points. */
  widthPt: number;
  heightPt: number;
}

/** How a candidate page is laid over its source page. */
export interface Fit {
  /** Candidate points per source point. */
  scale: number;
  /** Where the source page's top-left lands on the candidate, in points. */
  offsetX: number;
  offsetY: number;
}

/** The export's documented mapping: fitted inside, centred, aspect kept. */
export function fitCentred(
  source: { width: number; height: number },
  candidate: { width: number; height: number },
): Fit {
  const scale = Math.min(
    candidate.width / source.width,
    candidate.height / source.height,
  );
  return {
    scale,
    offsetX: (candidate.width - source.width * scale) / 2,
    offsetY: (candidate.height - source.height * scale) / 2,
  };
}

function toGray(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Float32Array {
  const out = new Float32Array(width * height);
  for (let p = 0, q = 0; p < out.length; p++, q += 4) {
    const a = data[q + 3]! / 255;
    const luma = 0.299 * data[q]! + 0.587 * data[q + 1]! + 0.114 * data[q + 2]!;
    out[p] = luma * a + 255 * (1 - a);
  }
  return out;
}

/**
 * pdf.js's per-image ceiling when the instrument opens a PDF to COMPARE it:
 * twice the scan's floor, so no fixture picture is dropped on the source
 * side because the engine's reader would drop it (one fixture is over the
 * floor on purpose) — and finite. Until 2026-10-11 this was -1, no ceiling
 * at all; `image-ceiling.test.ts` holds it above every fixture picture.
 */
export const COMPARISON_MAX_IMAGE_PIXELS = 2 * MAX_DECODED_IMAGE_PIXELS;

/**
 * Open a PDF for COMPARISON, with this module's own options: a ceiling
 * above the engine's ({@link COMPARISON_MAX_IMAGE_PIXELS}), so no picture is
 * dropped on the source side because the engine's reader would drop it.
 * Exported for `./docx-fidelity`, which looks at the source with the same
 * eyes.
 */
export async function openForComparison(
  pdf: Uint8Array,
): Promise<{ doc: NodePdfDocument; close(): Promise<void> }> {
  const pdfjs = await loadNodePdfjs();
  const task = pdfjs.getDocument({
    data: pdf.slice(),
    ...PDFJS_DOCUMENT_DEFAULTS,
    ...nodePdfjsAssetDirs(),
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    isOffscreenCanvasSupported: false,
    enableXfa: false,
    maxImageSize: COMPARISON_MAX_IMAGE_PIXELS,
  });
  const doc = await awaitPdfjsDocument(task);
  return { doc, close: () => task.destroy().catch(() => {}) };
}

/**
 * Rasterise every page of `pdf` to grey. With `onto`, page i is drawn INTO
 * the frame of `onto[i]` (its pixel size), through {@link fitCentred}: the
 * part of the candidate page where the source page sits, at the source's
 * resolution. Pages beyond `onto` are not drawn.
 */
export async function rasterizeGray(
  pdf: Uint8Array,
  onto?: readonly GrayPage[],
  dpi = FIDELITY_DPI,
): Promise<GrayPage[]> {
  const { doc, close } = await openForComparison(pdf);
  try {
    const factory = canvasFactoryOf(doc);
    const out: GrayPage[] = [];
    const count = onto ? Math.min(onto.length, doc.numPages) : doc.numPages;
    for (let n = 1; n <= count; n++) {
      const page = await doc.getPage(n);
      const unit = page.getViewport({ scale: 1 });
      const target = onto?.[n - 1];
      let width: number;
      let height: number;
      let scale: number;
      let transform: number[] | undefined;
      if (target) {
        const fit = fitCentred(
          { width: target.widthPt, height: target.heightPt },
          { width: unit.width, height: unit.height },
        );
        width = target.width;
        height = target.height;
        scale = dpi / 72 / fit.scale;
        transform = [1, 0, 0, 1, -fit.offsetX * scale, -fit.offsetY * scale];
      } else {
        scale = dpi / 72;
        width = Math.max(1, Math.round(unit.width * scale));
        height = Math.max(1, Math.round(unit.height * scale));
      }
      const viewport = page.getViewport({ scale });
      const cc: NodeCanvasAndContext = factory.create(width, height);
      await page.render({
        canvas: cc.canvas as unknown as HTMLCanvasElement,
        canvasContext: cc.context as unknown as CanvasRenderingContext2D,
        viewport,
        background: "rgb(255,255,255)",
        ...(transform ? { transform } : {}),
      }).promise;
      out.push({
        gray: toGray(
          cc.context.getImageData(0, 0, width, height).data,
          width,
          height,
        ),
        width,
        height,
        widthPt: unit.width,
        heightPt: unit.height,
      });
      factory.destroy(cc);
      page.cleanup();
    }
    return out;
  } finally {
    await close();
  }
}

/** Separable Gaussian blur, edges clamped. */
export function blur(
  src: Float32Array,
  width: number,
  height: number,
  sigma: number,
): Float32Array {
  if (sigma <= 0) return src.slice();
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(2 * radius + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    kernel[i + radius] = Math.exp(-(i * i) / (2 * sigma * sigma));
    sum += kernel[i + radius]!;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i]! /= sum;
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = Math.min(width - 1, Math.max(0, x + k));
        acc += src[row + xx]! * kernel[k + radius]!;
      }
      tmp[row + x] = acc;
    }
  }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = Math.min(height - 1, Math.max(0, y + k));
        acc += tmp[yy * width + x]! * kernel[k + radius]!;
      }
      out[y * width + x] = acc;
    }
  return out;
}

/** One source picture's region, scored on its own. */
export interface PictureScore {
  page: number;
  /** The region, source page points, top-left origin: x0, y0, x1, y1. */
  box: [number, number, number, number];
  /**
   * Mean |source − candidate| over the region, divided by the region's
   * DETAIL (its mean grey change from one point to the next). A picture
   * shifted by d points, while d is small, differs by about d × its detail,
   * so the score reads roughly as "points out of place".
   */
  score: number;
  /** The region's detail: mean |∂source| per point, grey levels. */
  detail: number;
}

export interface PageScore {
  page: number;
  /** Normalised difference: 0 identical, 1 as far as a blank page. */
  score: number;
  /** Mean grey difference from a blank page, before normalising. */
  ink: number;
  /**
   * Whether the source page paints a picture or visible text, by the file
   * itself (`./page-inventory`), independent of the rasteriser. Absent when
   * the file could not be read that way.
   */
  paints?: boolean;
  /** Each picture the source page paints, scored alone. */
  pictures?: PictureScore[];
}

/**
 * Score one candidate page against its source page (same pixel frame), and
 * each of `inventory`'s pictures on its own region.
 */
export function scorePage(
  source: GrayPage,
  candidate: GrayPage | undefined,
  page: number,
  dpi = FIDELITY_DPI,
  inventory?: PageInventory,
): PageScore {
  const sigma = (FIDELITY_BLUR_PT * dpi) / 72;
  const a = blur(source.gray, source.width, source.height, sigma);
  const b = candidate
    ? blur(candidate.gray, candidate.width, candidate.height, sigma)
    : null;
  let diff = 0;
  let ink = 0;
  for (let i = 0; i < a.length; i++) {
    diff += Math.abs(a[i]! - (b ? b[i]! : 255));
    ink += 255 - a[i]!;
  }
  diff /= a.length;
  ink /= a.length;
  const scored: PageScore = { page, score: diff / Math.max(ink, 1), ink };
  if (!inventory) return scored;
  const px = dpi / 72;
  const pictures: PictureScore[] = [];
  for (const placement of inventory.placements) {
    // A stencil is drawn into the deck's drawing pictures, not placed alone:
    // it is the page score's, as it was before stencils were placements.
    if (inventory.images[placement.image]?.mask) continue;
    const box: [number, number, number, number] = [
      Math.max(0, placement.box[0]),
      Math.max(0, placement.box[1]),
      Math.min(inventory.width, placement.box[2]),
      Math.min(inventory.height, placement.box[3]),
    ];
    if (box[2] - box[0] < MIN_PICTURE_PT || box[3] - box[1] < MIN_PICTURE_PT)
      continue;
    const x0 = Math.round(box[0] * px);
    const y0 = Math.round(box[1] * px);
    const x1 = Math.min(source.width, Math.round(box[2] * px));
    const y1 = Math.min(source.height, Math.round(box[3] * px));
    const w = source.width;
    let n = 0;
    let d = 0;
    let detail = 0;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = y * w + x;
        d += Math.abs(a[i]! - (b ? b[i]! : 255));
        // Per point: one pixel is 72 / dpi points.
        const dx = x + 1 < x1 ? Math.abs(a[i + 1]! - a[i]!) : 0;
        const dy = y + 1 < y1 ? Math.abs(a[i + w]! - a[i]!) : 0;
        detail += ((dx + dy) / 2) * px;
        n++;
      }
    if (n === 0) continue;
    detail /= n;
    pictures.push({
      page,
      box,
      score: d / n / Math.max(detail, DETAIL_FLOOR),
      detail,
    });
  }
  const paints = inventory.images.length > 0 || inventory.visibleTextOps > 0;
  return { ...scored, paints, pictures };
}

export interface FidelityReport {
  pages: PageScore[];
  mean: number;
  max: number;
  /** Every scored picture, all pages. */
  pictures: PictureScore[];
  /** Source and candidate page counts; a missing page scores as blank. */
  sourcePages: number;
  candidatePages: number;
  /**
   * Pages where a BLANK slide would pass, though the source paints a picture
   * or visible text there: the comparison cannot see that page, and fails.
   */
  inconclusive: number[];
  pass: boolean;
  detail: string;
}

/** Compare `candidate` (a PDF) against `source`, page by page. */
export async function compareFidelity(
  source: Uint8Array,
  candidate: Uint8Array,
  bound: FidelityBound = FIDELITY_BOUND,
): Promise<FidelityReport> {
  const src = await rasterizeGray(source);
  const cand = await rasterizeGray(candidate, src);
  const candidatePages = await pageCount(candidate);
  const inventory = await inventoryPages(source);
  const pages = src.map((s, i) =>
    scorePage(s, cand[i], i + 1, FIDELITY_DPI, inventory?.[i]),
  );
  return verdict(pages, src.length, candidatePages, bound);
}

async function pageCount(pdf: Uint8Array): Promise<number> {
  const { doc, close } = await openForComparison(pdf);
  try {
    return doc.numPages;
  } finally {
    await close();
  }
}

export function verdict(
  pages: PageScore[],
  sourcePages: number,
  candidatePages: number,
  bound: FidelityBound = FIDELITY_BOUND,
): FidelityReport {
  const scores = pages.map((p) => p.score);
  const mean = scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length);
  const max = Math.max(0, ...scores);
  const worst = pages.filter((p) => p.score > bound.page).map((p) => p.page);
  const countOk = candidatePages === sourcePages;
  // A blank candidate page scores ink / max(ink, 1) by construction. Where
  // that is within the page bound and the source paints something visible,
  // the instrument cannot tell the export from an empty slide.
  const inconclusive = pages
    .filter((p) => p.paints && p.ink / Math.max(p.ink, 1) <= bound.page)
    .map((p) => p.page);
  const pictures = pages.flatMap((p) => p.pictures ?? []);
  const badPictures =
    bound.picture === undefined
      ? []
      : pictures.filter((p) => p.score > bound.picture!);
  const pass =
    countOk &&
    worst.length === 0 &&
    mean <= bound.mean &&
    inconclusive.length === 0 &&
    badPictures.length === 0;
  const pictureMax = Math.max(0, ...pictures.map((p) => p.score));
  const detail = [
    `${sourcePages} page(s), mean ${mean.toFixed(3)} (bound ${bound.mean}), max ${max.toFixed(3)} (bound ${bound.page})`,
    pictures.length > 0
      ? `${pictures.length} picture(s), max ${pictureMax.toFixed(3)}${bound.picture === undefined ? "" : ` (bound ${bound.picture})`}`
      : "",
    countOk ? "" : `candidate has ${candidatePages} page(s)`,
    worst.length ? `over the page bound: ${worst.join(", ")}` : "",
    badPictures.length
      ? `pictures over the bound: ${badPictures.map((p) => `p${p.page} ${p.score.toFixed(3)}`).join(", ")}`
      : "",
    inconclusive.length
      ? `CANNOT CONCLUDE on page(s) ${inconclusive.join(", ")}: the source paints a picture or text there, yet a blank slide would pass`
      : "",
  ]
    .filter(Boolean)
    .join("; ");
  return {
    pages,
    mean,
    max,
    pictures,
    sourcePages,
    candidatePages,
    inconclusive,
    pass,
    detail,
  };
}

/** A presentation engine that turns a .pptx into a PDF. */
export type PptxToPdf = (pptx: Uint8Array) => Promise<Uint8Array>;

/** Round trip: render the deck back to PDF and compare it with its source. */
export async function roundTripFidelity(
  source: Uint8Array,
  pptx: Uint8Array,
  toPdf: PptxToPdf,
  bound: FidelityBound = FIDELITY_BOUND,
): Promise<FidelityReport> {
  return compareFidelity(source, await toPdf(pptx), bound);
}
