// @vitest-environment node
// @native-canvas
/**
 * The in-image redo proof's instrument, fixtures and verdicts, settled here
 * where OCRmyPDF is not installed — only the engine is played. The image run
 * (`pnpm worker:ocr-redo-proof`) is the only place OCRmyPDF meets the
 * fixtures; on 2026-11-08 it printed 8 of 8 PASS on the live worker image,
 * and went red on a table row flipped (`tesseract: "kept"`) and on the
 * `--redo-ocr` flag dropped from the argv.
 *
 *  - each fixture carries exactly the layer shape it is named for, read
 *    back from its decoded content streams, and its stale words are text a
 *    reader gets (pdf.js) — so "kept" can never pass over a layer that was
 *    never there;
 *  - every verdict fails in the direction it exists to catch;
 *  - the run fails on each engine behaviour that would make the copy false:
 *    an engine that ignores the option, one that strips every hidden layer
 *    (a future OCRmyPDF: the "kept" sentences go stale), and one that
 *    strips none.
 */
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { REDO_OCR_LAYER_OUTCOMES } from "@/lib/jobs/ocr";
import { readAsViewer } from "@/tests/pdfjs-viewer";
import type { Processor } from "./processor/types";
import {
  REDO_OCR_LAYER_SHAPES,
  STALE_OCR_TEXT,
  redoTextVerdict,
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
  it("health check: the table names three shapes, and the proof walks every one", () => {
    expect(REDO_OCR_LAYER_SHAPES).toEqual(Object.keys(REDO_OCR_LAYER_OUTCOMES));
    expect(REDO_OCR_LAYER_SHAPES.length).toBe(3);
    // Both outcomes are present, so the run has a replaced row AND a kept one.
    expect(new Set(Object.values(REDO_OCR_LAYER_OUTCOMES))).toEqual(
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

type Fault = "none" | "ignores redo" | "strips every layer" | "strips none";

/**
 * A played OCRmyPDF: under `--redo-ocr` it reads the scan and drops the
 * stale layer only when the page carries the shape OCRmyPDF 14 detects
 * (the measurement in REDO_OCR_LAYER_OUTCOMES); under `--skip-text` it
 * copies a page with text through unread.
 */
function played(fault: Fault) {
  const texts = new Map<Uint8Array, string>();
  const ocr = {
    capability: () => ({ ready: true, detail: "played" }),
    process: async (input: {
      options: Record<string, unknown>;
      inputs: { bytes: Uint8Array }[];
    }) => {
      const shapes = await staleLayerShapes(input.inputs[0]!.bytes);
      const redo = input.options.redoOcr === true && fault !== "ignores redo";
      const strips =
        fault === "strips every layer"
          ? true
          : fault === "strips none"
            ? false
            : shapes.every((s) => REDO_OCR_LAYER_OUTCOMES[s] === "replaced");
      const text = !redo
        ? STALE_OCR_TEXT
        : strips
          ? LINE
          : `${LINE} ${STALE_OCR_TEXT}`;
      const bytes = new TextEncoder().encode(`%PDF played ${texts.size}`);
      texts.set(bytes, text);
      return {
        ok: true,
        artifacts: [
          { filename: "o.pdf", contentType: "application/pdf", bytes },
        ],
      };
    },
  } as unknown as Processor;
  const pdfText = async (pdf: Uint8Array) =>
    texts.get(pdf) ?? (await viewerText(pdf));
  return { ocr, pdfText };
}

async function runWith(fault: Fault) {
  const lines: string[] = [];
  const { ocr, pdfText } = played(fault);
  const code = await runOcrRedoProof({
    ocr,
    scan: await blankScan(),
    line: LINE,
    pdfText,
    log: (l) => lines.push(l),
  });
  return { code, lines, failed: lines.filter((l) => l.startsWith("FAIL")) };
}

describe("runOcrRedoProof", () => {
  it("passes on the engine as measured, every check run", async () => {
    const { code, lines, failed } = await runWith("none");
    expect(failed).toEqual([]);
    expect(code).toBe(0);
    expect(lines.filter((l) => l.startsWith("PASS"))).toHaveLength(8);
  });

  it("fails when the option never reaches the engine", async () => {
    const { code, failed } = await runWith("ignores redo");
    expect(code).toBe(1);
    expect(
      failed.some((l) => /redo on, tesseract layer is replaced/.test(l)),
    ).toBe(true);
  });

  it("fails when the engine strips every hidden layer: the 'kept' copy would be stale", async () => {
    const { code, failed } = await runWith("strips every layer");
    expect(code).toBe(1);
    expect(
      failed.map((l) => /redo on, (\S+) layer is kept/.exec(l)?.[1]),
    ).toEqual(["ocrmypdf", "mode-before-text"]);
  });

  it("fails when the engine strips no layer", async () => {
    const { code, failed } = await runWith("strips none");
    expect(code).toBe(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatch(/redo on, tesseract layer is replaced/);
  });

  it("cannot conclude without pdftotext or a ready engine", async () => {
    const { ocr } = played("none");
    expect(
      await runOcrRedoProof({
        ocr,
        scan: await blankScan(),
        line: LINE,
        pdfText: null,
        log: () => {},
      }),
    ).toBe(2);
  });
});
