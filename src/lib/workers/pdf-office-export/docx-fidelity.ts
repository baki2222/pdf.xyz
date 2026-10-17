/**
 * PICTURE FIDELITY FOR WORD: does a .docx carry every picture of the PDF it
 * came from — that picture, at its size, where the text around it puts it?
 *
 * ── WHY THIS INSTRUMENT, AND NOT THE PAGE ROUND TRIP ────────────────────────
 *
 * On 2026-10-17 the owner's 33-page tutorial (37 pictures, screenshots with
 * captions) came back from production's PDF to Word as a 12 KB .docx with no
 * `word/media` at all, while a competitor's export kept the screenshots.
 * Every check this tool had read the TEXT, and the text was all there.
 *
 * PDF to PowerPoint's instrument (`./fidelity`) compares pages, because a
 * slide is a page. A Word document is not: Word reflows it, so where a line
 * lands on a page is Word's choice, not the export's, and a page-by-page
 * pixel comparison would measure Word's line breaking. What the export DOES
 * decide is what this measures, picture by picture:
 *
 *   present   every picture the source pages paint is in the .docx, and the
 *             .docx carries no picture the source does not paint;
 *   pixels    each one's own pixels match the source picture's (both decoded
 *             here, then compared on a common grid after a small blur,
 *             normalised by the picture's own detail — see {@link PIXEL_BOUND});
 *   size      its extent is the size the page shows it at, scaled down, with
 *             its aspect kept, only as far as the page's text area needs
 *             ({@link SIZE_TOLERANCE});
 *   order     it sits between the text the source page shows just above it
 *             and the text just below it, on the right page of the document.
 *
 * ── NOT THE ENGINE'S EYES ───────────────────────────────────────────────────
 *
 * The source's pictures are listed by the FILE (`./page-inventory`, pdf-lib),
 * not by the engine's page reader. Their pixels are decoded by this module's
 * own pdf.js instance, opened with the comparison options of `./fidelity`
 * (a ceiling above the engine's), and the text around them is read by that
 * instance's `getTextContent`, not by the poppler extraction the export
 * writes paragraphs from. The .docx is read from its XML and its media
 * decoded through the canvas, never through anything the writer used.
 *
 * ── WHAT IT DOES NOT MEASURE, said plainly ──────────────────────────────────
 *
 *  - A picture the page shows through a clip is compared on the part the
 *    .docx says it shows (`a:srcRect`); whether that is the part the clip
 *    shows is not measured here (the PowerPoint round trip measures the page
 *    reader's clips).
 *  - A picture turned on the page is matched and its pixels compared
 *    unturned; its size is not checked, and the report counts it.
 *  - Stencil masks (`/ImageMask`, one colour through a 1-bit shape) are not
 *    counted as pictures: the export does not carry them (its page says so).
 *  - It says nothing about fonts, colours or the text itself.
 */
import { readDocxBody, type DocxBody, type DocxBodyPicture } from "./docx-read";
import { blur, DETAIL_FLOOR, openForComparison } from "./fidelity";
import { inventoryPages, type PageInventory } from "./page-inventory";
import {
  isDecodedImage,
  resampleImage,
  type DecodedImage,
} from "./picture-pixels";
import { loadNodeCanvas, loadNodePdfjs } from "./pdfjs-node";

/* ------------------------------------------------------------------ *
 *  The bounds
 * ------------------------------------------------------------------ */

/**
 * The most a matched picture's pixel score may be: mean |source − docx| on a
 * grid of {@link GRID_POINTS}-point cells, after a one-cell blur, divided by
 * the source picture's detail (its mean grey change from one cell to the
 * next, floored at `DETAIL_FLOOR`). It reads roughly as "cells out of
 * place". Calibrated beside its controls in `docx-fidelity.test.ts`.
 */
export const PIXEL_BOUND = 0.5;
/** Grid cell size, in points of the picture as shown. */
export const GRID_POINTS = 4;
/** Grid sides are clamped to this range of cells. */
const GRID_MIN = 8;
const GRID_MAX = 160;
/** Extent within this many points, or this share of the side, of the expected. */
export const SIZE_TOLERANCE = { points: 1, share: 0.01 } as const;

/* ------------------------------------------------------------------ *
 *  The source, as the file and this module's own pdf.js see it
 * ------------------------------------------------------------------ */

type Box = [number, number, number, number];

export interface SourcePicture {
  page: number;
  /** Order among the page's pictures, in paint order. */
  order: number;
  /** Where the page shows it (unclipped), points, top-left origin. */
  box: Box;
  /** Its decoded pixels, or null when this instrument could not decode it. */
  pixels: DecodedImage | null;
}

interface SourceText {
  text: string;
  box: Box;
}

interface SourceDocument {
  pictures: SourcePicture[];
  texts: SourceText[][];
  /** Per page: does it put anything in the .docx (text or a picture)? */
  nonEmpty: boolean[];
  pageCount: number;
}

type Matrix = number[];
const apply = (m: Matrix, x: number, y: number): [number, number] => [
  m[0]! * x + m[2]! * y + m[4]!,
  m[1]! * x + m[3]! * y + m[5]!,
];
const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0]! * n[0]! + m[2]! * n[1]!,
  m[1]! * n[0]! + m[3]! * n[1]!,
  m[0]! * n[2]! + m[2]! * n[3]!,
  m[1]! * n[2]! + m[3]! * n[3]!,
  m[0]! * n[4]! + m[2]! * n[5]! + m[4]!,
  m[1]! * n[4]! + m[3]! * n[5]! + m[5]!,
];

const normalise = (s: string) =>
  s.normalize("NFKC").replace(/­/g, "").replace(/\s+/g, " ").trim();

/** How long one decoded image may take to arrive from pdf.js's evaluator. */
const DECODE_WAIT_MS = 60_000;

/**
 * The decoded image `id` names, once pdf.js has it. The operator list can
 * finish BEFORE an image with a soft mask has been decoded (measured on the
 * owner's sample: 9 of 37 were not yet in the pool), so this waits on the
 * pool's own callback rather than reading it, with a deadline.
 */
function resolved(
  page: { objs: unknown; commonObjs: unknown },
  id: string,
): Promise<unknown> {
  const pool = (id.startsWith("g_") ? page.commonObjs : page.objs) as {
    get(id: string, callback: (data: unknown) => void): void;
  };
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), DECODE_WAIT_MS);
    pool.get(id, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

async function readSource(source: Uint8Array): Promise<SourceDocument | null> {
  const inventory = await inventoryPages(source);
  if (!inventory) return null;
  const pdfjs = await loadNodePdfjs();
  const { doc, close } = await openForComparison(source);
  try {
    const OPS = pdfjs.OPS as unknown as Record<string, number>;
    const pictures: SourcePicture[] = [];
    const texts: SourceText[][] = [];
    const nonEmpty: boolean[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const inv: PageInventory | undefined = inventory[n - 1];
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const lines: SourceText[] = [];
      for (const item of content.items as {
        str?: string;
        transform?: number[];
        width?: number;
      }[]) {
        const str = normalise(item.str ?? "");
        if (!str || !item.transform) continue;
        const m = mul(Array.from(viewport.transform), item.transform);
        const size = Math.hypot(m[2]!, m[3]!) || 1;
        const [x, y] = apply(m, 0, 0);
        const w = (item.width ?? 0) * (viewport.scale || 1);
        lines.push({ text: str, box: [x, y - size, x + w, y + size * 0.25] });
      }
      texts.push(lines);
      const shown = (inv?.placements ?? []).filter((p) => {
        const image = inv!.images[p.image];
        if (!image || image.mask) return false;
        const b = p.box;
        return (
          Math.min(b[2], inv!.width) - Math.max(b[0], 0) > 0.5 &&
          Math.min(b[3], inv!.height) - Math.max(b[1], 0) > 0.5
        );
      });
      nonEmpty.push(lines.length > 0 || shown.length > 0);
      if (shown.length === 0) {
        page.cleanup();
        continue;
      }
      // Decode through this instance: the op list resolves every image the
      // page paints into its pools, each keyed with the file's own ref.
      const ol = await page.getOperatorList();
      const byRef = new Map<string, DecodedImage>();
      const inline: DecodedImage[] = [];
      for (let i = 0; i < ol.fnArray.length; i++) {
        const fn = ol.fnArray[i];
        const args = ol.argsArray[i] as unknown[];
        if (fn === OPS.paintImageXObject) {
          const img = await resolved(page, String(args[0]));
          if (isDecodedImage(img) && typeof img.ref === "string")
            byRef.set(img.ref, img);
        } else if (
          fn === OPS.paintInlineImageXObject &&
          isDecodedImage(args[0])
        )
          inline.push(args[0]);
      }
      let nextInline = 0;
      shown.forEach((p, order) => {
        const image = inv!.images[p.image]!;
        const pixels = image.inline
          ? (inline[nextInline++] ?? null)
          : image.ref
            ? (byRef.get(image.ref) ?? null)
            : null;
        pictures.push({
          page: n,
          order,
          box: [
            Math.max(0, p.box[0]),
            Math.max(0, p.box[1]),
            Math.min(inv!.width, p.box[2]),
            Math.min(inv!.height, p.box[3]),
          ],
          // A copy: the pools are emptied when the page is cleaned up.
          pixels: pixels
            ? {
                width: pixels.width,
                height: pixels.height,
                kind: pixels.kind,
                data: pixels.data.slice(),
              }
            : null,
        });
      });
      page.cleanup();
    }
    return { pictures, texts, nonEmpty, pageCount: doc.numPages };
  } finally {
    await close();
  }
}

/* ------------------------------------------------------------------ *
 *  Pixels
 * ------------------------------------------------------------------ */

/** A .docx picture's media, decoded by the canvas, as RGBA. */
async function decodeMedia(bytes: Uint8Array): Promise<DecodedImage | null> {
  try {
    const canvas = loadNodeCanvas();
    const image = await canvas.loadImage(bytes);
    if (image.width < 1 || image.height < 1) return null;
    const c = canvas.createCanvas(image.width, image.height);
    const ctx = c.getContext("2d");
    ctx.drawImage(image, 0, 0);
    const { data } = ctx.getImageData(0, 0, image.width, image.height);
    return { width: image.width, height: image.height, kind: 3, data };
  } catch {
    return null;
  }
}

/** Whole-pixel region of `img` left after cutting `crop`'s fractions. */
function regionOf(
  img: DecodedImage,
  crop: DocxBodyPicture["crop"],
): [number, number, number, number] {
  const c = crop ?? { left: 0, top: 0, right: 0, bottom: 0 };
  const x0 = Math.max(0, Math.floor(c.left * img.width));
  const y0 = Math.max(0, Math.floor(c.top * img.height));
  const x1 = Math.min(
    img.width,
    Math.max(x0 + 1, Math.ceil((1 - c.right) * img.width)),
  );
  const y1 = Math.min(
    img.height,
    Math.max(y0 + 1, Math.ceil((1 - c.bottom) * img.height)),
  );
  return [x0, y0, x1, y1];
}

/** Grey on white, 0 black … 255 white, at `w` × `h`, blurred one cell. */
function greyGrid(
  img: DecodedImage,
  crop: DocxBodyPicture["crop"],
  w: number,
  h: number,
): Float32Array {
  const rgba = resampleImage(img, regionOf(img, crop), w, h);
  const out = new Float32Array(w * h);
  for (let p = 0, q = 0; p < out.length; p++, q += 4) {
    const a = rgba[q + 3]! / 255;
    const luma = 0.299 * rgba[q]! + 0.587 * rgba[q + 1]! + 0.114 * rgba[q + 2]!;
    out[p] = luma * a + 255 * (1 - a);
  }
  return blur(out, w, h, 1);
}

/** The grid a picture shown `width` × `height` points is compared on. */
function gridFor(width: number, height: number): [number, number] {
  const clamp = (v: number) =>
    Math.max(GRID_MIN, Math.min(GRID_MAX, Math.round(v / GRID_POINTS)));
  return [clamp(width), clamp(height)];
}

/** Mean |a − b| over the reference's detail: "cells out of place". */
function pixelScore(
  ref: Float32Array,
  cand: Float32Array,
  w: number,
  h: number,
): number {
  let d = 0;
  let detail = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      d += Math.abs(ref[i]! - cand[i]!);
      const dx = x + 1 < w ? Math.abs(ref[i + 1]! - ref[i]!) : 0;
      const dy = y + 1 < h ? Math.abs(ref[i + w]! - ref[i]!) : 0;
      detail += (dx + dy) / 2;
    }
  const n = w * h;
  return d / n / Math.max(detail / n, DETAIL_FLOOR);
}

/* ------------------------------------------------------------------ *
 *  The comparison
 * ------------------------------------------------------------------ */

export interface PictureFidelity {
  page: number;
  order: number;
  box: Box;
  /** The .docx picture matched to it, or null when none matched. */
  docx: number | null;
  /** Pixel score against the matched picture (or the best one, unmatched). */
  pixels: number | null;
  /** Extent against the expected, or null when it is not checked. */
  size: {
    ok: boolean;
    expected: [number, number];
    got: [number, number];
  } | null;
  placement: {
    /** Paragraph index of the nearest text above / below found in the .docx. */
    above: number | null;
    below: number | null;
    ok: boolean;
    /** False when no neighbouring text could be found to check against. */
    anchored: boolean;
    segmentOk: boolean;
  } | null;
  /** Why this picture could not be judged, when it could not. */
  inconclusive?: string;
}

export interface DocxPictureReport {
  sourcePictures: number;
  docxPictures: number;
  matched: number;
  /** .docx pictures matched to no source picture. */
  extras: number[];
  pictures: PictureFidelity[];
  /** Pictures whose order was checked against neighbouring text. */
  orderChecked: number;
  maxPixelScore: number;
  pass: boolean;
  detail: string;
}

/** The nearest texts above and below `box` that overlap it horizontally. */
function neighbours(texts: readonly SourceText[], box: Box) {
  const overlaps = (t: SourceText) =>
    Math.min(t.box[2], box[2]) - Math.max(t.box[0], box[0]) > 1;
  const usable = texts.filter(
    (t) => (t.text.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 3 && overlaps(t),
  );
  const above = usable
    .filter((t) => t.box[3] <= box[1] + 2)
    .sort((a, b) => b.box[3] - a.box[3]);
  const below = usable
    .filter((t) => t.box[1] >= box[3] - 2)
    .sort((a, b) => a.box[1] - b.box[1]);
  return { above, below };
}

/** The one paragraph in `segment` that holds `text`, or null (none, or two). */
function paragraphHolding(
  body: DocxBody,
  text: string,
  segment: number | null,
): number | null {
  const hits: number[] = [];
  body.paragraphs.forEach((p, i) => {
    if (segment !== null && p.segment !== segment) return;
    if (normalise(p.text).includes(text)) hits.push(i);
  });
  return hits.length === 1 ? hits[0]! : null;
}

/**
 * Compare a .docx against its source PDF, picture by picture. See the
 * module docblock for what each check means and what it leaves out.
 */
export async function compareDocxPictures(
  source: Uint8Array,
  docx: Uint8Array,
): Promise<DocxPictureReport> {
  const body = await readDocxBody(docx);
  const src = await readSource(source);
  if (!src)
    return {
      sourcePictures: 0,
      docxPictures: body.pictures.length,
      matched: 0,
      extras: [],
      pictures: [],
      orderChecked: 0,
      maxPixelScore: 0,
      pass: false,
      detail: "CANNOT CONCLUDE: the source PDF could not be read by pdf-lib",
    };
  const decoded = await Promise.all(
    body.pictures.map((p) => (p.bytes ? decodeMedia(p.bytes) : null)),
  );

  // Every source picture against every .docx picture: first on a coarse
  // grid, for the few best candidates; then each candidate on the source's
  // own grid. Matched greedily, best score first, one to one.
  const COARSE = 16;
  const coarseSource = src.pictures.map((sp) =>
    sp.pixels ? greyGrid(sp.pixels, null, COARSE, COARSE) : null,
  );
  const coarseDocx = decoded.map((img, d) =>
    img ? greyGrid(img, body.pictures[d]!.crop, COARSE, COARSE) : null,
  );
  const pairs: { s: number; d: number; score: number }[] = [];
  src.pictures.forEach((sp, s) => {
    const coarse = coarseSource[s];
    if (!sp.pixels || !coarse) return;
    const candidates = coarseDocx
      .map((c, d) => ({
        d,
        score: c ? pixelScore(coarse, c, COARSE, COARSE) : Infinity,
      }))
      .filter((c) => Number.isFinite(c.score))
      .sort((a, b) => a.score - b.score)
      .slice(0, 3);
    const [w, h] = gridFor(sp.box[2] - sp.box[0], sp.box[3] - sp.box[1]);
    for (const { d } of candidates) {
      const dp = body.pictures[d]!;
      const ref = greyGrid(sp.pixels, dp.crop, w, h);
      pairs.push({
        s,
        d,
        score: pixelScore(ref, greyGrid(decoded[d]!, dp.crop, w, h), w, h),
      });
    }
  });
  pairs.sort((a, b) => a.score - b.score);
  const matchOf = new Map<number, { d: number; score: number }>();
  const bestOf = new Map<number, number>();
  const taken = new Set<number>();
  for (const pair of pairs) {
    if (!bestOf.has(pair.s)) bestOf.set(pair.s, pair.score);
    if (pair.score > PIXEL_BOUND) continue;
    if (matchOf.has(pair.s) || taken.has(pair.d)) continue;
    matchOf.set(pair.s, { d: pair.d, score: pair.score });
    taken.add(pair.d);
  }

  const expectedSegment = (page: number) =>
    src.nonEmpty.slice(0, page - 1).filter(Boolean).length;
  const results: PictureFidelity[] = src.pictures.map((sp, s) => {
    const match = matchOf.get(s);
    const base: PictureFidelity = {
      page: sp.page,
      order: sp.order,
      box: sp.box,
      docx: match?.d ?? null,
      pixels: match?.score ?? bestOf.get(s) ?? null,
      size: null,
      placement: null,
      ...(sp.pixels
        ? {}
        : { inconclusive: "its pixels could not be decoded here" }),
    };
    if (!match) return base;
    const dp = body.pictures[match.d]!;
    // Size: the shown part at the page's size, scaled down (aspect kept) only
    // as far as the text area needs.
    let size: PictureFidelity["size"] = null;
    let inconclusive = base.inconclusive;
    if (dp.rotation !== 0)
      inconclusive ??= "turned on the page: size not checked";
    else {
      const c = dp.crop ?? { left: 0, top: 0, right: 0, bottom: 0 };
      const w = (sp.box[2] - sp.box[0]) * (1 - c.left - c.right);
      const h = (sp.box[3] - sp.box[1]) * (1 - c.top - c.bottom);
      const scale = Math.min(
        1,
        body.page.textWidth / w,
        body.page.textHeight / h,
      );
      const expected: [number, number] = [w * scale, h * scale];
      const within = (got: number, want: number) =>
        Math.abs(got - want) <=
        Math.max(SIZE_TOLERANCE.points, SIZE_TOLERANCE.share * want);
      size = {
        ok: within(dp.width, expected[0]) && within(dp.height, expected[1]),
        expected,
        got: [dp.width, dp.height],
      };
    }
    // Order: between the nearest text above it and below it, in one segment.
    const { above, below } = neighbours(src.texts[sp.page - 1] ?? [], sp.box);
    const find = (cands: SourceText[]) => {
      for (const t of cands.slice(0, 6)) {
        const at =
          paragraphHolding(body, t.text, expectedSegment(sp.page)) ??
          paragraphHolding(body, t.text, null);
        if (at !== null) return at;
      }
      return null;
    };
    const a = find(above);
    const b = find(below);
    const segmentOf = (i: number | null) =>
      i === null ? null : body.paragraphs[i]!.segment;
    const want = segmentOf(a) ?? segmentOf(b) ?? expectedSegment(sp.page);
    const segmentOk =
      dp.segment === want &&
      (a === null || segmentOf(a) === want) &&
      (b === null || segmentOf(b) === want);
    const orderOk =
      segmentOk &&
      (a === null || a < dp.paragraph) &&
      (b === null || b > dp.paragraph);
    return {
      ...base,
      size,
      placement: {
        above: a,
        below: b,
        ok: orderOk,
        anchored: a !== null || b !== null,
        segmentOk,
      },
      ...(inconclusive ? { inconclusive } : {}),
    };
  });

  // Pictures on the same page with no text to place them by keep the page's
  // top-to-bottom order among themselves.
  for (const r of results) {
    if (!r.placement || r.placement.anchored || r.docx === null) continue;
    const later = results.filter(
      (o) =>
        o !== r &&
        o.page === r.page &&
        o.docx !== null &&
        !o.placement?.anchored &&
        (o.box[1] > r.box[1] + 1 ||
          (Math.abs(o.box[1] - r.box[1]) <= 1 && o.box[0] > r.box[0])),
    );
    if (
      later.some(
        (o) => body.pictures[o.docx!]!.index < body.pictures[r.docx!]!.index,
      )
    )
      r.placement.ok = false;
  }

  const matched = results.filter((r) => r.docx !== null).length;
  const extras = body.pictures.map((p) => p.index).filter((i) => !taken.has(i));
  const sizeBad = results.filter((r) => r.size && !r.size.ok);
  const orderBad = results.filter((r) => r.placement && !r.placement.ok);
  const inconclusive = results.filter((r) => r.inconclusive);
  const scores = results.flatMap((r) =>
    r.docx !== null && r.pixels !== null ? [r.pixels] : [],
  );
  const maxPixelScore = Math.max(0, ...scores);
  const orderChecked = results.filter((r) => r.placement?.anchored).length;
  const pass =
    matched === src.pictures.length &&
    extras.length === 0 &&
    sizeBad.length === 0 &&
    orderBad.length === 0 &&
    inconclusive.length === 0;
  const where = (rs: PictureFidelity[]) =>
    rs.map((r) => `p${r.page}#${r.order + 1}`).join(", ");
  const detail = [
    `${matched} of ${src.pictures.length} source picture(s) found in the DOCX (which holds ${body.pictures.length})`,
    `pixels max ${maxPixelScore.toFixed(3)} (bound ${PIXEL_BOUND})`,
    `order checked against text for ${orderChecked}`,
    matched < src.pictures.length
      ? `missing: ${where(results.filter((r) => r.docx === null))}`
      : "",
    extras.length
      ? `${extras.length} DOCX picture(s) match no source picture`
      : "",
    sizeBad.length ? `wrong size: ${where(sizeBad)}` : "",
    orderBad.length ? `out of order: ${where(orderBad)}` : "",
    inconclusive.length
      ? `CANNOT CONCLUDE on ${where(inconclusive)}: ${[...new Set(inconclusive.map((r) => r.inconclusive))].join("; ")}`
      : "",
    body.page.declared
      ? ""
      : "the DOCX declares no page size (Word's defaults assumed)",
  ]
    .filter(Boolean)
    .join("; ");
  return {
    sourcePictures: src.pictures.length,
    docxPictures: body.pictures.length,
    matched,
    extras,
    pictures: results,
    orderChecked,
    maxPixelScore,
    pass,
    detail,
  };
}
