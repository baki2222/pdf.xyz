// @vitest-environment node
// @native-canvas
/**
 * The in-image redo proof's instrument, fixtures and verdicts, settled here
 * where OCRmyPDF is not installed — only the engine is played. The image run
 * (`pnpm worker:ocr-redo-proof`) is the only place OCRmyPDF meets the
 * fixtures; on 2026-11-08 it printed 8 of 8 PASS on the live worker image,
 * and went red on a table row flipped (`tesseract: "kept"`) and on the
 * `--redo-ocr` flag dropped from the argv. With the real-OCRmyPDF-layer row
 * added after review it printed 10 of 10, and went red on `ocrmypdf:
 * "replaced"` (both that row and the stand-in's) and on the real row's redo
 * fed the bare scan instead of its layer (that row alone, 0 of 6 earlier
 * Cyrillic words).
 *
 * With the runner's pre-pass (`./strip-invisible-text`, later on
 * 2026-11-08) the proof grew the engine-alone rows and the typed page: the
 * live image (sha256:66f57576…) printed 16 of 16 PASS, and the same tree
 * with the pre-pass call passed through (one line of `ocr-native.ts`, `diff
 * -r` showing only it) printed 4 FAILED — exactly the rows the "no
 * pre-pass" fault below names, in the same order.
 *
 *  - each fixture carries exactly the layer shape it is named for, read
 *    back from its decoded content streams, and its stale words are text a
 *    reader gets (pdf.js) — so "kept" can never pass over a layer that was
 *    never there;
 *  - every verdict fails in the direction it exists to catch;
 *  - the run fails on each behaviour that would make the copy or a table
 *    false: the pre-pass missing, or taking typed text with it; an engine
 *    that ignores the option; one that strips every hidden layer by itself
 *    (a future OCRmyPDF: ENGINE_ALONE_OUTCOMES goes stale); and one that
 *    strips none.
 */
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { REDO_OCR_LAYER_OUTCOMES } from "@/lib/jobs/ocr";
import { readAsViewer } from "@/tests/pdfjs-viewer";
import type { Processor } from "./processor/types";
import {
  ENGINE_ALONE_OUTCOMES,
  REDO_OCR_LAYER_SHAPES,
  STALE_OCR_TEXT,
  TYPED_LINE,
  expectedRedoChecks,
  redoTextVerdict,
  typedVerdict,
  runOcrRedoProof,
  staleLayerShapes,
  withStaleOcrLayer,
} from "./ocr-redo-proof";

const LINE = "Scanned invoice number 4718 paid in full";

/** A stand-in for the scan: one empty A4 page (structure, not pixels). */
async function blankScan(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  return doc.save();
}

const viewerText = async (pdf: Uint8Array) =>
  (await readAsViewer(pdf)).flatMap((p) => p.runs.map((r) => r.str)).join(" ");

describe("the stale-layer fixtures", () => {
  it("health check: both tables name the same three shapes, and the proof walks every one", () => {
    expect(REDO_OCR_LAYER_SHAPES).toEqual(Object.keys(REDO_OCR_LAYER_OUTCOMES));
    expect(Object.keys(ENGINE_ALONE_OUTCOMES)).toEqual(REDO_OCR_LAYER_SHAPES);
    expect(REDO_OCR_LAYER_SHAPES.length).toBe(3);
    // CHANGED 2026-11-08: this asked REDO_OCR_LAYER_OUTCOMES for both
    // outcomes. With the pre-pass every product row is "replaced"; the
    // engine-alone table carries both, so the run still has a replaced row
    // AND a kept one to tell apart.
    expect(new Set(Object.values(REDO_OCR_LAYER_OUTCOMES))).toEqual(
      new Set(["replaced"]),
    );
    expect(new Set(Object.values(ENGINE_ALONE_OUTCOMES))).toEqual(
      new Set(["replaced", "kept"]),
    );
  });

  it("control: a scan with no layer reads as no shape", async () => {
    expect(await staleLayerShapes(await blankScan())).toEqual([]);
  });

  it.each(REDO_OCR_LAYER_SHAPES)(
    "the %s fixture carries that shape and no other, and a reader gets its words",
    async (shape) => {
      const pdf = await withStaleOcrLayer(await blankScan(), shape);
      expect(await staleLayerShapes(pdf)).toEqual([shape]);
      expect(await viewerText(pdf)).toContain(STALE_OCR_TEXT);
    },
  );
});

describe("redoTextVerdict", () => {
  const scan = LINE;
  const both = `${LINE} ${STALE_OCR_TEXT}`;
  it.each([
    ["replaced", scan, true],
    ["replaced", both, false],
    ["replaced", "", false],
    ["kept", both, true],
    ["kept", scan, false],
    ["kept", STALE_OCR_TEXT, false],
    ["skipped", STALE_OCR_TEXT, true],
    ["skipped", both, false],
    ["skipped", "", false],
  ] as const)("want %s over %j → %s", (want, text, ok) => {
    expect(redoTextVerdict(text, LINE, want).ok).toBe(ok);
  });
});

type Fault =
  | "none"
  | "ignores redo"
  | "no pre-pass"
  | "pre-pass drops typed text"
  | "engine strips every layer"
  | "engine strips none";

/** What a played Russian read of the English scan says (as measured). */
const CYRILLIC = "шуосе Зсаппе питрег";

/**
 * A played OCRmyPDF, as two processors. `engineAlone` is OCRmyPDF 14 as
 * measured: under `--redo-ocr` it reads the scan and drops the stale layer
 * only when every shape on the page is one ENGINE_ALONE_OUTCOMES calls
 * "replaced"; under `--skip-text` it copies a page with text through unread,
 * and grafts its OWN layer (the `ocrmypdf` shape) on a page without one —
 * Cyrillic when asked for `rus`. `ocr` is the product: the same engine
 * behind the runner's pre-pass, so under redo every invisible layer is gone
 * before the engine sees it, and typed text is kept.
 *
 * Faults: "no pre-pass" is the mutant the image run also went red on (the
 * product behaves as the engine alone); "pre-pass drops typed text" breaks
 * the copy's other promise; "engine strips every layer" is a future
 * OCRmyPDF that fixed its graft (ENGINE_ALONE_OUTCOMES would be stale);
 * "engine strips none" one that stopped stripping even Tesseract's shape.
 */
function played(fault: Fault) {
  const texts = new Map<Uint8Array, string>();
  const out = (bytes: Uint8Array, text: string) => {
    texts.set(bytes, text);
    return {
      ok: true,
      artifacts: [{ filename: "o.pdf", contentType: "application/pdf", bytes }],
    };
  };
  const processor = (prePass: boolean) =>
    ({
      capability: () => ({ ready: true, detail: "played" }),
      process: async (input: {
        options: Record<string, unknown>;
        inputs: { bytes: Uint8Array }[];
      }) => {
        const source = input.inputs[0]!.bytes;
        const shapes = await staleLayerShapes(source);
        const languages = input.options.languages as string[];
        const redo = input.options.redoOcr === true && fault !== "ignores redo";
        if (!redo && shapes.length === 0) {
          const bytes = await withStaleOcrLayer(source, "ocrmypdf");
          return out(bytes, languages.includes("rus") ? CYRILLIC : LINE);
        }
        const prior = texts.get(source) ?? (await viewerText(source));
        const bytes = new TextEncoder().encode(`%PDF played ${texts.size}`);
        if (!redo) return out(bytes, prior);
        const typed = prior.includes(TYPED_LINE) ? TYPED_LINE : "";
        const stale = prior.replace(TYPED_LINE, " ").trim();
        const stripped =
          prePass && fault !== "no pre-pass"
            ? true
            : fault === "engine strips every layer"
              ? true
              : fault === "engine strips none"
                ? false
                : shapes.every((s) => ENGINE_ALONE_OUTCOMES[s] === "replaced");
        const keepTyped = !(prePass && fault === "pre-pass drops typed text");
        return out(
          bytes,
          [LINE, keepTyped ? typed : "", stripped ? "" : stale].join(" "),
        );
      },
    }) as unknown as Processor;
  const pdfText = async (pdf: Uint8Array) =>
    texts.get(pdf) ?? (await viewerText(pdf));
  return { ocr: processor(true), engineAlone: processor(false), pdfText };
}

async function runWith(fault: Fault) {
  const lines: string[] = [];
  const { ocr, engineAlone, pdfText } = played(fault);
  const code = await runOcrRedoProof({
    ocr,
    engineAlone,
    scan: await blankScan(),
    line: LINE,
    pdfText,
    log: (l) => lines.push(l),
  });
  return { code, lines, failed: lines.filter((l) => l.startsWith("FAIL")) };
}

describe("runOcrRedoProof", () => {
  it("passes on the engine as measured behind the pre-pass, every check run", async () => {
    const { code, lines, failed } = await runWith("none");
    expect(failed).toEqual([]);
    expect(code).toBe(0);
    expect(expectedRedoChecks()).toBe(16);
    expect(lines.filter((l) => l.startsWith("PASS"))).toHaveLength(16);
    expect(lines).toContain(
      "PASS redo on, a real OCRmyPDF layer is replaced: 7 of 7 scan words, 0 of 3 earlier Cyrillic words; want every scan word and no earlier word",
    );
    expect(lines).toContain(
      "PASS engine alone, a real OCRmyPDF layer is kept: 7 of 7 scan words, 3 of 3 earlier Cyrillic words; want every scan word and every earlier word",
    );
    expect(lines).toContain(
      "PASS redo on keeps typed text and replaces every old layer: 5 of 5 typed words, 7 of 7 scan words, 0 of 5 stale words; want every typed and scan word, no stale one",
    );
  });

  it("fails without the pre-pass: every shape the engine keeps, and the typed page, go red", async () => {
    const { code, failed } = await runWith("no pre-pass");
    expect(code).toBe(1);
    expect(failed.map((l) => l.split(":")[0])).toEqual([
      "FAIL redo on, ocrmypdf layer is replaced",
      "FAIL redo on, mode-before-text layer is replaced",
      "FAIL redo on keeps typed text and replaces every old layer",
      "FAIL redo on, a real OCRmyPDF layer is replaced",
    ]);
  });

  it("fails when the pre-pass takes typed text with it", async () => {
    const { code, failed } = await runWith("pre-pass drops typed text");
    expect(code).toBe(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatch(
      /^FAIL redo on keeps typed text and replaces every old layer: 0 of 5 typed words/,
    );
  });

  it("fails when the option never reaches the engine", async () => {
    const { code, failed } = await runWith("ignores redo");
    expect(code).toBe(1);
    expect(
      failed.some((l) => /redo on, tesseract layer is replaced/.test(l)),
    ).toBe(true);
  });

  it("fails when OCRmyPDF starts stripping every layer itself: the engine-alone table would be stale", async () => {
    const { code, failed } = await runWith("engine strips every layer");
    expect(code).toBe(1);
    expect(
      failed.map((l) => /engine alone, (.+) layer is kept/.exec(l)?.[1]),
    ).toEqual(["ocrmypdf", "mode-before-text", "a real OCRmyPDF"]);
  });

  it("fails when OCRmyPDF stops stripping even Tesseract's shape", async () => {
    const { code, failed } = await runWith("engine strips none");
    expect(code).toBe(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatch(/engine alone, tesseract layer is replaced/);
  });

  it("cannot conclude without pdftotext or a ready engine", async () => {
    const { ocr, engineAlone } = played("none");
    expect(
      await runOcrRedoProof({
        ocr,
        engineAlone,
        scan: await blankScan(),
        line: LINE,
        pdfText: null,
        log: () => {},
      }),
    ).toBe(2);
    const notReady = {
      ...engineAlone,
      capability: () => ({ ready: false, detail: "absent" }),
    } as Processor;
    expect(
      await runOcrRedoProof({
        ocr,
        engineAlone: notReady,
        scan: await blankScan(),
        line: LINE,
        pdfText: async () => "",
        log: () => {},
      }),
    ).toBe(2);
  });
});

describe("typedVerdict", () => {
  const typed = `${TYPED_LINE} ${LINE}`;
  it.each([
    ["redone", typed, true],
    ["redone", `${typed} ${STALE_OCR_TEXT}`, false],
    ["redone", LINE, false],
    ["fixture", `${TYPED_LINE} ${STALE_OCR_TEXT}`, true],
    ["fixture", `${typed} ${STALE_OCR_TEXT}`, false],
    ["fixture", TYPED_LINE, false],
  ] as const)("want %s over %j → %s", (want, text, ok) => {
    expect(typedVerdict(text, LINE, want).ok).toBe(ok);
  });
});
