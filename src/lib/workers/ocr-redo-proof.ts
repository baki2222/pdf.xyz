/**
 * `pnpm worker:ocr-redo-proof` — what “Redo existing OCR” takes away, asked
 * of the BUILT worker image's own engine and judged by the text a reader
 * receives (poppler), not by the argv.
 *
 * HISTORY. On 2026-11-08 the wave-3 production proof of PDF to Word's Redo
 * option failed: the DOCX held every word of the scan AND every word of a
 * stale invisible layer. The argv was right (`--redo-ocr` reached
 * OCRmyPDF); OCRmyPDF 14.0.1 simply removes one of the shapes such a layer
 * is stored in and keeps two, including the one it writes itself
 * ({@link ENGINE_ALONE_OUTCOMES}). #290 made the copy say so. Since
 * 2026-11-08 (later) the runner takes every invisible text layer out BEFORE
 * OCRmyPDF reads the PDF (`./strip-invisible-text`), so every row of
 * {@link REDO_OCR_LAYER_OUTCOMES} is "replaced" and the copy
 * ({@link REDO_OCR_SCOPE}) says that. This proof keeps both tables honest,
 * because a table of engine behaviour has no relationship any unit test can
 * check.
 *
 * For each shape in the table, a scan of a known line carries a stale layer
 * of {@link STALE_OCR_TEXT} in that shape, and:
 *
 *   1. INSTRUMENT — the fixture's own text is every stale word and no scan
 *      word, and {@link staleLayerShapes} reads back exactly the shape it
 *      was built as. Otherwise nothing below means anything.
 *   2. REDO ON — through the registry's OCR processor (the instance OCR PDF
 *      and every OCR-first conversion reach) with `redoOcr: true`: every
 *      scan word is read, and the stale words are gone (`replaced`) or all
 *      still there (`kept`), exactly as {@link REDO_OCR_LAYER_OUTCOMES} says.
 *   3. THE ENGINE ALONE — the same, through an OCR processor whose runner
 *      skips the pre-pass: the outcome must be {@link ENGINE_ALONE_OUTCOMES}
 *      (two shapes KEPT). This is the defect's shape as a negative control:
 *      it shows the fixtures exercise exactly what OCRmyPDF misses, so step
 *      2's "replaced" is the pre-pass's doing. If an OCRmyPDF upgrade starts
 *      removing a shape itself, this goes red and the table is re-measured.
 *   4. REDO OFF — the first shape with redo OFF (`--skip-text`): every stale
 *      word kept and the scan unread. Without it, a fixture the engine
 *      ignores outright would pass step 2 for the wrong reason.
 *   5. TYPED TEXT — a scan with a visible typed line AND a stale layer in
 *      every shape: the fixture reads as built, and with redo on every
 *      typed word survives, every scan word is read, and no stale word is
 *      left. The copy promises typed text is kept; this is that promise,
 *      in the image.
 *   6. A REAL OCRmyPDF LAYER (a real double OCR) — the scan read by the
 *      processor in {@link REAL_LAYER_LANGUAGE} (Cyrillic words, read back
 *      as the `ocrmypdf` shape), then redone in English, both with the
 *      product (want: the `ocrmypdf` row) and with the engine alone (want:
 *      its row). Steps 1–3 use a hand-built stand-in; this is the layer a
 *      reader of our own OCR PDF actually has.
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

/**
 * What OCRmyPDF 14.0.1's `--redo-ocr` does ON ITS OWN to each shape — no
 * pre-pass. MEASURED 2026-11-08 in a throwaway container of the live worker
 * image, then pdftotext of the output (#290; until the pre-pass landed this
 * WAS {@link REDO_OCR_LAYER_OUTCOMES}). `strip_invisible_text` in OCRmyPDF's
 * `_graft.py` walks the PAGE content stream only, resets the mode to 0 at
 * every `BT`, and drops a text object only if a `3 Tr` appears inside it.
 * Step 3 of the proof checks every row, so the reason the pre-pass exists
 * is re-measured on every image.
 */
export const ENGINE_ALONE_OUTCOMES = {
  tesseract: "replaced",
  ocrmypdf: "kept",
  "mode-before-text": "kept",
} as const satisfies Record<RedoOcrLayerShape, "replaced" | "kept">;

/** A visible line typed onto the page, which Redo must keep. */
export const TYPED_LINE = "Typed heading zephyr 5521 approved";
const TYPED_AT = { x: 40, y: 780, size: 18 } as const;

/** `pdf` with {@link TYPED_LINE} drawn as visible text on page 1. */
export async function withTypedLine(pdf: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf);
  const font = await embedDrawingFont(doc, [TYPED_LINE]);
  doc.getPage(0).drawText(TYPED_LINE, { ...TYPED_AT, font });
  return doc.save({ useObjectStreams: false });
}

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
  /**
   * The same processor with the runner's pre-pass turned off (its
   * `stripInvisibleText` seam passing the PDF through): OCRmyPDF alone.
   */
  engineAlone: Processor;
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
  const ready =
    deps.ocr.capability().ready && deps.engineAlone.capability().ready;
  if (!ready || !pdfText) {
    log(
      `MISSING ${!ready ? "a ready OCR engine" : "pdftotext"}: the redo proof cannot run in this image.`,
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
    processor: Processor = deps.ocr,
  ) => {
    const result = await processor.process(job(bytes, redoOcr, languages));
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

  // Step 2 (the product) and step 3 (the engine alone), shape by shape.
  const tables = [
    ["redo on", REDO_OCR_LAYER_OUTCOMES, deps.ocr],
    ["engine alone", ENGINE_ALONE_OUTCOMES, deps.engineAlone],
  ] as const;
  for (const [who, table, processor] of tables) {
    for (const shape of REDO_OCR_LAYER_SHAPES) {
      const want = table[shape];
      const out = await run(
        `${who}, ${shape} layer`,
        fixtures.get(shape)!,
        true,
        undefined,
        processor,
      );
      if (!out) continue;
      const v = redoTextVerdict(await pdfText(out), deps.line, want);
      check(v.ok, `${who}, ${shape} layer is ${want}`, v.detail);
    }
  }

  // Step 4: redo off copies the page through, stale layer and all.
  const first = REDO_OCR_LAYER_SHAPES[0]!;
  const off = await run(
    `redo off, ${first} layer`,
    fixtures.get(first)!,
    false,
  );
  if (off) {
    const v = redoTextVerdict(await pdfText(off), deps.line, "skipped");
    check(
      v.ok,
      `negative control: redo off keeps the ${first} layer`,
      v.detail,
    );
  }

  // Step 5: typed text beside a stale layer in every shape.
  let typed = await withTypedLine(deps.scan);
  for (const shape of REDO_OCR_LAYER_SHAPES)
    typed = await withStaleOcrLayer(typed, shape);
  const typedIn = typedVerdict(await pdfText(typed), deps.line, "fixture");
  const typedShapes = await staleLayerShapes(typed);
  check(
    typedIn.ok && typedShapes.length === REDO_OCR_LAYER_SHAPES.length,
    "instrument: the typed fixture has its typed line and every stale shape",
    `shapes [${typedShapes.join(", ")}]; ${typedIn.detail}`,
  );
  const typedOut = await run("redo on, typed text and old layers", typed, true);
  if (typedOut) {
    const v = typedVerdict(await pdfText(typedOut), deps.line, "redone");
    check(
      v.ok,
      "redo on keeps typed text and replaces every old layer",
      v.detail,
    );
  }

  // Step 6: a REAL OCRmyPDF layer — a real double OCR. Read in Russian
  // first, so the old layer's words (Cyrillic) differ from the new ones
  // (English): poppler hides an identical duplicate layer, so an
  // English-over-English run cannot tell kept from replaced.
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
    const realRuns = [
      ["redo on", REDO_OCR_LAYER_OUTCOMES.ocrmypdf, deps.ocr],
      ["engine alone", ENGINE_ALONE_OUTCOMES.ocrmypdf, deps.engineAlone],
    ] as const;
    for (const [who, want, processor] of realRuns) {
      const out = await run(
        `${who}, real OCRmyPDF layer`,
        real,
        true,
        ["eng"],
        processor,
      );
      if (!out) continue;
      const text = await pdfText(out);
      const have = new Set(cyrillicWords(text));
      const oldFound = oldWords.filter((w) => have.has(w)).length;
      const read = new Set(words(text));
      const lineWords = words(deps.line);
      const lineFound = lineWords.filter((w) => read.has(w)).length;
      const ok =
        lineFound === lineWords.length &&
        (want === "kept" ? oldFound === oldWords.length : oldFound === 0);
      check(
        ok,
        `${who}, a real OCRmyPDF layer is ${want}`,
        `${lineFound} of ${lineWords.length} scan words, ${oldFound} of ${oldWords.length} earlier Cyrillic words; want every scan word and ${
          want === "kept" ? "every earlier word" : "no earlier word"
        }`,
      );
    }
  }

  const expected = expectedRedoChecks();
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

/**
 * 1 bare + N fixtures + N redo + N engine-alone + 1 redo-off + 2 typed + 3
 * real-layer: a short run proved less.
 */
export function expectedRedoChecks(): number {
  return 7 + 3 * REDO_OCR_LAYER_SHAPES.length;
}

/**
 * The typed-text check's verdict. `fixture`: every typed word and every
 * stale word, and the scan unread. `redone`: every typed word, every scan
 * word, no stale word.
 */
export function typedVerdict(
  text: string,
  line: string,
  want: "fixture" | "redone",
): ProofVerdict {
  const have = new Set(words(text));
  const found = (s: string) => words(s).filter((w) => have.has(w)).length;
  const all = (s: string) => found(s) === words(s).length;
  const ok =
    want === "fixture"
      ? all(TYPED_LINE) && all(STALE_OCR_TEXT) && !all(line)
      : all(TYPED_LINE) && all(line) && found(STALE_OCR_TEXT) === 0;
  return {
    ok,
    detail: `${found(TYPED_LINE)} of ${words(TYPED_LINE).length} typed words, ${found(line)} of ${words(line).length} scan words, ${found(STALE_OCR_TEXT)} of ${words(STALE_OCR_TEXT).length} stale words; want ${
      want === "fixture"
        ? "every typed and stale word, the scan unread"
        : "every typed and scan word, no stale one"
    }`,
  };
}
