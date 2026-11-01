/**
 * `pnpm worker:ocr-deskew-proof` — OCR PDF's "Straighten crooked pages"
 * (OCRmyPDF `--deskew`) asked of the BUILT worker image's own engine, and
 * judged by MEASURING the page a reader receives, not by reading the argv.
 *
 * Every unit test of the option runs where OCRmyPDF is not installed: they
 * prove the flag reaches the argv (`ocr-native.test.ts`, and the panel →
 * job → processor → argv chain in `ocr-deskew.dom.test.tsx`), never that the
 * engine straightens anything. This runs inside the image, through the
 * registry's OCR processor — the one `ocr-pdf` jobs reach — and checks:
 *
 *   1. INSTRUMENT — a generated page of long, thick, dark horizontal bars,
 *      rotated by {@link FIXTURE_SKEW_DEGREES}, made into a SCAN (pixels only,
 *      checked to carry no text). Its rendered page must MEASURE that angle,
 *      and the same page drawn straight must measure about zero, or the
 *      instrument is blind and nothing below means anything.
 *   2. STRAIGHTENED — the scan through OCR PDF with `deskew: true`: page 1 of
 *      the output, rendered, must measure under {@link STRAIGHT_DEGREES}.
 *   3. NEGATIVE CONTROL — the same scan with `deskew: false` must still
 *      measure about the fixture's angle. Without it a measurement that read
 *      every page as straight would pass check 2.
 *   4. SEARCHABLE — the straightened output still carries the fixture's
 *      sentinel words as text (poppler's reading): straightening must not
 *      cost the reason the tool exists.
 *   5. THE PAIR — the image's OCRmyPDF, run directly with `--redo-ocr` and
 *      `--deskew`, must refuse them as a usage error naming both. That is
 *      the reason the panel and `parseOcrOptions` refuse the pair; if a newer
 *      engine ever accepts it, this goes red so someone re-decides, instead
 *      of the restriction outliving its reason.
 *
 * Exit codes: 0 = proven; 1 = a check failed; 2 = an engine this proof needs
 * is not in the image. Output names angles, counts and verdicts only — never
 * a path, never recognised text beyond the fixed sentinel.
 */
import { PDFDocument, degrees, rgb } from "pdf-lib";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";
import type { Processor, ProcessorResult } from "./processor/types";

/** How far the fixture is turned, counter-clockwise, in degrees. */
export const FIXTURE_SKEW_DEGREES = 3.5;

/** A straightened page must measure under this many degrees. */
export const STRAIGHT_DEGREES = 0.5;

/**
 * How close a measurement must come to the fixture's own angle to count as
 * "still skewed" (the negative control) or "the instrument reads it" (the
 * health check): within this many degrees of {@link FIXTURE_SKEW_DEGREES}.
 */
export const SKEW_TOLERANCE_DEGREES = 0.75;

/** The fixed words on the fixture, below the bars. */
export const DESKEW_SENTINEL = "Deskew proof sentinel 5307";

/** US Letter, in points. */
const PAGE: [number, number] = [612, 792];

/**
 * The bars, in points on the UNROTATED page: long (75% of the width), thick
 * (14 pt, about 2% of the height), well apart, with nothing above the first
 * and the sentinel line well below the last, so a column read from the top
 * meets the bars first and in order.
 */
const BAR = { x: 76, width: 460, height: 14 };
const BAR_TOPS = [640, 590, 540, 490] as const;
export const BAR_COUNT = BAR_TOPS.length;
const SENTINEL_BASELINE = 330;
const SENTINEL_SIZE = 28;

/**
 * A TYPED page: the bars and the sentinel line, every item turned by
 * `angle` degrees counter-clockwise about the page centre. pdf-lib rotates
 * an item about its own origin, so each origin is first moved to where the
 * page-centre rotation puts it. The caller makes it a scan.
 */
export async function skewedBarsPage(angle: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage(PAGE);
  const font = await embedDrawingFont(doc, [DESKEW_SENTINEL]);
  const [cx, cy] = [PAGE[0] / 2, PAGE[1] / 2];
  const t = (angle * Math.PI) / 180;
  const turn = (x: number, y: number) => ({
    x: cx + (x - cx) * Math.cos(t) - (y - cy) * Math.sin(t),
    y: cy + (x - cx) * Math.sin(t) + (y - cy) * Math.cos(t),
  });
  for (const top of BAR_TOPS) {
    const origin = turn(BAR.x, top - BAR.height);
    page.drawRectangle({
      ...origin,
      width: BAR.width,
      height: BAR.height,
      color: rgb(0, 0, 0),
      rotate: degrees(angle),
    });
  }
  page.drawText(DESKEW_SENTINEL, {
    ...turn(BAR.x, SENTINEL_BASELINE),
    size: SENTINEL_SIZE,
    font,
    color: rgb(0, 0, 0),
    rotate: degrees(angle),
  });
  return doc.save();
}

/** A rendered page in grey: one byte per pixel, top row first. */
export interface GreyPage {
  width: number;
  height: number;
  grey: Uint8Array;
}

/**
 * An RGBA raster (pdf.js's canvas) as {@link GreyPage}, composited over
 * white: a transparent pixel is paper, not ink.
 */
export function greyOf(page: {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}): GreyPage {
  const grey = new Uint8Array(page.width * page.height);
  for (let i = 0; i < grey.length; i++) {
    const a = page.data[i * 4 + 3]! / 255;
    const lum =
      0.299 * page.data[i * 4]! +
      0.587 * page.data[i * 4 + 1]! +
      0.114 * page.data[i * 4 + 2]!;
    grey[i] = Math.round(255 * (1 - a) + a * lum);
  }
  return { width: page.width, height: page.height, grey };
}

export interface SkewMeasurement {
  /** The median of the bars' angles, degrees; positive = right end higher. */
  degrees: number;
  /** Each bar's angle, top bar first. */
  bars: number[];
  /** How many columns every bar was found in. */
  columns: number;
}

const DARK = 128;

/**
 * The skew of the bars on a rendered page, MEASURED. For each of a row of
 * columns across the middle half of the page, the column is read from just
 * below the top margin (where a rotation's corner wedge cannot reach)
 * downwards, and the top edge of each of the first {@link BAR_COUNT} dark
 * runs at least `minRun` pixels tall is taken, to a fraction of a pixel
 * (where the grey crosses mid-grey). A straight line is fitted through each
 * bar's edge points; its angle is that bar's. The page's skew is the median
 * bar.
 *
 * Throws, rather than returning a number, when a column does not meet every
 * bar: a measurement over a set that quietly lost a bar would still report
 * an angle, and the convenient one.
 */
export function measureBarSkew(page: GreyPage): SkewMeasurement {
  const { width: w, height: h, grey } = page;
  if (grey.length !== w * h || w < 100 || h < 100)
    throw new Error(`implausible page raster ${w}x${h}`);
  const at = (x: number, y: number) => grey[y * w + x]!;
  // Bars are about 1.8% of the height; text strokes are read only after the
  // fourth bar, so a stroke never counts as one.
  const minRun = Math.max(3, Math.round(h * 0.008));
  const yStart = Math.round(h * 0.1);
  const COLUMNS = 25;
  const edges: { x: number; y: number }[][] = Array.from(
    { length: BAR_COUNT },
    () => [],
  );
  for (let i = 0; i < COLUMNS; i++) {
    const x = Math.round(w * (0.25 + (0.5 * i) / (COLUMNS - 1)));
    let found = 0;
    let y = yStart;
    while (y < h && found < BAR_COUNT) {
      if (at(x, y) >= DARK) {
        y++;
        continue;
      }
      let end = y;
      while (end < h && at(x, end) < DARK) end++;
      if (end - y >= minRun) {
        // Sub-pixel: where the grey crosses DARK between y-1 and y.
        const above = y > 0 ? at(x, y - 1) : 255;
        const below = at(x, y);
        const frac = above === below ? 0 : (above - DARK) / (above - below);
        edges[found]!.push({ x, y: y - 1 + frac });
        found++;
      }
      y = end;
    }
    if (found < BAR_COUNT)
      throw new Error(
        `instrument: column ${i + 1} of ${COLUMNS} (x=${x}) met ${found} of ${BAR_COUNT} bars`,
      );
  }
  const bars = edges.map((points) => {
    const n = points.length;
    const mx = points.reduce((s, p) => s + p.x, 0) / n;
    const my = points.reduce((s, p) => s + p.y, 0) / n;
    let sxy = 0;
    let sxx = 0;
    for (const p of points) {
      sxy += (p.x - mx) * (p.y - my);
      sxx += (p.x - mx) ** 2;
    }
    // Image rows grow DOWNWARDS, so a right end that is higher on the page
    // has a smaller y: negate, so a counter-clockwise turn reads positive.
    return (-Math.atan(sxy / sxx) * 180) / Math.PI;
  });
  const sorted = [...bars].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  const median =
    sorted.length % 2 === 1
      ? sorted[Math.floor(mid)]!
      : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return { degrees: median, bars, columns: COLUMNS };
}

/** What `ocrmypdf` said when run directly. */
export interface EngineRun {
  code: number;
  stderr: string;
}

export interface OcrDeskewProofDeps {
  /** The registry's OCR processor (what `ocr-pdf` jobs reach). */
  ocr: Processor;
  /** A typed PDF → a scan of its first page (pixels only). */
  scan: (typed: Uint8Array) => Promise<Uint8Array>;
  /** Page 1 of a PDF as a viewer paints it, in grey. */
  render: (pdf: Uint8Array) => Promise<GreyPage>;
  /** poppler's text of a PDF; null when pdftotext is absent. */
  pdfText: ((pdf: Uint8Array) => Promise<string>) | null;
  /**
   * The image's OCRmyPDF run directly on `pdf` with extra flags (input and
   * output paths are the caller's); null when it cannot be started.
   */
  ocrmypdf: ((pdf: Uint8Array, flags: string[]) => Promise<EngineRun>) | null;
  log?: (line: string) => void;
}

const PDF = "application/pdf";

function job(bytes: Uint8Array, deskew: boolean) {
  return {
    tool: "ocr-pdf",
    options: {
      languages: ["eng"],
      outputMode: "searchable-pdf",
      deskew,
    } as Record<string, unknown>,
    inputs: [
      { fileId: "proof", filename: "crooked.pdf", contentType: PDF, bytes },
    ],
  };
}

function outputPdf(result: ProcessorResult): Uint8Array | null {
  if (!result.ok) return null;
  return result.artifacts.find((a) => a.contentType === PDF)?.bytes ?? null;
}

const fmt = (d: number) => `${d.toFixed(2)}°`;
const describe = (m: SkewMeasurement) =>
  `measured ${fmt(m.degrees)} (bars ${m.bars.map(fmt).join(", ")}; ${m.columns} columns each)`;

export async function runOcrDeskewProof(
  deps: OcrDeskewProofDeps,
): Promise<0 | 1 | 2> {
  const log = deps.log ?? ((line: string) => console.log(line));
  let failed = 0;
  const check = (ok: boolean, name: string, detail: string) => {
    log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
    if (!ok) failed += 1;
  };
  if (!deps.ocr.capability().ready || !deps.pdfText || !deps.ocrmypdf) {
    log(
      `MISSING ${!deps.ocr.capability().ready ? "a ready OCR engine" : !deps.pdfText ? "pdftotext" : "ocrmypdf"}: the deskew proof cannot run in this image.`,
    );
    return 2;
  }
  const measure = async (
    name: string,
    pdf: Uint8Array,
  ): Promise<SkewMeasurement | null> => {
    try {
      return measureBarSkew(await deps.render(pdf));
    } catch (error) {
      check(false, name, (error as Error).message);
      return null;
    }
  };

  // ── 1. the instrument, on the fixture itself ─────────────────────────────
  const crooked = await deps.scan(await skewedBarsPage(FIXTURE_SKEW_DEGREES));
  const straight = await deps.scan(await skewedBarsPage(0));
  const leftover = (await deps.pdfText(crooked)).trim();
  check(
    leftover.length === 0,
    "fixture is a scan (no text layer)",
    `${leftover.length} characters`,
  );
  const fixture = await measure("instrument on the crooked fixture", crooked);
  if (fixture)
    check(
      Math.abs(fixture.degrees - FIXTURE_SKEW_DEGREES) <=
        SKEW_TOLERANCE_DEGREES,
      `instrument reads the crooked fixture as ~${fmt(FIXTURE_SKEW_DEGREES)}`,
      describe(fixture),
    );
  const level = await measure("instrument on the straight fixture", straight);
  if (level)
    check(
      Math.abs(level.degrees) < STRAIGHT_DEGREES / 2,
      "instrument reads the straight fixture as ~0°",
      describe(level),
    );

  // ── 2. deskew on: the page a reader receives is straight ─────────────────
  const on = await deps.ocr.process(job(crooked, true));
  const onPdf = outputPdf(on);
  if (!onPdf) {
    check(
      false,
      "ocr-pdf with deskew",
      on.ok ? "no PDF artifact" : `${on.error.code}: ${on.error.message}`,
    );
  } else {
    const m = await measure("deskew on: output page 1", onPdf);
    if (m)
      check(
        Math.abs(m.degrees) < STRAIGHT_DEGREES,
        `deskew on: output page 1 is straight (under ${fmt(STRAIGHT_DEGREES)})`,
        describe(m),
      );
    // ── 4. still searchable ──────────────────────────────────────────────
    const words = (await deps.pdfText(onPdf)).toLowerCase();
    const want = DESKEW_SENTINEL.toLowerCase().split(" ");
    const missing = want.filter((w) => !words.includes(w));
    check(
      missing.length === 0,
      "deskew on: output is searchable",
      missing.length === 0
        ? `all ${want.length} sentinel words in the text layer`
        : `${missing.length} of ${want.length} sentinel words missing (${missing.join(" ")})`,
    );
  }

  // ── 3. negative control: deskew off leaves it crooked ────────────────────
  const off = await deps.ocr.process(job(crooked, false));
  const offPdf = outputPdf(off);
  if (!offPdf) {
    check(
      false,
      "ocr-pdf without deskew (control)",
      off.ok ? "no PDF artifact" : `${off.error.code}: ${off.error.message}`,
    );
  } else {
    const m = await measure("deskew off: output page 1 (control)", offPdf);
    if (m)
      check(
        Math.abs(m.degrees - FIXTURE_SKEW_DEGREES) <= SKEW_TOLERANCE_DEGREES,
        `deskew off: output page 1 is still ~${fmt(FIXTURE_SKEW_DEGREES)} (control)`,
        describe(m),
      );
  }

  // ── 5. the engine refuses --redo-ocr with --deskew ───────────────────────
  const pair = await deps.ocrmypdf(crooked, ["--redo-ocr", "--deskew"]);
  const refused =
    pair.code !== 0 &&
    /redo-ocr/i.test(pair.stderr) &&
    /deskew/i.test(pair.stderr);
  check(
    refused,
    "OCRmyPDF refuses --redo-ocr with --deskew (why the pair is refused)",
    refused
      ? `exit ${pair.code}, naming both flags`
      : pair.code === 0
        ? "the engine ACCEPTED the pair: re-decide whether the panel and parseOcrOptions should still refuse it"
        : `exit ${pair.code}, but its message does not name both flags`,
  );

  log(
    failed === 0
      ? "PROVEN: deskew straightens a crooked scan in this image, and its absence does not."
      : `NOT PROVEN: ${failed} check(s) failed.`,
  );
  return failed === 0 ? 0 : 1;
}
