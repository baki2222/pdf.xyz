// @vitest-environment node
// @native-canvas
/**
 * The in-image rotate proof's instruments and verdicts, run here on the REAL
 * fixtures through the REAL renderer (pdf.js) — only the engine is played.
 * The image run (`pnpm worker:ocr-rotate-proof`) is the only place OCRmyPDF
 * meets the fixtures; what can be settled without it is settled here:
 *
 *  - the orientation instrument tells upright from upside down from
 *    sideways on the fixtures, reads `/Rotate` the way a viewer paints it,
 *    and refuses a blank page rather than calling it either;
 *  - every verdict fails on the engine behaviour it exists to catch: an
 *    engine that ignores the option, one that turns everything (the
 *    controls), one that turns a sideways page the wrong way, one that
 *    redraws the page instead of setting `/Rotate`, one that turns a page
 *    that already has text, and a blank render.
 *
 * The played engine is a PERFECT orientation check: it tries each `/Rotate`
 * and keeps the one the instrument paints upright. Its faults are injected
 * one at a time, each test naming the check that must go red.
 */
import { PDFDocument, degrees } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { renderPdfPages } from "@/tests/pdf-render";
import { readAsViewer } from "@/tests/pdfjs-viewer";
import { scanOfFirstPage } from "@/tests/word-ocr-proof-fixtures";
import { greyOf } from "./ocr-deskew-proof";
import type { Processor } from "./processor/types";
import {
  COMBINED_SKEW_DEGREES,
  UPRIGHT_SENTINEL,
  measureHeaderSkew,
  orientationOf,
  pageImageBytes,
  pageRotation,
  runOcrRotateProof,
  turnedTextPage,
  type OcrRotateProofDeps,
} from "./ocr-rotate-proof";

/** The script's scan and render, exactly (`scripts/worker-ocr-rotate-proof.ts`). */
const scan = (typed: Uint8Array) => scanOfFirstPage(typed, 2000);
const render = async (pdf: Uint8Array) => {
  const [page] = await renderPdfPages(pdf, 1100);
  if (!page) throw new Error("no page");
  return greyOf(page);
};
const way = async (pdf: Uint8Array) => orientationOf(await render(pdf));

async function withRotate(pdf: Uint8Array, angle: number) {
  const doc = await PDFDocument.load(pdf);
  doc.getPage(0).setRotation(degrees(angle));
  return doc.save();
}

const uprightScan = turnedTextPage(0).then(scan);
const flippedScan = turnedTextPage(180).then(scan);
const sidewaysScan = turnedTextPage(90).then(scan);

describe("the orientation instrument, on the real fixtures through pdf.js", () => {
  it("reads upright, upside down and sideways as drawn", async () => {
    expect(await way(await uprightScan)).toBe("upright");
    expect(await way(await flippedScan)).toBe("upside down");
    expect(await way(await sidewaysScan)).toBe("sideways");
    // The typed page (the text-page case) reads the same way as its scan.
    expect(await way(await turnedTextPage(180))).toBe("upside down");
  }, 60_000);

  it("reads a page as a viewer paints it: /Rotate turns the answer", async () => {
    const flipped = await flippedScan;
    expect(await pageRotation(await withRotate(flipped, 180))).toBe(180);
    expect(await way(await withRotate(flipped, 180))).toBe("upright");
    // A quarter turn the right way paints upright; the wrong way, upside down.
    const sideways = await sidewaysScan;
    const turns = await Promise.all(
      [90, 270].map(async (a) => way(await withRotate(sideways, a))),
    );
    expect([...turns].sort()).toEqual(["upright", "upside down"]);
  }, 60_000);

  it("refuses a blank page, and a page with no bar, rather than answering", () => {
    const blank = {
      width: 400,
      height: 500,
      grey: new Uint8Array(400 * 500).fill(255),
    };
    expect(() => orientationOf(blank)).toThrow(/blank/);
    const grey = new Uint8Array(400 * 500).fill(255);
    // Light speckle everywhere, no row half dark: no bar to read.
    for (let i = 0; i < grey.length; i += 7) grey[i] = 0;
    expect(() => orientationOf({ width: 400, height: 500, grey })).toThrow(
      /no header bar/,
    );
  });

  it("the skew instrument reads the tilt it was drawn at", async () => {
    const tilted = await scan(await turnedTextPage(COMBINED_SKEW_DEGREES));
    expect(
      Math.abs(measureHeaderSkew(await render(tilted)) - COMBINED_SKEW_DEGREES),
    ).toBeLessThan(0.3);
    expect(
      Math.abs(measureHeaderSkew(await render(await uprightScan))),
    ).toBeLessThan(0.15);
  }, 60_000);

  it("pageImageBytes sees a /Rotate change as the same picture, and a rescan as a different one", async () => {
    const flipped = await flippedScan;
    const [before] = await pageImageBytes(flipped);
    const [after] = await pageImageBytes(await withRotate(flipped, 180));
    expect(before!.byteLength).toBeGreaterThan(1000);
    expect(Buffer.from(after!).equals(Buffer.from(before!))).toBe(true);
    const [other] = await pageImageBytes(await uprightScan);
    expect(Buffer.from(other!).equals(Buffer.from(before!))).toBe(false);
  }, 60_000);
});

type Fault =
  | "none"
  | "ignores the option"
  | "turns everything"
  | "turns sideways the wrong way"
  | "redraws instead of rotating"
  | "turns text pages";

const textOf = async (pdf: Uint8Array) =>
  (await readAsViewer(pdf)).flatMap((p) => p.runs.map((r) => r.str)).join(" ");

/** The engine, played: a perfect orientation check, with one fault at a time. */
function deps(
  fault: Fault,
  over: Partial<OcrRotateProofDeps> = {},
): { deps: OcrRotateProofDeps; lines: string[] } {
  const read = new Set<Uint8Array>();
  const lines: string[] = [];
  const bestTurn = async (pdf: Uint8Array): Promise<number> => {
    for (const a of [0, 90, 180, 270])
      if ((await way(await withRotate(pdf, a)).catch(() => "")) === "upright")
        return a;
    return 0;
  };
  const engine = async (
    bytes: Uint8Array,
    options: Record<string, unknown>,
  ): Promise<Uint8Array> => {
    const hasText = (await textOf(bytes)).trim().length > 0;
    if (fault === "turns everything") return withRotate(bytes, 180);
    // --skip-text: a page with text is copied through untouched.
    if (hasText)
      return fault === "turns text pages" && options.rotatePages === true
        ? withRotate(bytes, await bestTurn(bytes))
        : bytes.slice();
    let out: Uint8Array = bytes.slice();
    if (options.rotatePages === true && fault !== "ignores the option") {
      if (options.deskew === true) {
        // A perfect engine turns AND levels: a fresh upright, level page.
        out = (await uprightScan).slice();
      } else if (fault === "redraws instead of rotating") {
        out = (await uprightScan).slice();
      } else {
        let turn = await bestTurn(bytes);
        if (fault === "turns sideways the wrong way" && turn % 180 !== 0)
          turn = (turn + 180) % 360;
        out = await withRotate(bytes, turn);
      }
    }
    // What the played OCR "reads": the sentinel, exactly when the page it
    // recognised is painted upright — as Tesseract would.
    if ((await way(out).catch(() => "")) === "upright") read.add(out);
    return out;
  };
  const ocr = {
    capability: () => ({ ready: true, detail: "played" }),
    process: async (input: {
      options: Record<string, unknown>;
      inputs: { bytes: Uint8Array }[];
    }) => ({
      ok: true,
      artifacts: [
        {
          filename: "turned-ocr.pdf",
          contentType: "application/pdf",
          bytes: await engine(input.inputs[0]!.bytes, input.options),
        },
      ],
    }),
  } as unknown as Processor;
  return {
    lines,
    deps: {
      ocr,
      scan,
      render,
      pdfText: async (pdf) =>
        read.has(pdf)
          ? `${UPRIGHT_SENTINEL} ${await textOf(pdf)}`
          : textOf(pdf),
      log: (line) => lines.push(line),
      ...over,
    },
  };
}

const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));

describe("runOcrRotateProof — each verdict can fail", () => {
  it("PROVEN against a perfect engine, every check passing", async () => {
    const { deps: d, lines } = deps("none");
    expect(await runOcrRotateProof(d)).toBe(0);
    expect(fails(lines)).toEqual([]);
    expect(lines.filter((l) => l.startsWith("PASS"))).toHaveLength(14);
  }, 180_000);

  it("fails every turned case when the engine ignores the option", async () => {
    const { deps: d, lines } = deps("ignores the option");
    expect(await runOcrRotateProof(d)).toBe(1);
    const f = fails(lines);
    expect(f).toHaveLength(4);
    expect(f.join("\n")).toMatch(/the 180° scan comes back upright/);
    expect(f.join("\n")).toMatch(/the 90° scan comes back upright/);
    expect(f.join("\n")).toMatch(/with Redo existing OCR/);
    expect(f.join("\n")).toMatch(/with Straighten crooked pages/);
  }, 180_000);

  it("fails the controls when the engine turns everything", async () => {
    const { deps: d, lines } = deps("turns everything");
    expect(await runOcrRotateProof(d)).toBe(1);
    const f = fails(lines).join("\n");
    expect(f).toMatch(/option off: the 180° scan stays upside down/);
    expect(f).toMatch(/option off: the 90° scan stays sideways/);
    expect(f).toMatch(/false-positive guard/);
    expect(f).toMatch(/already has text is kept as it is/);
  }, 180_000);

  it("fails the 90° case, and only it, when a sideways page is turned the wrong way", async () => {
    const { deps: d, lines } = deps("turns sideways the wrong way");
    expect(await runOcrRotateProof(d)).toBe(1);
    const f = fails(lines);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatch(/the 90° scan comes back upright/);
    expect(f[0]).toMatch(/painted upside down/);
  }, 180_000);

  it("fails when the page is redrawn upright instead of given a /Rotate", async () => {
    const { deps: d, lines } = deps("redraws instead of rotating");
    expect(await runOcrRotateProof(d)).toBe(1);
    const f = fails(lines).join("\n");
    expect(f).toMatch(/the 180° scan comes back upright and read: \/Rotate 0/);
    expect(f).toMatch(/keeps its picture/);
  }, 180_000);

  it("fails, naming the copy to re-decide, when a page with text is turned", async () => {
    const { deps: d, lines } = deps("turns text pages");
    expect(await runOcrRotateProof(d)).toBe(1);
    const f = fails(lines);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatch(/TURNED a text page: re-decide the copy/);
  }, 180_000);

  it("fails, naming the instrument, when the render is blank", async () => {
    const { deps: d, lines } = deps("none", {
      render: async () => ({
        width: 400,
        height: 500,
        grey: new Uint8Array(400 * 500).fill(255),
      }),
    });
    expect(await runOcrRotateProof(d)).toBe(1);
    expect(fails(lines).filter((l) => /blank/.test(l)).length).toBeGreaterThan(
      5,
    );
    // The only check left standing reads image bytes, not pixels.
    const passes = lines.filter((l) => l.startsWith("PASS"));
    expect(passes.every((l) => /keeps its picture/.test(l))).toBe(true);
  }, 180_000);

  it("cannot conclude (2) without pdftotext or a ready engine", async () => {
    expect(await runOcrRotateProof(deps("none", { pdfText: null }).deps)).toBe(
      2,
    );
    const idle = deps("none");
    const ocr = {
      ...idle.deps.ocr,
      capability: () => ({ ready: false, detail: "off" }),
    } as unknown as Processor;
    expect(await runOcrRotateProof({ ...idle.deps, ocr })).toBe(2);
  });
});
