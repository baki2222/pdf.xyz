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
 */
import {
  canvasFactoryOf,
  openNodePdf,
  type NodeCanvasAndContext,
} from "./pdfjs-node";

/** Raster resolution of the comparison. 72 dpi: one pixel per point. */
export const FIDELITY_DPI = 72;
/** Blur radius (σ) in points: forgives anti-aliasing and font clones. */
export const FIDELITY_BLUR_PT = 2;

/**
 * The bound a faithful deck must meet: every page at most `page`, the
 * document's mean at most `mean`.
 *
 * CALIBRATED 2026-10-10, with the deck turned back into a PDF by PowerPoint
 * 16.0 build 20430 (COM, read-only, `SaveAs` PDF) and both PDFs rasterised by
 * this module — `pnpm measure:pptx-fidelity --renderer powerpoint`:
 *
 *   owner's 33-page sample   page max   mean
 *     this export             0.204     0.034
 *     a competitor's export   0.366     0.070
 *     text-only (≤ 2026-10-10) 1.399    1.039   (lowest page 0.983)
 *     blank deck              1.000     1.000
 *   committed fixtures       0.007 – 0.018 a page
 *
 * So the controls sit at ≥ 0.98 and the faithful export at ≤ 0.21: the bound
 * splits them with room on both sides. It is NOT yet calibrated on
 * LibreOffice — no LibreOffice was available where it was set — and
 * LibreOffice is what the worker and `pnpm worker:pptx-fidelity-proof` use,
 * with the Carlito and Liberation clones in place of Calibri and Arial. That
 * proof prints every page's score; its first run in the worker image is the
 * LibreOffice calibration, and a failure there is to be read from those
 * numbers before the bound is moved, never by moving it until green.
 */
export const FIDELITY_BOUND = { page: 0.25, mean: 0.15 } as const;

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
  const { doc, close } = await openNodePdf(pdf);
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

export interface PageScore {
  page: number;
  /** Normalised difference: 0 identical, 1 as far as a blank page. */
  score: number;
  /** Mean grey difference from a blank page, before normalising. */
  ink: number;
}

/** Score one candidate page against its source page (same pixel frame). */
export function scorePage(
  source: GrayPage,
  candidate: GrayPage | undefined,
  page: number,
  dpi = FIDELITY_DPI,
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
  return { page, score: diff / Math.max(ink, 1), ink };
}

export interface FidelityReport {
  pages: PageScore[];
  mean: number;
  max: number;
  /** Source and candidate page counts; a missing page scores as blank. */
  sourcePages: number;
  candidatePages: number;
  pass: boolean;
  detail: string;
}

/** Compare `candidate` (a PDF) against `source`, page by page. */
export async function compareFidelity(
  source: Uint8Array,
  candidate: Uint8Array,
  bound: { page: number; mean: number } = FIDELITY_BOUND,
): Promise<FidelityReport> {
  const src = await rasterizeGray(source);
  const cand = await rasterizeGray(candidate, src);
  const candidatePages = await pageCount(candidate);
  const pages = src.map((s, i) => scorePage(s, cand[i], i + 1));
  return verdict(pages, src.length, candidatePages, bound);
}

async function pageCount(pdf: Uint8Array): Promise<number> {
  const { doc, close } = await openNodePdf(pdf);
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
  bound: { page: number; mean: number } = FIDELITY_BOUND,
): FidelityReport {
  const scores = pages.map((p) => p.score);
  const mean = scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length);
  const max = Math.max(0, ...scores);
  const worst = pages.filter((p) => p.score > bound.page).map((p) => p.page);
  const countOk = candidatePages === sourcePages;
  const pass = countOk && worst.length === 0 && mean <= bound.mean;
  const detail = [
    `${sourcePages} page(s), mean ${mean.toFixed(3)} (bound ${bound.mean}), max ${max.toFixed(3)} (bound ${bound.page})`,
    countOk ? "" : `candidate has ${candidatePages} page(s)`,
    worst.length ? `over the page bound: ${worst.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("; ");
  return { pages, mean, max, sourcePages, candidatePages, pass, detail };
}

/** A presentation engine that turns a .pptx into a PDF. */
export type PptxToPdf = (pptx: Uint8Array) => Promise<Uint8Array>;

/** Round trip: render the deck back to PDF and compare it with its source. */
export async function roundTripFidelity(
  source: Uint8Array,
  pptx: Uint8Array,
  toPdf: PptxToPdf,
  bound: { page: number; mean: number } = FIDELITY_BOUND,
): Promise<FidelityReport> {
  return compareFidelity(source, await toPdf(pptx), bound);
}
