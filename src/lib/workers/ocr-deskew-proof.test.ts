// @vitest-environment node
// @native-canvas
/**
 * The in-image deskew proof's instrument and verdicts, run here on the REAL
 * fixture through the REAL renderer (pdf.js) — only the engine is played.
 * The image run (`pnpm worker:ocr-deskew-proof`) is the only place OCRmyPDF
 * meets the fixture; what can be settled without it is settled here:
 *
 *  - the instrument measures the angle the fixture was drawn at, in both
 *    directions, and about zero for the straight one (a blind instrument
 *    would pass "straight" on anything);
 *  - every verdict fails on the engine behaviour it exists to catch: an
 *    engine that ignores `--deskew`, one that straightens everything (the
 *    negative control), a blank render, and an engine that accepts
 *    `--redo-ocr` with `--deskew`.
 */
import { describe, expect, it } from "vitest";
import { renderPdfPages } from "@/tests/pdf-render";
import { scanOfFirstPage } from "@/tests/word-ocr-proof-fixtures";
import type { Processor } from "./processor/types";
import {
  DESKEW_SENTINEL,
  FIXTURE_SKEW_DEGREES,
  greyOf,
  measureBarSkew,
  runOcrDeskewProof,
  skewedBarsPage,
  type OcrDeskewProofDeps,
} from "./ocr-deskew-proof";

/** The script's scan and render, exactly (`scripts/worker-ocr-deskew-proof.ts`). */
const scan = (typed: Uint8Array) => scanOfFirstPage(typed, 2000);
const render = async (pdf: Uint8Array) => {
  const [page] = await renderPdfPages(pdf, 1100);
  if (!page) throw new Error("no page");
  return greyOf(page);
};

const crookedScan = skewedBarsPage(FIXTURE_SKEW_DEGREES).then(scan);
const straightScan = skewedBarsPage(0).then(scan);

describe("the deskew instrument, on the real fixture through pdf.js", () => {
  it("measures the crooked scan at the angle it was drawn", async () => {
    const m = measureBarSkew(await render(await crookedScan));
    expect(m.bars).toHaveLength(4);
    expect(Math.abs(m.degrees - FIXTURE_SKEW_DEGREES)).toBeLessThan(0.3);
    // Every bar agrees: one line per bar, not one lucky bar.
    for (const bar of m.bars)
      expect(Math.abs(bar - FIXTURE_SKEW_DEGREES)).toBeLessThan(0.4);
  }, 30_000);

  it("measures the straight scan as about zero (the positive control)", async () => {
    const m = measureBarSkew(await render(await straightScan));
    expect(Math.abs(m.degrees)).toBeLessThan(0.15);
  }, 30_000);

  it("reads the direction: a clockwise turn measures negative", async () => {
    const m = measureBarSkew(
      await render(await scan(await skewedBarsPage(-FIXTURE_SKEW_DEGREES))),
    );
    expect(Math.abs(m.degrees + FIXTURE_SKEW_DEGREES)).toBeLessThan(0.3);
  }, 30_000);

  it("refuses to measure a blank page rather than calling it straight", () => {
    const blank = {
      width: 400,
      height: 500,
      grey: new Uint8Array(400 * 500).fill(255),
    };
    expect(() => measureBarSkew(blank)).toThrow(/met 0 of 4 bars/);
  });
});

/** An engine played over the real fixtures. */
async function deps(
  engine: (deskew: boolean) => Promise<Uint8Array>,
  over: Partial<OcrDeskewProofDeps> = {},
): Promise<{ deps: OcrDeskewProofDeps; lines: string[] }> {
  const outputs = new Set<Uint8Array>();
  const lines: string[] = [];
  const ocr: Processor = {
    capability: () => ({ ready: true, detail: "played" }),
    process: async (input: { options: Record<string, unknown> }) => {
      const bytes = await engine(input.options.deskew === true);
      const copy = bytes.slice();
      outputs.add(copy);
      return {
        ok: true,
        artifacts: [
          {
            filename: "crooked-ocr.pdf",
            contentType: "application/pdf",
            bytes: copy,
          },
        ],
      };
    },
  } as unknown as Processor;
  return {
    lines,
    deps: {
      ocr,
      scan,
      render,
      // A scan has no text; what the engine returned has the sentinel.
      pdfText: async (pdf) => (outputs.has(pdf) ? DESKEW_SENTINEL : ""),
      ocrmypdf: async () => ({
        code: 1,
        stderr:
          "--redo-ocr is not currently compatible with --deskew, --clean-final, and --remove-background",
      }),
      log: (line) => lines.push(line),
      ...over,
    },
  };
}

describe("runOcrDeskewProof — each verdict can fail", () => {
  it("PROVEN when the engine straightens with deskew and not without", async () => {
    const { deps: d, lines } = await deps(async (deskew) =>
      deskew ? straightScan : crookedScan,
    );
    expect(await runOcrDeskewProof(d)).toBe(0);
    expect(lines.filter((l) => l.startsWith("FAIL"))).toEqual([]);
    expect(lines.filter((l) => l.startsWith("PASS")).length).toBe(7);
  }, 60_000);

  it("fails when the engine ignores --deskew, and says what it measured", async () => {
    const { deps: d, lines } = await deps(async () => crookedScan);
    expect(await runOcrDeskewProof(d)).toBe(1);
    const fail = lines.filter((l) => l.startsWith("FAIL"));
    expect(fail).toHaveLength(1);
    expect(fail[0]).toMatch(/deskew on: output page 1 is straight/);
    expect(fail[0]).toMatch(/measured 3\.\d\d°/);
  }, 60_000);

  it("fails the negative control when every page comes back straight", async () => {
    const { deps: d, lines } = await deps(async () => straightScan);
    expect(await runOcrDeskewProof(d)).toBe(1);
    const fail = lines.filter((l) => l.startsWith("FAIL"));
    expect(fail).toHaveLength(1);
    expect(fail[0]).toMatch(/deskew off: .*control/);
  }, 60_000);

  it("fails, naming the instrument, when the render is blank", async () => {
    const { deps: d, lines } = await deps(async () => straightScan, {
      render: async () => ({
        width: 400,
        height: 500,
        grey: new Uint8Array(400 * 500).fill(255),
      }),
    });
    expect(await runOcrDeskewProof(d)).toBe(1);
    expect(
      lines.filter((l) => l.startsWith("FAIL") && /met 0 of 4 bars/.test(l)),
    ).toHaveLength(4);
  }, 60_000);

  it("fails when the engine accepts --redo-ocr with --deskew", async () => {
    const { deps: d, lines } = await deps(
      async (deskew) => (deskew ? straightScan : crookedScan),
      { ocrmypdf: async () => ({ code: 0, stderr: "" }) },
    );
    expect(await runOcrDeskewProof(d)).toBe(1);
    expect(lines.find((l) => l.startsWith("FAIL"))).toMatch(
      /ACCEPTED the pair/,
    );
  }, 60_000);

  it("cannot conclude (2) without pdftotext or ocrmypdf", async () => {
    const a = await deps(async () => crookedScan, { pdfText: null });
    expect(await runOcrDeskewProof(a.deps)).toBe(2);
    const b = await deps(async () => crookedScan, { ocrmypdf: null });
    expect(await runOcrDeskewProof(b.deps)).toBe(2);
  });
});
