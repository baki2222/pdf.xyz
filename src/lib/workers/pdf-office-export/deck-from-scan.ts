/**
 * From what a page scan found (`./page-scan`) to the deck the writer packs
 * (`./pptx-package`): the slide size, where each page sits on its slide, and
 * how a PDF line of text becomes a PowerPoint text box that draws its letters
 * where the PDF did.
 *
 * ── SLIDE SIZE ──────────────────────────────────────────────────────────────
 *
 * A .pptx has ONE slide size. It is the first page's, as displayed (its
 * /Rotate applied), clamped into `ST_SlideSizeCoordinate` (1 in – 56 in) by a
 * uniform scale, so a receipt strip or an A0 poster still opens. Every page is
 * then fitted inside the slide, centred, aspect kept — the same mapping the
 * fidelity instrument compares through (`./fidelity`, `fitCentred`).
 *
 * ── TEXT THAT LANDS WHERE IT WAS ────────────────────────────────────────────
 *
 * A text box with no insets puts its first baseline one font ASCENT below its
 * top, and that ascent is PowerPoint's (the font's Windows ascent), not the
 * PDF's. So each box's top is the PDF baseline minus that ascent, per
 * typeface ({@link TYPEFACE_METRICS}); the box does not wrap, and sizes to its
 * text. Fonts are mapped to a typeface a reader is likely to have: a family
 * PowerPoint and LibreOffice both carry (or a metric-compatible clone of it)
 * keeps its name, any other becomes Arial, Times New Roman or Courier New by
 * the PDF font's own serif / sans / monospace class.
 */
import { fitCentred } from "./fidelity";
import {
  SYMBOL_FAMILY,
  type FontClass,
  type PdfPageScan,
  type ScannedPicture,
  type ScannedRun,
  type ScannedTextLine,
} from "./page-scan";
import {
  EMU_PER_POINT,
  SLIDE_SIZE_MAX_EMU,
  SLIDE_SIZE_MIN_EMU,
  type PptxDeck,
  type PptxRun,
  type PptxShape,
  type Xfrm,
} from "./pptx-package";

/**
 * PowerPoint's first-baseline offset and single line height, in ems, for the
 * typefaces this module writes. MEASURED 2026-10-10, not looked up: boxes at
 * known tops (no insets, 10, 24 and 48 pt) through PowerPoint 16.0 build 20430
 * → PDF, each baseline read back with PyMuPDF; the offsets held to ±0.01 em
 * across sizes (Calibri 0.935, Arial 0.945, Times New Roman 0.943, Courier
 * New 0.896). The font tables' own ascents are NOT these: Calibri's Windows
 * ascent is 0.952. LibreOffice was not available to measure; it lays out the
 * worker's metric clones (Carlito, Liberation), which share the metrics.
 */
export const TYPEFACE_METRICS: Readonly<
  Record<string, { ascent: number; line: number }>
> = {
  Calibri: { ascent: 0.935, line: 1.22 },
  Arial: { ascent: 0.945, line: 1.15 },
  "Times New Roman": { ascent: 0.943, line: 1.15 },
  "Courier New": { ascent: 0.896, line: 1.13 },
};
const DEFAULT_METRICS = { ascent: 0.9, line: 1.2 };

/** Families kept by name: Office's and Windows' own, and the worker's clones. */
const KNOWN_FAMILIES = [
  "Arial",
  "Arial Black",
  "Arial Narrow",
  "Aptos",
  "Bahnschrift",
  "Book Antiqua",
  "Bookman Old Style",
  "Calibri",
  "Calibri Light",
  "Cambria",
  "Candara",
  "Century",
  "Century Gothic",
  "Comic Sans MS",
  "Consolas",
  "Constantia",
  "Corbel",
  "Courier New",
  "Franklin Gothic Medium",
  "Garamond",
  "Georgia",
  "Gill Sans MT",
  "Impact",
  "Lucida Console",
  "Lucida Sans Unicode",
  "Palatino Linotype",
  "Segoe UI",
  "Segoe UI Symbol",
  "Tahoma",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
  "Symbol",
  "Wingdings",
  "Wingdings 2",
  "Wingdings 3",
  "Webdings",
  "Carlito",
  "Caladea",
  "Liberation Sans",
  "Liberation Serif",
  "Liberation Mono",
  "DejaVu Sans",
  "DejaVu Serif",
  "DejaVu Sans Mono",
  "Noto Sans",
  "Noto Serif",
  "Noto Sans Mono",
];
const KNOWN = new Map(KNOWN_FAMILIES.map((f) => [f.toLowerCase(), f]));
const ALIASES: Readonly<Record<string, string>> = {
  helvetica: "Arial",
  "helvetica neue": "Arial",
  arial: "Arial",
  times: "Times New Roman",
  "times roman": "Times New Roman",
  courier: "Courier New",
  "zapf dingbats": "Wingdings",
  "itc zapf dingbats": "Wingdings",
};
/**
 * Aliases whose target draws the SAME advance widths (Arial was cut to
 * Helvetica's metrics, Times New Roman to Times', Courier New to Courier's).
 * Only for these, and for families kept by name, does the PDF's own spacing
 * carry over (`spc`): measured against another face it would be wrong.
 */
const METRIC_ALIASES = new Set([
  "helvetica",
  "times",
  "times roman",
  "courier",
]);
const CLASS_DEFAULT: Readonly<Record<FontClass, string>> = {
  sans: "Arial",
  serif: "Times New Roman",
  mono: "Courier New",
};
const PITCH_FAMILY: Readonly<Record<FontClass, number>> = {
  serif: 18,
  sans: 34,
  mono: 49,
};
/** The Private Use Area (U+E000–U+F8FF), where unmapped symbol glyphs land. */
const PRIVATE_USE = new RegExp(
  `[${String.fromCharCode(0xe000)}-${String.fromCharCode(0xf8ff)}]`,
);

/**
 * The typeface a run is written in. A symbol font whose glyphs pdf.js mapped
 * to real characters (an arrow, a check mark) is written in `fallback`, the
 * line's text face: the character is right and Wingdings would draw it wrong.
 */
export function typefaceFor(
  run: Pick<ScannedRun, "family" | "fontClass" | "text">,
  fallback?: string,
): string {
  const name = run.family.trim();
  const lower = name.toLowerCase();
  if (SYMBOL_FAMILY.test(name) && !PRIVATE_USE.test(run.text))
    return fallback ?? CLASS_DEFAULT[run.fontClass];
  return KNOWN.get(lower) ?? ALIASES[lower] ?? CLASS_DEFAULT[run.fontClass];
}

/** Does the deck draw this run in a face with the PDF font's own widths? */
function sameWidths(run: Pick<ScannedRun, "family">): boolean {
  const lower = run.family.trim().toLowerCase();
  if (SYMBOL_FAMILY.test(lower)) return false;
  return KNOWN.has(lower) || METRIC_ALIASES.has(lower);
}

function metricsFor(typeface: string) {
  return TYPEFACE_METRICS[typeface] ?? DEFAULT_METRICS;
}

/** The deck's slide size for a first page of `width` × `height` points. */
export function slideSizeFor(
  width: number,
  height: number,
): { width: number; height: number } {
  const w = width * EMU_PER_POINT;
  const h = height * EMU_PER_POINT;
  let s = 1;
  if (Math.max(w, h) > SLIDE_SIZE_MAX_EMU)
    s = SLIDE_SIZE_MAX_EMU / Math.max(w, h);
  if (Math.min(w, h) * s < SLIDE_SIZE_MIN_EMU)
    s = SLIDE_SIZE_MIN_EMU / Math.min(w, h);
  const clamp = (v: number) =>
    Math.round(Math.min(SLIDE_SIZE_MAX_EMU, Math.max(SLIDE_SIZE_MIN_EMU, v)));
  return { width: clamp(w * s), height: clamp(h * s) };
}

const ROT_UNITS = 60_000;

function rotOf(degrees: number): number {
  const r = Math.round(degrees * ROT_UNITS) % (360 * ROT_UNITS);
  return r < 0 ? r + 360 * ROT_UNITS : r;
}

/** Hundredths of a point, within `ST_TextFontSize` (1–4000 pt). */
function szOf(points: number): number {
  return Math.min(400_000, Math.max(100, Math.round(points * 100)));
}

function textBoxXfrm(
  line: ScannedTextLine,
  ascent: number,
  height: number,
  place: (x: number, y: number, w: number, h: number) => Xfrm,
): Xfrm {
  // Move the box along its own vertical axis so PowerPoint's first baseline
  // (`ascent` below the top) falls on the PDF's (`line.baseline` below it).
  const theta = (line.rotation * Math.PI) / 180;
  const shift = height / 2 - ascent - (line.height / 2 - line.baseline);
  const cx = line.x + line.width / 2 - shift * Math.sin(theta);
  const cy = line.y + line.height / 2 + shift * Math.cos(theta);
  return {
    ...place(cx - line.width / 2, cy - height / 2, line.width, height),
    ...(line.rotation ? { rot: rotOf(line.rotation) } : {}),
  };
}

function textShape(
  line: ScannedTextLine,
  index: number,
  scale: number,
  place: (x: number, y: number, w: number, h: number) => Xfrm,
): PptxShape {
  // The line's text face: its first visible-font run, for symbol runs to use.
  const face =
    line.runs
      .filter((r) => !SYMBOL_FAMILY.test(r.family))
      .map((r) => typefaceFor(r))[0] ?? undefined;
  const runs: PptxRun[] = line.runs.map((r) => ({
    text: r.text,
    typeface: typefaceFor(r, face),
    pitchFamily: PITCH_FAMILY[r.fontClass],
    sz: szOf(r.size * scale),
    bold: r.bold,
    italic: r.italic,
    color: r.color,
    ...(r.alpha < 0.999 ? { alpha: Math.round(r.alpha * 100_000) } : {}),
    ...(sameWidths(r) && Math.abs(r.spacing * scale) >= 0.01
      ? { spc: Math.round(r.spacing * scale * 100) }
      : {}),
    ...(r.invisible ? { invisible: true } : {}),
  }));
  const biggest = line.runs.reduce(
    (best, r) => (r.size > best.size ? r : best),
    line.runs[0]!,
  );
  const metrics = metricsFor(typefaceFor(biggest, face));
  const size = biggest.size;
  return {
    kind: "text",
    name: `Text ${index}`,
    xfrm: textBoxXfrm(line, metrics.ascent * size, metrics.line * size, place),
    paragraphs: [runs],
  };
}

function pictureShape(
  pic: ScannedPicture,
  index: number,
  place: (x: number, y: number, w: number, h: number) => Xfrm,
): PptxShape {
  const pct = (f: number) => Math.round(f * 100_000);
  return {
    kind: "picture",
    name: `${pic.role === "image" ? "Picture" : "Drawing"} ${index}`,
    media: { key: pic.media.key, bytes: pic.media.bytes, ext: pic.media.ext },
    xfrm: {
      ...place(pic.x, pic.y, pic.width, pic.height),
      ...(pic.rotation ? { rot: rotOf(pic.rotation) } : {}),
      ...(pic.flipH ? { flipH: true } : {}),
      ...(pic.flipV ? { flipV: true } : {}),
    },
    ...(pic.crop
      ? {
          crop: {
            l: pct(pic.crop.left),
            t: pct(pic.crop.top),
            r: pct(pic.crop.right),
            b: pct(pic.crop.bottom),
          },
        }
      : {}),
  };
}

/** The deck for a scan: one slide per page, shapes in paint order. */
export function deckFromScan(scan: PdfPageScan): PptxDeck {
  const first = scan.pages[0];
  const size = first
    ? slideSizeFor(first.width, first.height)
    : slideSizeFor(720, 540);
  const slides = scan.pages.map((page) => {
    const fit = fitCentred(
      {
        width: page.width * EMU_PER_POINT,
        height: page.height * EMU_PER_POINT,
      },
      size,
    );
    const k = fit.scale * EMU_PER_POINT;
    const place = (x: number, y: number, w: number, h: number): Xfrm => ({
      x: fit.offsetX + x * k,
      y: fit.offsetY + y * k,
      cx: w * k,
      cy: h * k,
    });
    const shapes = page.items.map((item, i) =>
      item.kind === "text"
        ? textShape(item, i + 1, fit.scale, place)
        : pictureShape(item, i + 1, place),
    );
    return { name: `Page ${page.pageNumber}`, shapes };
  });
  return { width: size.width, height: size.height, slides };
}
