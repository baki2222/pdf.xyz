// @vitest-environment node
/**
 * The round-trip fidelity instrument, held to its own controls before it is
 * allowed to judge an export (CLAUDE.md: every predicate gets a health check
 * and a positive control; a bound gets the controls it must fail).
 *
 * These need no presentation engine: they compare PDFs built here, so they
 * run wherever pdf.js and its canvas do (CI's unit job included). The round
 * trip itself — deck → LibreOffice → PDF → this comparison — is
 * `fidelity.roundtrip.test.ts`, and inside the worker image
 * `pnpm worker:pptx-fidelity-proof`.
 */
import { PDFDocument, rgb } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  imageCaptionPdf,
  PPTX_FIDELITY_FIXTURES,
} from "@/tests/pptx-fidelity-fixtures";
import {
  blur,
  compareFidelity,
  FIDELITY_BOUND,
  fitCentred,
  rasterizeGray,
  verdict,
} from "./fidelity";

/** A copy of `pdf` with every page blank, at the same sizes. */
async function blankLike(pdf: Uint8Array): Promise<Uint8Array> {
  const src = await PDFDocument.load(pdf);
  const out = await PDFDocument.create();
  for (const page of src.getPages()) {
    const p = out.addPage([page.getWidth(), page.getHeight()]);
    p.setRotation(page.getRotation());
  }
  return out.save();
}

/** The fixture page with its content drawn `dx` points to the right. */
async function shifted(pdf: Uint8Array, dx: number): Promise<Uint8Array> {
  const src = await PDFDocument.load(pdf);
  const out = await PDFDocument.create();
  const [embedded] = await out.embedPdf(src, [0]);
  const page = out.addPage([embedded!.width, embedded!.height]);
  page.drawPage(embedded!, { x: dx, y: 0 });
  return out.save();
}

describe("fitCentred", () => {
  it("fits a portrait page into a landscape slide, centred", () => {
    const fit = fitCentred(
      { width: 595, height: 842 },
      { width: 720, height: 540 },
    );
    expect(fit.scale).toBeCloseTo(540 / 842, 6);
    expect(fit.offsetY).toBeCloseTo(0, 6);
    expect(fit.offsetX).toBeCloseTo((720 - 595 * (540 / 842)) / 2, 6);
  });
  it("is the identity for a page of the slide's own size", () => {
    expect(
      fitCentred({ width: 720, height: 540 }, { width: 720, height: 540 }),
    ).toEqual({ scale: 1, offsetX: 0, offsetY: 0 });
  });
});

describe("blur", () => {
  it("keeps the mean of a uniform field and spreads a point", () => {
    const flat = new Float32Array(25).fill(100);
    expect(blur(flat, 5, 5, 1).every((v) => Math.abs(v - 100) < 1e-3)).toBe(
      true,
    );
    const dot = new Float32Array(25);
    dot[12] = 255;
    const b = blur(dot, 5, 5, 1);
    expect(b[12]!).toBeLessThan(255);
    expect(b[11]!).toBeGreaterThan(0);
  });
});

describe("the comparison, against controls", () => {
  it("HEALTH: the rasteriser draws the fixtures' ink (a blank raster would pass every 'same as blank' check)", async () => {
    for (const build of PPTX_FIDELITY_FIXTURES) {
      const fixture = await build();
      const pages = await rasterizeGray(fixture.pdf);
      expect(pages).toHaveLength(fixture.pages.length);
      for (const page of pages) {
        let ink = 0;
        for (const v of page.gray) ink += 255 - v;
        expect(ink / page.gray.length, fixture.name).toBeGreaterThan(5);
      }
    }
  });

  it("POSITIVE CONTROL: a PDF scores 0 against itself, and passes", async () => {
    const { pdf } = await imageCaptionPdf();
    const report = await compareFidelity(pdf, pdf);
    expect(report.pages.map((p) => p.score)).toEqual([0]);
    expect(report.pass).toBe(true);
  });

  it("NEGATIVE CONTROL: a blank document scores 1 on every page with ink, and fails", async () => {
    for (const build of PPTX_FIDELITY_FIXTURES) {
      const fixture = await build();
      const report = await compareFidelity(
        fixture.pdf,
        await blankLike(fixture.pdf),
      );
      for (const page of report.pages)
        expect(page.score, `${fixture.name} p${page.page}`).toBeCloseTo(1, 2);
      expect(report.pass, fixture.name).toBe(false);
    }
  });

  it("sees a page whose content moved 30 points, and forgives one moved 1 point", async () => {
    const { pdf } = await imageCaptionPdf();
    const far = await compareFidelity(pdf, await shifted(pdf, 30));
    const close = await compareFidelity(pdf, await shifted(pdf, 1));
    expect(far.pages[0]!.score).toBeGreaterThan(FIDELITY_BOUND.page);
    expect(close.pages[0]!.score).toBeLessThan(FIDELITY_BOUND.page / 3);
  });

  it("compares a page of another shape through the fit, not by stretching", async () => {
    // The same 720 × 540 page drawn centred on a 960 × 540 (16:9) page scores
    // as itself; stretched, it would not.
    const { pdf } = await imageCaptionPdf();
    const src = await PDFDocument.load(pdf);
    const wide = await PDFDocument.create();
    const [embedded] = await wide.embedPdf(src, [0]);
    const page = wide.addPage([960, 540]);
    page.drawRectangle({
      x: 0,
      y: 0,
      width: 960,
      height: 540,
      color: rgb(1, 1, 1),
    });
    page.drawPage(embedded!, { x: 120, y: 0 });
    const report = await compareFidelity(pdf, await wide.save());
    expect(report.pages[0]!.score).toBeLessThan(0.02);
  });

  it("fails a candidate with a page missing, even when the pages it has match", () => {
    const r = verdict([{ page: 1, score: 0, ink: 50 }], 2, 1);
    expect(r.pass).toBe(false);
    expect(r.detail).toMatch(/candidate has 1 page/);
  });
});
