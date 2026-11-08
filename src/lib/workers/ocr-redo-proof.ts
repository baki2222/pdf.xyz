/**
 * `pnpm worker:ocr-redo-proof` — what “Redo existing OCR” (OCRmyPDF
 * `--redo-ocr`) takes away, asked of the BUILT worker image's own engine and
 * judged by the text a reader receives (poppler), not by the argv.
 *
 * WHY THIS EXISTS. On 2026-11-08 the wave-3 production proof of PDF to Word's
 * Redo option failed: the DOCX held every word of the scan AND every word of
 * a stale invisible layer. The argv was right (`--redo-ocr` reached
 * OCRmyPDF). OCRmyPDF 14.0.1 simply does not remove every hidden layer: it
 * removes one shape and keeps two, including the one it writes itself
 * ({@link REDO_OCR_LAYER_OUTCOMES} has the measurement). Until 2026-11-08 the copy said
 * "that text is removed" for all of them. The copy now says the table
 * ({@link REDO_OCR_SCOPE}); this proof keeps the table honest, because a
 * table of engine behaviour has no relationship any unit test can check.
 *
 * For each shape in the table, a scan of a known line carries a
 * stale layer of {@link STALE_OCR_TEXT} in that shape, and:
 *
 *   1. INSTRUMENT — the fixture's own text is every stale word and no scan
 *      word, and {@link staleLayerShapes} reads back exactly the shape it
 *      was built as. Otherwise nothing below means anything.
 *   2. REDO ON — through the registry's OCR processor (the instance OCR PDF
 *      and every OCR-first conversion reach) with `redoOcr: true`: every
 *      scan word is read, and the stale words are gone (`replaced`) or all
 *      still there (`kept`), exactly as the table says. A row that changes
 *      goes red here, so the copy is re-decided rather than left stale.
 *   3. NEGATIVE CONTROL — the replaced shape with redo OFF (`--skip-text`):
 *      every stale word kept and the scan unread. Without it, a fixture the
 *      engine ignores outright would pass step 2 for the wrong reason.
 *   4. A REAL OCRmyPDF LAYER — the scan read by the processor in
 *      {@link REAL_LAYER_LANGUAGE} (Cyrillic words, read back as the
 *      `ocrmypdf` shape), then redone in English: the earlier words must
 *      be kept or gone exactly as the `ocrmypdf` row says. Steps 1–3 use a
 *      hand-built stand-in; this is the layer a reader of our own OCR PDF
 *      actually has, so a change to how OCRmyPDF treats its OWN graft is
 *      seen here even while the stand-in still passes (added after review,
 *      2026-11-08; the live image printed 10 of 10 PASS).
 *
 * Exit codes: 0 = proven; 1 = a check failed; 2 = an engine this proof needs
 * is not in the image. Output names shapes, counts and verdicts only.
 */
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  TextRenderingMode,
  beginText,
  decodePDFRawStream,
  drawObject,
  endText,
  moveText,
  popGraphicsState,
  pushGraphicsState,
  setFontAndSize,
  setTextRenderingMode,
  showText,
  type PDFFont,
  type PDFObject,
} from "pdf-lib";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";
import {
  REDO_OCR_LAYER_OUTCOMES,
  type RedoOcrLayerShape,
} from "@/lib/jobs/ocr";
import type { Processor, ProcessorResult } from "./processor/types";

/** Words on the stale layer; the scan's picture shows none of them. */
export const STALE_OCR_TEXT = "Stale layer walrus quixotic 9031";

/** Every shape the table names, in its order. */
export const REDO_OCR_LAYER_SHAPES = Object.keys(
  REDO_OCR_LAYER_OUTCOMES,
) as RedoOcrLayerShape[];

const STALE_AT = { x: 40, y: 60, size: 14 } as const;

/**
 * `scan` with a stale invisible layer of {@link STALE_OCR_TEXT} in the page's
 * lower margin, stored in `shape` (see {@link REDO_OCR_LAYER_OUTCOMES}):
 *
 *  - `tesseract`: `q BT /F 14 Tf 3 Tr … Tj ET Q` in the page content;
 *  - `mode-before-text`: `q 3 Tr` and then pdf-lib's `drawText` (its own
 *    `BT … ET`) in the page content — the first wave-3 fixture, verbatim;
 *  - `ocrmypdf`: a Form XObject named `/OCR-…` holding `BT 3 Tr … ET`,
 *    drawn from the page content by `q /OCR-… Do Q`, as OCRmyPDF 14 grafts.
 */
export async function withStaleOcrLayer(
  scan: Uint8Array,
  shape: RedoOcrLayerShape,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(scan);
  const page = doc.getPage(0);
  const font = await embedDrawingFont(doc, [STALE_OCR_TEXT]);
  const textObject = (fontKey: PDFName) => [
    beginText(),
    setFontAndSize(fontKey, STALE_AT.size),
    setTextRenderingMode(TextRenderingMode.Invisible),
    moveText(STALE_AT.x, STALE_AT.y),
    showText(font.encodeText(STALE_OCR_TEXT)),
    endText(),
  ];
  switch (shape) {
    case "tesseract": {
      const key = page.node.newFontDictionary(font.name, font.ref);
      page.pushOperators(
        pushGraphicsState(),
        ...textObject(key),
        popGraphicsState(),
      );
      break;
    }
    case "mode-before-text": {
      page.pushOperators(
        pushGraphicsState(),
        setTextRenderingMode(TextRenderingMode.Invisible),
      );
      page.drawText(STALE_OCR_TEXT, { ...STALE_AT, font });
      page.pushOperators(popGraphicsState());
      break;
    }
    case "ocrmypdf": {
      const form = formXObject(doc, font, page.getSize(), textObject);
      const name = page.node.newXObject("OCR-stale", form);
      page.pushOperators(
        pushGraphicsState(),
        drawObject(name),
        popGraphicsState(),
      );
      break;
    }
  }
  return doc.save({ useObjectStreams: false });
}

function formXObject(
  doc: PDFDocument,
  font: PDFFont,
  size: { width: number; height: number },
  textObject: (fontKey: PDFName) => { toString(): string }[],
): PDFRef {
  const ops = textObject(PDFName.of("F1"))
    .map((op) => op.toString())
    .join("\n");
  const stream = doc.context.stream(ops, {
    Type: "XObject",
    Subtype: "Form",
    FormType: 1,
    BBox: [0, 0, size.width, size.height],
    Resources: { Font: { F1: font.ref } },
  });
  return doc.context.register(stream);
}

/* ------------------------------------------------------------------ *
 *  The instrument: which stale-layer shapes a PDF's page 1 carries
 * ------------------------------------------------------------------ */

function streamText(doc: PDFDocument, obj: PDFObject | undefined): string {
  const resolved = obj instanceof PDFRef ? doc.context.lookup(obj) : obj;
  if (resolved instanceof PDFArray)
    return resolved
      .asArray()
      .map((o) => streamText(doc, o))
      .join("\n");
  if (resolved instanceof PDFRawStream)
    return new TextDecoder("latin1").decode(
      decodePDFRawStream(resolved).decode(),
    );
  return "";
}

/** Content-stream tokens, minus strings (hex or literal), which hold no operator. */
function operators(content: string): string[] {
  return content
    .replace(/<[0-9A-Fa-f\s]*>/g, " ")
    .replace(/\((?:\\.|[^\\)])*\)/g, " ")
    .split(/[\s[\]]+/)
    .filter(Boolean);
}

/** `3 Tr` inside a `BT … ET` object, and `3 Tr` set before a later `BT`. */
function invisibleText(content: string): { inside: boolean; before: boolean } {
  const tokens = operators(content);
  let inText = false;
  let pendingMode3 = false;
  let inside = false;
  let before = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t === "BT") {
      inText = true;
      if (pendingMode3) before = true;
    } else if (t === "ET") inText = false;
    else if (t === "Tr") {
      const mode3 = tokens[i - 1] === "3";
      if (inText && mode3) inside = true;
      else if (!inText) pendingMode3 = mode3;
    } else if (t === "Q") pendingMode3 = false;
  }
  return { inside, before };
}

/**
 * The stale-layer shapes page 1 of `pdf` carries, each named as in
 * {@link REDO_OCR_LAYER_OUTCOMES}. A scan alone carries none. Read from the
 * decoded content streams, so a builder that wrote something other than it
 * claims is seen.
 */
export async function staleLayerShapes(
  pdf: Uint8Array,
): Promise<RedoOcrLayerShape[]> {
  const doc = await PDFDocument.load(pdf);
  const page = doc.getPage(0);
  const shapes = new Set<RedoOcrLayerShape>();
  const own = invisibleText(
    streamText(doc, page.node.get(PDFName.of("Contents"))),
  );
  if (own.inside) shapes.add("tesseract");
  if (own.before) shapes.add("mode-before-text");
  const xobjects = page.node.Resources()?.lookup(PDFName.of("XObject"));
  if (xobjects instanceof PDFDict)
    for (const [, ref] of xobjects.entries()) {
      const form = doc.context.lookup(ref);
      if (!(form instanceof PDFRawStream)) continue;
      if (form.dict.get(PDFName.of("Subtype")) !== PDFName.of("Form")) continue;
      if (invisibleText(streamText(doc, form)).inside) shapes.add("ocrmypdf");
    }
  return REDO_OCR_LAYER_SHAPES.filter((s) => shapes.has(s));
}

/* ------------------------------------------------------------------ *
 *  The verdict, on a reader's text
 * ------------------------------------------------------------------ */

export interface ProofVerdict {
  ok: boolean;
  detail: string;
}

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/**
 * The text of a redo job's output, for a scan of `line` that carried
 * {@link STALE_OCR_TEXT}. `replaced`: every scan word, no stale word.
 * `kept` (redo ON, a layer OCRmyPDF does not detect): every scan word AND
 * every stale word. `skipped` (redo OFF): every stale word, and not every
 * scan word — the page was copied through unread.
 */
export function redoTextVerdict(
  text: string,
  line: string,
  want: "replaced" | "kept" | "skipped",
): ProofVerdict {
  const have = new Set(words(text));
  const lineWords = words(line);
  const staleWords = words(STALE_OCR_TEXT);
  const lineFound = lineWords.filter((w) => have.has(w)).length;
  const staleFound = staleWords.filter((w) => have.has(w)).length;
  const allLine = lineFound === lineWords.length;
  const allStale = staleFound === staleWords.length;
  const ok =
    want === "replaced"
      ? allLine && staleFound === 0
      : want === "kept"
        ? allLine && allStale
        : allStale && !allLine;
  return {
    ok,
    detail: `${lineFound} of ${lineWords.length} scan words, ${staleFound} of ${staleWords.length} stale words; want ${
      want === "replaced"
        ? "every scan word, no stale one"
        : want === "kept"
          ? "every scan word and every stale one"
          : "every stale word, the scan unread"
    }`,
  };
}

/* ------------------------------------------------------------------ *
 *  The run
 * ------------------------------------------------------------------ */

export interface OcrRedoProofDeps {
  /** The registry's OCR processor (what `ocr-pdf` and OCR-first jobs reach). */
  ocr: Processor;
  /** A one-page scan (pixels only) of {@link OcrRedoProofDeps.line}. */
  scan: Uint8Array;
  /** The words printed on the scan. */
  line: string;
  /** poppler's text of a PDF; null when pdftotext is absent. */
  pdfText: ((pdf: Uint8Array) => Promise<string>) | null;
  log?: (line: string) => void;
}

const PDF = "application/pdf";

/**
 * The language the real-layer row first reads the English scan in, so its
 * old words are Cyrillic and cannot be confused with the new English ones.
 */
export const REAL_LAYER_LANGUAGE = "rus";

/** The Cyrillic words of `text`, lower-cased (the real layer's old words). */
export const cyrillicWords = (text: string) =>
  text.toLowerCase().match(/\p{Script=Cyrillic}+/gu) ?? [];

function job(bytes: Uint8Array, redoOcr: boolean, languages = ["eng"]) {
  return {
    tool: "ocr-pdf",
    options: {
      languages,
      outputMode: "searchable-pdf",
      redoOcr,
    } as Record<string, unknown>,
    inputs: [
      { fileId: "proof", filename: "stale.pdf", contentType: PDF, bytes },
    ],
  };
}

function outputPdf(result: ProcessorResult): Uint8Array | null {
  if (!result.ok) return null;
  return result.artifacts.find((a) => a.contentType === PDF)?.bytes ?? null;
}

export async function runOcrRedoProof(
  deps: OcrRedoProofDeps,
): Promise<0 | 1 | 2> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const pdfText = deps.pdfText;
  if (!deps.ocr.capability().ready || !pdfText) {
    log(
      `MISSING ${!deps.ocr.capability().ready ? "a ready OCR engine" : "pdftotext"}: the redo proof cannot run in this image.`,
    );
    return 2;
  }
  let failed = 0;
  let checks = 0;
  const check = (ok: boolean, name: string, detail: string) => {
    checks += 1;
    log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
    if (!ok) failed += 1;
  };
  const run = async (
    name: string,
    bytes: Uint8Array,
    redoOcr: boolean,
    languages?: string[],
  ) => {
    const result = await deps.ocr.process(job(bytes, redoOcr, languages));
    const pdf = outputPdf(result);
    if (!pdf)
      check(
        false,
        name,
        result.ok
          ? "no PDF artifact"
          : `${result.error.code}: ${result.error.message}`,
      );
    return pdf;
  };

  // The scan alone: no text, no layer — or the fixtures inherit one.
  const bare = await pdfText(deps.scan);
  const bareShapes = await staleLayerShapes(deps.scan);
  check(
    words(bare).length === 0 && bareShapes.length === 0,
    "instrument: the scan alone has no text and no layer",
    `${words(bare).length} word(s), shapes [${bareShapes.join(", ")}]`,
  );

  const fixtures = new Map<RedoOcrLayerShape, Uint8Array>();
  for (const shape of REDO_OCR_LAYER_SHAPES) {
    const fixture = await withStaleOcrLayer(deps.scan, shape);
    fixtures.set(shape, fixture);
    const read = await staleLayerShapes(fixture);
    const text = redoTextVerdict(await pdfText(fixture), deps.line, "skipped");
    const noScan = words(await pdfText(fixture)).every(
      (w) => !words(deps.line).includes(w),
    );
    check(
      read.length === 1 && read[0] === shape && text.ok && noScan,
      `instrument: the ${shape} fixture reads as built`,
      `shapes [${read.join(", ")}]; ${text.detail}`,
    );
  }

  for (const shape of REDO_OCR_LAYER_SHAPES) {
    const want = REDO_OCR_LAYER_OUTCOMES[shape];
    const out = await run(
      `redo on, ${shape} layer`,
      fixtures.get(shape)!,
      true,
    );
    if (!out) continue;
    const v = redoTextVerdict(await pdfText(out), deps.line, want);
    check(v.ok, `redo on, ${shape} layer is ${want}`, v.detail);
  }

  const replaced = REDO_OCR_LAYER_SHAPES.find(
    (s) => REDO_OCR_LAYER_OUTCOMES[s] === "replaced",
  );
  if (replaced) {
    const out = await run(
      `redo off, ${replaced} layer`,
      fixtures.get(replaced)!,
      false,
    );
    if (out) {
      const v = redoTextVerdict(await pdfText(out), deps.line, "skipped");
      check(
        v.ok,
        `negative control: redo off keeps the ${replaced} layer`,
        v.detail,
      );
    }
  } else check(false, "negative control", "the table names no replaced shape");

  // A REAL OCRmyPDF layer, not a stand-in: the `ocrmypdf` row is what a
  // reader gets from our own OCR PDF, and the hand-built form above only
  // models it. Added 2026-11-08 after review: an engine or graft change that
  // made OCRmyPDF strip or re-graft its OWN layer would leave the stand-in
  // "kept" while real layers came back "replaced", and the copy false. Read
  // in Russian first, so the old layer's words (Cyrillic) differ from the
  // new ones (English): poppler hides an identical duplicate layer, so an
  // English-over-English run cannot tell kept from replaced.
  const realWant = REDO_OCR_LAYER_OUTCOMES.ocrmypdf;
  const real = await run(
    "a real OCRmyPDF layer, read in Russian",
    deps.scan,
    false,
    [REAL_LAYER_LANGUAGE],
  );
  if (real) {
    const realText = await pdfText(real);
    const realShapes = await staleLayerShapes(real);
    const oldWords = cyrillicWords(realText);
    const scanRead = redoTextVerdict(realText, deps.line, "replaced");
    check(
      realShapes.length === 1 &&
        realShapes[0] === "ocrmypdf" &&
        oldWords.length > 0 &&
        !scanRead.ok,
      "instrument: a real OCRmyPDF layer reads as the ocrmypdf shape, in Cyrillic",
      `shapes [${realShapes.join(", ")}]; ${oldWords.length} Cyrillic word(s); ${scanRead.detail.split(";")[0]}`,
    );
    const out = await run("redo on, real OCRmyPDF layer", real, true, ["eng"]);
    if (out) {
      const text = await pdfText(out);
      const have = new Set(cyrillicWords(text));
      const oldFound = oldWords.filter((w) => have.has(w)).length;
      const read = new Set(words(text));
      const lineWords = words(deps.line);
      const lineFound = lineWords.filter((w) => read.has(w)).length;
      const ok =
        lineFound === lineWords.length &&
        (realWant === "kept" ? oldFound === oldWords.length : oldFound === 0);
      check(
        ok,
        `redo on, a real OCRmyPDF layer is ${realWant}`,
        `${lineFound} of ${lineWords.length} scan words, ${oldFound} of ${oldWords.length} earlier Cyrillic words; want every scan word and ${
          realWant === "kept" ? "every earlier word" : "no earlier word"
        }`,
      );
    }
  }

  // 1 bare + N fixtures + N redo + 1 control + 2 real-layer: a short run proved less.
  const expected = 4 + 2 * REDO_OCR_LAYER_SHAPES.length;
  if (checks !== expected) {
    log(`FAIL the proof ran ${checks} check(s), expected ${expected}`);
    failed += 1;
  }
  log(
    failed === 0
      ? `REDO PROOF: ${checks} checks passed`
      : `REDO PROOF: ${failed} FAILED`,
  );
  return failed === 0 ? 0 : 1;
}
