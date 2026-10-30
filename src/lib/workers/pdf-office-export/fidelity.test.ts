// @vitest-environment node
// @native-canvas
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
  mixedSizesPdf,
  oversizeScanPdf,
  PPTX_FIDELITY_FIXTURES,
  undecodablePicturePdf,
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
    // Budget, not assertion (2026-10-30): up to 4.2 s on CI's slower 4-vCPU
    // runners in the full unit run (26 logs, 10-24..10-30), against vitest's
    // 5-second default. The work is the same; the runner is not.
    // `src/tests/timeout-headroom.ts` names the next test past half its budget
    // on every CI run.
  }, 30_000);

  // `pnpm worker:prove-tools` against production, 2026-10-24: the PowerPoint
  // round trip FAILED with pdf.js's "Please provide binary data as
  // `Uint8Array`, rather than `Buffer`" — the harness hands this module the
  // bytes `fetch` gave it as a Node Buffer, which the `Uint8Array` type
  // admits, and `buf.slice()` is another Buffer (a VIEW, not a copy).
  it("takes Node Buffers, the type it is handed off the wire", async () => {
    const { pdf } = await imageCaptionPdf();
    const report = await compareFidelity(Buffer.from(pdf), Buffer.from(pdf));
    expect(report.pages.map((p) => p.score)).toEqual([0]);
    expect(report.pass).toBe(true);
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
    // Budget, not assertion (2026-10-30): up to 5.2 s on CI's slower 4-vCPU
    // runners in the full unit run (26 logs, 10-24..10-30), against vitest's
    // 5-second default, and it timed out there on 2026-10-25 (run 40159338051).
    // The work is the same; the runner is not. `src/tests/timeout-headroom.ts`
    // names the next test past half its budget on every CI run.
  }, 30_000);

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

/* ------------------------------------------------------------------ *
 *  2026-10-11: the review of the instrument
 * ------------------------------------------------------------------ */

/**
 * NOT THE ENGINE'S EYES. The source used to be rasterised through the
 * engine's own reader, with its 64 MP ceiling, so a picture the engine lost
 * was lost from the source too, and a BLANK deck scored 0.000 and passed —
 * on the very file whose deck was blank. The comparison now opens PDFs with
 * its own options, and asks the file (not pdf.js) what each page paints.
 */
describe("the comparison cannot share the engine's blind spots", () => {
  it("a blank deck FAILS a source whose one picture is over 64 megapixels", async () => {
    const fixture = await oversizeScanPdf();
    const [page] = await rasterizeGray(fixture.pdf);
    let ink = 0;
    for (const v of page!.gray) ink += 255 - v;
    // Health: the source is drawn — the picture is not dropped on this side.
    expect(ink / page!.gray.length).toBeGreaterThan(5);
    const report = await compareFidelity(
      fixture.pdf,
      await blankLike(fixture.pdf),
    );
    expect(report.pass, report.detail).toBe(false);
  }, 60_000);

  it("a page that paints a picture the rasteriser cannot draw is CANNOT CONCLUDE, and fails — even against a blank deck", async () => {
    // The undecodable picture is drawn by nobody: the source rasterises
    // blank, and so does a blank deck. Only the file says it paints.
    const src = await PDFDocument.load((await undecodablePicturePdf()).pdf);
    const one = await PDFDocument.create();
    one.addPage((await one.copyPages(src, [1]))[0]!);
    const pdf = await one.save();
    const report = await compareFidelity(pdf, await blankLike(pdf));
    expect(report.inconclusive).toEqual([1]);
    expect(report.pass).toBe(false);
    expect(report.detail).toMatch(/CANNOT CONCLUDE on page\(s\) 1/);
  });

  it("CONTROL: a page that paints nothing passes against a blank page — there is nothing to see", async () => {
    const one = await PDFDocument.create();
    one.addPage([300, 300]);
    const pdf = await one.save();
    const report = await compareFidelity(pdf, await blankLike(pdf));
    expect(report.inconclusive).toEqual([]);
    expect(report.pass).toBe(true);
  });

  it("the verdict fails a page whose source paints but rasterised to (almost) nothing", () => {
    const blankWouldPass = { page: 1, score: 0, ink: 0.1, paints: true };
    expect(verdict([blankWouldPass], 1, 1).pass).toBe(false);
    // The same page with nothing painted on it is not a blind spot.
    expect(verdict([{ ...blankWouldPass, paints: false }], 1, 1).pass).toBe(
      true,
    );
  });
});

/**
 * PARTIAL CONTROLS. The gross controls (blank, text-only) sit near 1.0; a
 * bound that fails them can still license ONE picture moved, stretched or
 * cropped, and the review measured exactly that. So one picture on one page
 * of a multi-page fixture, drawn wrong in each way, must FAIL — while the
 * page scores alone would pass it (the reason pictures are scored alone).
 */
describe("one picture wrong on one page fails the deck", () => {
  it.each(["move18pt", "stretch10", "crop15"] as const)("%s", async (kind) => {
    const base = await mixedSizesPdf();
    const altered = await mixedSizesPdf({ page: 2, kind });
    const report = await compareFidelity(base.pdf, altered.pdf);
    expect(report.pass, report.detail).toBe(false);
    // The page bound alone would have let it through: the picture caught it.
    expect(report.max).toBeLessThan(FIDELITY_BOUND.page);
    const picture = report.pictures.find((p) => p.page === 2)!;
    expect(picture.score).toBeGreaterThan(FIDELITY_BOUND.picture);
    // Every other page's picture is untouched.
    expect(
      report.pictures.filter((p) => p.page !== 2).map((p) => p.score),
    ).toEqual([0, 0, 0]);
  });

  it("POSITIVE CONTROL: the same fixture against itself passes, picture by picture", async () => {
    const base = await mixedSizesPdf();
    const report = await compareFidelity(base.pdf, base.pdf);
    expect(report.pictures).toHaveLength(4);
    expect(report.pass).toBe(true);
  });
});
