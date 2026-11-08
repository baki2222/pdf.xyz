/**
 * The OCR-first exports at the deployment, judged on the file a person
 * downloads (wave 3, audit pdf-to-powerpoint#4 and pdf-to-word#3, 2026-11-08).
 *
 * Every unit test of these options runs where OCRmyPDF is not installed: the
 * chain tests (`processor/pdf-office-export-ocr.chain.test.ts`) prove the
 * options REACH the OCR request, never that the engine did anything with
 * them. And an option an older worker ignores still hands back a valid
 * DOCX or PPTX, so "a DOCX came back" proves nothing. Each verdict here
 * reads the property the option changes:
 *
 *  - PDF to PowerPoint, OCR on: the slide carries the scan as a PICTURE and
 *    the scan's words as text runs drawn with no fill (`<a:noFill/>`), so
 *    they are selectable without painting a second copy over the picture.
 *    OCR off (the control, and the shape every slide had before): the
 *    picture and none of the words.
 *  - PDF to Word, Turn pages upright: an upside-down scan's words reach the
 *    DOCX only when the page was turned before recognition. Off, Tesseract
 *    reads the page as it lies and the sentinel is not among the text.
 *  - PDF to Word, Straighten: the scan's picture in the DOCX is level; off,
 *    it keeps the fixture's 3.5° (measured with the OCR PDF deskew proof's
 *    own instrument). The scan is recognised either way, so text alone
 *    cannot tell the two apart.
 *  - PDF to Word, Redo existing OCR: a scan carrying a STALE invisible text
 *    layer (words the picture does not show) comes back with the picture's
 *    words and none of the stale ones. Off, `--skip-text` keeps the page as
 *    it is, and the DOCX carries the stale layer: the defect the option
 *    exists for.
 *
 * Pure (pdf-lib, JSZip and text only; the one raster step is INJECTED), so
 * `ocr-first-proof.test.ts` and `scripts/worker-prove-tools.ts` ask the same
 * question of the same function. Every verdict has a health check first: an
 * unreadable file, a missing slide, or a DOCX without the scan's picture
 * fails before any "every word is …" can pass over nothing.
 */
import JSZip from "jszip";
import {
  PDFDocument,
  TextRenderingMode,
  popGraphicsState,
  pushGraphicsState,
  setTextRenderingMode,
} from "pdf-lib";
import {
  DESKEW_SENTINEL,
  FIXTURE_SKEW_DEGREES,
  SKEW_TOLERANCE_DEGREES,
  STRAIGHT_DEGREES,
  greyOf,
  measureBarSkew,
} from "../ocr-deskew-proof";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";
import { UPRIGHT_SENTINEL } from "../ocr-rotate-proof";
import { readDocxBody } from "./docx-read";

export interface ProofVerdict {
  ok: boolean;
  detail: string;
}

/** Lower-case alphanumeric words, the way OCR output is compared. */
export function proofWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};
const unescapeXml = (s: string) =>
  s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => XML_ENTITIES[e]!);

/* ------------------------------------------------------------------ *
 *  PDF to PowerPoint, OCR on / off
 * ------------------------------------------------------------------ */

export interface SlideRun {
  text: string;
  /** Drawn with `<a:noFill/>`: selectable text that paints nothing. */
  invisible: boolean;
}

/** Every `<a:r>` of a slide: its text, and whether it is drawn unfilled. */
export function slideRuns(slideXml: string): SlideRun[] {
  const runs: SlideRun[] = [];
  for (const r of slideXml.matchAll(/<a:r>([\s\S]*?)<\/a:r>/g)) {
    const body = r[1]!;
    const rPr = /<a:rPr\b[^>]*?(?:\/>|>([\s\S]*?)<\/a:rPr>)/.exec(body);
    const text = /<a:t>([\s\S]*?)<\/a:t>/.exec(body)?.[1] ?? "";
    runs.push({
      text: unescapeXml(text),
      invisible: /<a:noFill\/>/.test(rPr?.[1] ?? ""),
    });
  }
  return runs;
}

/**
 * The deck PDF to PowerPoint returned for a one-page image-only scan whose
 * words are `line`. Health: exactly one slide part, and on it a `p:pic`
 * whose `r:embed` resolves to a non-empty media part (the scan, carried).
 * `"ocr text"`: every word of `line` is in a run drawn with no fill, and
 * none in a run that paints. `"pictures only"`: no word of `line` in any
 * run — the slide a job without OCR, or a worker that ignores it, returns.
 */
export async function pptxOcrVerdict(
  bytes: Uint8Array,
  line: string,
  want: "ocr text" | "pictures only",
): Promise<ProofVerdict> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    return { ok: false, detail: "the artifact is not a readable PPTX (ZIP)" };
  }
  const slides = Object.keys(zip.files).filter((n) =>
    /^ppt\/slides\/slide\d+\.xml$/.test(n),
  );
  if (slides.length !== 1)
    return {
      ok: false,
      detail: `the deck has ${slides.length} slide part(s), not the scan's one`,
    };
  const slidePath = slides[0]!;
  const xml = await zip.file(slidePath)!.async("string");
  const relsPath = slidePath.replace(
    /slides\/(slide\d+\.xml)$/,
    "slides/_rels/$1.rels",
  );
  const rels = (await zip.file(relsPath)?.async("string")) ?? "";
  const embeds = [
    ...xml.matchAll(/<p:pic>[\s\S]*?<a:blip\b[^>]*r:embed="([^"]+)"/g),
  ].map((m) => m[1]!);
  let carried = 0;
  for (const id of embeds) {
    const target = new RegExp(
      `<Relationship\\b[^>]*Id="${id}"[^>]*Target="([^"]+)"`,
    ).exec(rels)?.[1];
    if (!target) continue;
    const part = new URL(target, `http://x/${slidePath}`).pathname.slice(1);
    const media = await zip.file(part)?.async("uint8array");
    if (media && media.byteLength > 0) carried += 1;
  }
  if (carried === 0)
    return {
      ok: false,
      detail: `the slide carries no picture that resolves to its media (${embeds.length} p:pic embed(s)) — the scan is not on it`,
    };
  const runs = slideRuns(xml);
  const hidden = new Set(
    runs.filter((r) => r.invisible).flatMap((r) => proofWords(r.text)),
  );
  const shown = new Set(
    runs.filter((r) => !r.invisible).flatMap((r) => proofWords(r.text)),
  );
  const wanted = proofWords(line);
  const unfilled = wanted.filter((w) => hidden.has(w));
  const painted = wanted.filter((w) => shown.has(w));
  const summary = `${carried} picture(s), ${runs.length} text run(s) (${runs.filter((r) => r.invisible).length} unfilled); ${unfilled.length} of ${wanted.length} scan words in unfilled runs, ${painted.length} in painted runs`;
  const ok =
    want === "ocr text"
      ? unfilled.length === wanted.length && painted.length === 0
      : unfilled.length === 0 && painted.length === 0;
  return { ok, detail: summary };
}

/* ------------------------------------------------------------------ *
 *  PDF to Word, OCR page choices
 * ------------------------------------------------------------------ */

interface ScanDocx {
  words: Set<string>;
  characters: number;
  pictures: Uint8Array[];
}

/** The DOCX as a reader gets it, or why it is not a scan's DOCX at all. */
async function readScanDocx(
  bytes: Uint8Array,
): Promise<ScanDocx | ProofVerdict> {
  let body: Awaited<ReturnType<typeof readDocxBody>>;
  try {
    body = await readDocxBody(bytes);
  } catch (error) {
    return {
      ok: false,
      detail: `the DOCX cannot be read: ${(error as Error).message}`,
    };
  }
  const text = body.paragraphs.map((p) => p.text).join(" ");
  const pictures = body.pictures
    .map((p) => p.bytes)
    .filter((b): b is Uint8Array => b !== null && b.byteLength > 0);
  if (pictures.length === 0)
    return {
      ok: false,
      detail: `the DOCX carries no picture that resolves (${body.pictures.length} drawing(s)) — the scan is not in it`,
    };
  if (proofWords(text).length === 0)
    return {
      ok: false,
      detail: "the DOCX has no text at all — nothing was recognised into it",
    };
  return {
    words: new Set(proofWords(text)),
    characters: text.length,
    pictures,
  };
}

const isVerdict = (v: ScanDocx | ProofVerdict): v is ProofVerdict => "ok" in v;

const count = (have: Set<string>, line: string) =>
  proofWords(line).filter((w) => have.has(w)).length;

/**
 * Turn pages upright, read from the DOCX: an upside-down scan of
 * {@link UPRIGHT_SENTINEL}. `"read"`: every sentinel word is text in it.
 * `"unread"` (the option off, or ignored): not every one is.
 */
export async function uprightDocxVerdict(
  bytes: Uint8Array,
  want: "read" | "unread",
): Promise<ProofVerdict> {
  const doc = await readScanDocx(bytes);
  if (isVerdict(doc)) return doc;
  const total = proofWords(UPRIGHT_SENTINEL).length;
  const found = count(doc.words, UPRIGHT_SENTINEL);
  const ok = want === "read" ? found === total : found < total;
  return {
    ok,
    detail: `${found} of ${total} upright-sentinel words in the DOCX text (${doc.characters} characters, ${doc.pictures.length} picture(s)); want ${want === "read" ? "all, the page turned before OCR" : "fewer, the page read as it lay"}`,
  };
}

/** Words on the stale text layer; the scan's picture shows none of them. */
export const STALE_LAYER_TEXT = "Stale layer walrus quixotic 9031";

/**
 * `scan` with a STALE OCR layer added: {@link STALE_LAYER_TEXT} drawn in
 * text render mode 3 (invisible), the way an OCR engine writes its layer,
 * in the page's lower margin. Under `--skip-text` the page has text and is
 * copied through; `--redo-ocr` strips invisible text and recognises again.
 */
export async function withStaleTextLayer(
  scan: Uint8Array,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(scan);
  const page = doc.getPage(0);
  const font = await embedDrawingFont(doc, [STALE_LAYER_TEXT]);
  page.pushOperators(
    pushGraphicsState(),
    setTextRenderingMode(TextRenderingMode.Invisible),
  );
  page.drawText(STALE_LAYER_TEXT, { x: 40, y: 60, size: 14, font });
  page.pushOperators(popGraphicsState());
  return doc.save({ useObjectStreams: false });
}

/**
 * Redo existing OCR, read from the DOCX of a scan of `line` carrying
 * {@link STALE_LAYER_TEXT}. `"replaced"`: every word of `line` and none of
 * the stale layer's. `"kept"` (the option off, or ignored — the defect):
 * every stale word, and not every word of `line`. `"beside"` (2026-11-08,
 * Redo on a layer OCRmyPDF 14 does not strip, such as its own Form XObject
 * layer: REDO_OCR_LAYER_OUTCOMES): every word of `line` AND every stale
 * word, the new text added beside the old.
 */
export async function redoDocxVerdict(
  bytes: Uint8Array,
  line: string,
  want: "replaced" | "kept" | "beside",
): Promise<ProofVerdict> {
  const doc = await readScanDocx(bytes);
  if (isVerdict(doc)) return doc;
  const lineTotal = proofWords(line).length;
  const staleTotal = proofWords(STALE_LAYER_TEXT).length;
  const lineFound = count(doc.words, line);
  const staleFound = count(doc.words, STALE_LAYER_TEXT);
  const ok =
    want === "replaced"
      ? lineFound === lineTotal && staleFound === 0
      : want === "beside"
        ? lineFound === lineTotal && staleFound === staleTotal
        : staleFound === staleTotal && lineFound < lineTotal;
  return {
    ok,
    detail: `${lineFound} of ${lineTotal} scan words and ${staleFound} of ${staleTotal} stale-layer words in the DOCX text; want ${want === "replaced" ? "every scan word, no stale one" : want === "beside" ? "every scan word beside every stale one" : "the stale layer kept, the scan unread"}`,
  };
}

/** A raster of each page of a PDF (pdf.js in the harness and the tests). */
export type PdfRasteriser = (
  pdf: Uint8Array,
  longSide: number,
) => Promise<{ width: number; height: number; data: Uint8ClampedArray }[]>;

/**
 * The DOCX's one picture as a one-page PDF the size of its pixels, so the
 * injected rasteriser can paint it. PNG and JPEG are what the Word writer
 * emits; anything else is reported, never guessed at.
 */
export async function pictureAsPdf(picture: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const png = picture[0] === 0x89 && picture[1] === 0x50;
  const jpeg = picture[0] === 0xff && picture[1] === 0xd8;
  if (!png && !jpeg)
    throw new Error("the DOCX picture is neither PNG nor JPEG");
  const image = png ? await doc.embedPng(picture) : await doc.embedJpg(picture);
  doc
    .addPage([image.width, image.height])
    .drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  return doc.save();
}

/**
 * Straighten, read from the DOCX of a scan of the deskew proof's bars page
 * turned {@link FIXTURE_SKEW_DEGREES}: its ONE picture, painted and measured
 * with {@link measureBarSkew}. `"straight"`: under {@link STRAIGHT_DEGREES}.
 * `"crooked"` (the option off, or ignored): within
 * {@link SKEW_TOLERANCE_DEGREES} of the fixture's angle. Both require at
 * least one {@link DESKEW_SENTINEL} word as text, so the DOCX is OCR's
 * reading of THIS page; the angle is what the option changes.
 *
 * CHANGED 2026-11-08, before it ever passed: both required EVERY sentinel
 * word. The first production run (the worker before wave 3) returned the
 * control's DOCX with the picture at 3.50° and 2 of the 4 words, so the
 * control failed on a claim that is not the option's: how a crooked page's
 * words survive the Word export's text flow. The words count stays in the
 * detail; the controls test holds that observed shape.
 */
export async function deskewDocxVerdict(
  bytes: Uint8Array,
  want: "straight" | "crooked",
  rasterise: PdfRasteriser,
): Promise<ProofVerdict> {
  const doc = await readScanDocx(bytes);
  if (isVerdict(doc)) return doc;
  if (doc.pictures.length !== 1)
    return {
      ok: false,
      detail: `the DOCX holds ${doc.pictures.length} pictures, not the scan's one`,
    };
  let degrees: number;
  try {
    const [page] = await rasterise(await pictureAsPdf(doc.pictures[0]!), 1100);
    if (!page) return { ok: false, detail: "the DOCX picture painted nothing" };
    degrees = measureBarSkew(greyOf(page)).degrees;
  } catch (error) {
    return { ok: false, detail: `instrument: ${(error as Error).message}` };
  }
  const level =
    want === "straight"
      ? Math.abs(degrees) < STRAIGHT_DEGREES
      : Math.abs(degrees - FIXTURE_SKEW_DEGREES) <= SKEW_TOLERANCE_DEGREES;
  const total = proofWords(DESKEW_SENTINEL).length;
  const found = count(doc.words, DESKEW_SENTINEL);
  return {
    ok: level && found > 0,
    detail: `the DOCX picture measures ${degrees.toFixed(2)}° (want ${
      want === "straight"
        ? `under ${STRAIGHT_DEGREES}°`
        : `~${FIXTURE_SKEW_DEGREES}°, straighten off`
    }); ${found} of ${total} deskew-sentinel words in the DOCX text`,
  };
}
