// @vitest-environment node
// @native-canvas
/**
 * The Word picture instrument, held to its own controls before it is allowed
 * to judge an export (CLAUDE.md: every predicate gets a health check and a
 * positive control, and a bound gets the controls it must fail).
 *
 *  - POSITIVE: a .docx built BY HAND from each fixture's record
 *    (`@/tests/docx-hand-built`), sharing nothing with the engine's writer,
 *    passes. So the instrument can pass a right file it was not taught by.
 *  - NEGATIVE: the text-only .docx this tool shipped until 2026-10-17
 *    (`@/tests/docx-text-only-2026-10-17`) fails on every fixture, as
 *    missing every picture.
 *  - PARTIAL: one defect at a time, each made from the passing hand-built
 *    file — two pictures swapped, one place showing another picture's
 *    pixels, one dropped, one moved below the next paragraph, one stretched
 *    10%, one on the wrong page — and each must fail, for its own reason.
 *
 * The engine's own .docx against the same instrument is
 * `docx-pictures.test.ts`.
 */
import {
  concatTransformationMatrix,
  drawObject,
  PDFDocument,
  popGraphicsState,
  pushGraphicsState,
  StandardFonts,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  boldItalicPdf,
  captionedPicturesPdf,
  coveredPicturePdf,
  croppedPagePdf,
  DOCX_PICTURE_FIXTURES,
  labelledCalloutPdf,
  scanBetweenPagesPdf,
  stripePixels,
  twinScreenshotsPdf,
  type DocxFixture,
} from "@/tests/docx-picture-fixtures";
import { gradientPixels } from "@/tests/pptx-fidelity-fixtures";
import {
  dropPicture,
  handBuiltDocx,
  handPng,
  movePictureDown,
  replacePictureMedia,
  stretchFirstPicture,
  swapFirstTwoPictures,
} from "@/tests/docx-hand-built";
import { docxTextOnly20261017 } from "@/tests/docx-text-only-2026-10-17";
import { flowStandIn } from "@/tests/poppler-flow-standin";
import { compareDocxPictures, PIXEL_BOUND } from "./docx-fidelity";
import { readDocxBody } from "./docx-read";
import { PDF_TO_WORD_TOOL, runPdfOfficeExport } from "./engine";
import { scanPdfPages } from "./page-scan";

/** The fixture as a hand-built .docx: its sequence, its pictures' files. */
async function handBuilt(fixture: DocxFixture): Promise<Uint8Array> {
  return handBuiltDocx({
    page: fixture.firstPage,
    pages: fixture.sequence.map((page) =>
      page.map((block) =>
        block.startsWith("#") ? { picture: Number(block.slice(1)) - 1 } : block,
      ),
    ),
    pictures: fixture.pictures.map((p) => {
      if (!p.file) throw new Error(`${fixture.name} has no picture file`);
      return { ...p.file, width: p.shown.width, height: p.shown.height };
    }),
  });
}

const HAND_BUILT = [captionedPicturesPdf, scanBetweenPagesPdf, croppedPagePdf];

describe("the Word picture instrument, against its controls", () => {
  it("HEALTH: it finds every fixture picture in the source and decodes it, and has text to place most by", async () => {
    for (const build of DOCX_PICTURE_FIXTURES) {
      const fixture = await build();
      const report = await compareDocxPictures(
        fixture.pdf,
        await docxTextOnly20261017((await flowStandIn(fixture.pdf)).pages),
      );
      expect(report.sourcePictures, fixture.name).toBe(fixture.pictures.length);
      expect(
        report.pictures.filter((p) => p.inconclusive),
        fixture.name,
      ).toEqual([]);
    }
  }, 120_000);

  it("POSITIVE CONTROL: a .docx built by hand from the fixture's own record passes", async () => {
    for (const build of HAND_BUILT) {
      const fixture = await build();
      const report = await compareDocxPictures(
        fixture.pdf,
        await handBuilt(fixture),
      );
      expect(report.pass, `${fixture.name}: ${report.detail}`).toBe(true);
      expect(report.matched).toBe(fixture.pictures.length);
      // Health: a picture with text above or below it on its page was
      // placed BY that text, not passed for want of any.
      const placeable = fixture.sequence.filter(
        (page) =>
          page.some((b) => b.startsWith("#")) &&
          page.some((b) => !b.startsWith("#")),
      ).length;
      expect(report.orderChecked, fixture.name).toBeGreaterThanOrEqual(
        placeable,
      );
      // The bound has room: a right picture scores well under it. Per
      // channel (since 2026-10-17) the 30 × 20 JPEG's sharp red and blue
      // edges score 0.275 (chroma decoded two ways, then upscaled 4×),
      // against the 1.5 a wrong picture is held over; it was 0.25 of the
      // bound, on luminance, before.
      expect(report.maxPixelScore, fixture.name).toBeLessThan(
        PIXEL_BOUND * 0.6,
      );
    }
  }, 120_000);

  it("NEGATIVE CONTROL: the text-only .docx shipped until 2026-10-17 fails every fixture, every picture missing", async () => {
    for (const build of DOCX_PICTURE_FIXTURES) {
      const fixture = await build();
      const docx = await docxTextOnly20261017(
        (await flowStandIn(fixture.pdf)).pages,
      );
      // Health: it IS the text-only file — text, and no picture.
      const body = await readDocxBody(docx);
      expect(body.pictures).toEqual([]);
      const report = await compareDocxPictures(fixture.pdf, docx);
      expect(report.pass, fixture.name).toBe(false);
      expect(report.matched, fixture.name).toBe(0);
      expect(report.detail).toMatch(/^0 of \d+ source picture/);
    }
  }, 120_000);

  it("PARTIAL CONTROLS: swapped, replaced, dropped, moved and stretched pictures each fail, for their own reason", async () => {
    const fixture = await captionedPicturesPdf();
    const good = await handBuilt(fixture);
    // Swapped: each picture's pixels are in the DOCX, at the other's place
    // and size — so both are found, and both are in the wrong place.
    const swapped = await compareDocxPictures(
      fixture.pdf,
      await swapFirstTwoPictures(good),
    );
    expect(swapped.pass).toBe(false);
    expect(swapped.matched).toBe(3);
    expect(swapped.detail).toMatch(/wrong size: p1#1, p1#2/);
    expect(swapped.detail).toMatch(/out of order: p1#1, p1#2/);

    // Replaced: the first picture's place shows the second's pixels. The
    // first is missing, one DOCX picture matches nothing, and the bound is
    // not a hair's breadth from the wrong picture: it scores several times
    // what a right one may.
    const replaced = await compareDocxPictures(
      fixture.pdf,
      await replacePictureMedia(good, 0, fixture.pictures[1]!.file!.bytes),
    );
    expect(replaced.pass).toBe(false);
    expect(replaced.detail).toMatch(/missing: p1#1(;|$)/);
    expect(replaced.extras).toHaveLength(1);
    expect(replaced.pictures[0]!.pixels!).toBeGreaterThan(3 * PIXEL_BOUND);

    const dropped = await compareDocxPictures(
      fixture.pdf,
      await dropPicture(good, 1),
    );
    expect(dropped.pass).toBe(false);
    expect(dropped.detail).toMatch(/2 of 3 source picture/);
    expect(dropped.detail).toMatch(/missing: p1#2/);

    const moved = await compareDocxPictures(
      fixture.pdf,
      await movePictureDown(good),
    );
    expect(moved.pass).toBe(false);
    expect(moved.matched).toBe(3);
    expect(moved.detail).toMatch(/out of order: p1#1/);

    const stretched = await compareDocxPictures(
      fixture.pdf,
      await stretchFirstPicture(good),
    );
    expect(stretched.pass).toBe(false);
    expect(stretched.matched).toBe(3);
    expect(stretched.detail).toMatch(/wrong size: p1#1/);
  }, 120_000);

  it("a picture on the wrong page of the document fails, though it is next to its text", async () => {
    const fixture = await scanBetweenPagesPdf();
    // The scan on the FIRST page of the document instead of its own.
    const docx = await handBuiltDocx({
      page: fixture.firstPage,
      pages: [["Before the scan", { picture: 0 }], ["After the scan"]],
      pictures: [{ ...fixture.pictures[0]!.file!, width: 612, height: 792 }],
    });
    const report = await compareDocxPictures(fixture.pdf, docx);
    expect(report.pass).toBe(false);
    expect(report.detail).toMatch(/out of order: p2#1/);
  }, 60_000);
});

/**
 * The review of 2026-10-17, as the instrument's own controls: what the page
 * hides must stay hidden, "0 of 0" is not a pass, and colour is compared
 * channel by channel.
 */
describe("the Word picture instrument sees covers, colour, and nothing", () => {
  it("COVERS, POSITIVE CONTROL: the screenshot with its raw pixels — the box over the name undone — fails", async () => {
    const fixture = await coveredPicturePdf();
    const raw = await handBuilt(fixture);
    const report = await compareDocxPictures(fixture.pdf, raw);
    expect(report.pass).toBe(false);
    expect(report.matched).toBe(1);
    expect(report.detail).toMatch(/covered pixels survive: p1#1/);
    // Health: the covered area is the box's, not the whole picture.
    expect(report.coveredCells).toBeGreaterThan(100);
    expect(report.coveredCells).toBeLessThan(
      ((fixture.pictures[0]!.shown.width / 4) *
        fixture.pictures[0]!.shown.height) /
        4 /
        4,
    );
  }, 60_000);

  it("COVERS, NEGATIVE CONTROL: the same screenshot with the box drawn into its pixels passes", async () => {
    const fixture = await coveredPicturePdf();
    const { width: W, height: H } = fixture.pictures[0]!.shown;
    const samples = gradientPixels(W, H);
    const { x, y, width, height } = fixture.hidden;
    // The page's box is a point larger than the block on every side.
    for (let r = y - 1; r < y + height + 1; r++)
      for (let c = x - 1; c < x + width + 1; c++)
        samples.set([255, 255, 255], (r * W + c) * 3);
    const burned = await handBuiltDocx({
      page: fixture.firstPage,
      pages: [
        [fixture.sequence[0]![0]!, { picture: 0 }, fixture.sequence[0]![2]!],
      ],
      pictures: [
        {
          bytes: handPng(W, H, "rgb8", samples),
          ext: "png",
          width: W,
          height: H,
        },
      ],
    });
    const report = await compareDocxPictures(fixture.pdf, burned);
    expect(report.pass, report.detail).toBe(true);
    expect(report.survivingCells).toBe(0);
  }, 60_000);

  it("a source that paints no picture is CANNOT CONCLUDE unless declared picture-free; a declared one must be", async () => {
    const { pdf } = await boldItalicPdf();
    const docx = await docxTextOnly20261017((await flowStandIn(pdf)).pages);
    const undeclared = await compareDocxPictures(pdf, docx);
    expect(undeclared.pass).toBe(false);
    expect(undeclared.detail).toMatch(
      /^CANNOT CONCLUDE: the source paints no picture/,
    );
    expect(
      (await compareDocxPictures(pdf, docx, { pictureFree: true })).pass,
    ).toBe(true);
    const fixture = await captionedPicturesPdf();
    const wrongly = await compareDocxPictures(
      fixture.pdf,
      await handBuilt(fixture),
      { pictureFree: true },
    );
    expect(wrongly.pass).toBe(false);
    expect(wrongly.detail).toMatch(/declared picture-free but paints 3/);
  }, 60_000);

  it("a picture with two colour channels swapped is not the picture", async () => {
    const fixture = await captionedPicturesPdf();
    const { pixelWidth: W, pixelHeight: H } = fixture.pictures[1]!;
    const swapped = stripePixels(W, H);
    for (let p = 0; p < W * H; p++) {
      const r = swapped[p * 3]!;
      swapped[p * 3] = swapped[p * 3 + 2]!;
      swapped[p * 3 + 2] = r;
    }
    const docx = await replacePictureMedia(
      await handBuilt(fixture),
      1,
      handPng(W, H, "rgb8", swapped),
    );
    const report = await compareDocxPictures(fixture.pdf, docx);
    expect(report.pass).toBe(false);
    expect(report.detail).toMatch(/missing: p1#2/);
    expect(report.pictures[1]!.pixels!).toBeGreaterThan(PIXEL_BOUND);
  }, 60_000);

  it("a CMYK picture decoded by the engine scores within the bound, per channel", async () => {
    // Measured by the review on luminance: 0.173 and 0.097. A Flate DeviceCMYK
    // image, through the engine and back.
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const W = 120;
    const H = 80;
    const cmyk = new Uint8Array(W * H * 4);
    for (let p = 0; p < W * H; p++) {
      const x = p % W;
      const y = Math.floor(p / W);
      cmyk.set(
        [(x * 2) % 256, (y * 3) % 256, x > 60 ? 200 : 20, y > 40 ? 60 : 0],
        p * 4,
      );
    }
    const ref = doc.context.register(
      doc.context.flateStream(cmyk, {
        Type: "XObject",
        Subtype: "Image",
        Width: W,
        Height: H,
        BitsPerComponent: 8,
        ColorSpace: "DeviceCMYK",
      }),
    );
    const name = page.node.newXObject("Cmyk", ref);
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(240, 0, 0, 160, 72, 500),
      drawObject(name),
      popGraphicsState(),
    );
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("A CMYK picture", { x: 72, y: 700, size: 14, font });
    const pdf = await doc.save();
    const run = await runPdfOfficeExport(PDF_TO_WORD_TOOL, pdf, {
      extractFlow: flowStandIn,
      scanPages: scanPdfPages,
    });
    if (!run.ok) throw new Error(run.message);
    const report = await compareDocxPictures(pdf, run.output);
    expect(report.pass, report.detail).toBe(true);
    expect(report.maxPixelScore).toBeLessThan(PIXEL_BOUND / 2);
  }, 60_000);
});

/**
 * Found while making the export paint covers in (2026-10-17), on the owner's
 * tutorial: two look-alike screenshots matched crosswise, and the blur
 * carried a dark screenshot through a callout's clear margin into cells the
 * callout covers. Each control below fails without its fix.
 */
describe("the Word picture instrument matches look-alikes by size and page, and reads covers only where the picture is solid", () => {
  it("two look-alike screenshots, each at its own size on its own page, are matched to their own — even when the other one's pixels are closer", async () => {
    const fixture = await twinScreenshotsPdf();
    const { pixelWidth: W, pixelHeight: H } = fixture.pictures[0]!;
    // Page 1's picture is a little off (a small block lifted), page 2's is
    // exact: by pixels alone page 1's source is closer to page 2's.
    const off = gradientPixels(W, H);
    for (let y = 40; y < 56; y++)
      for (let x = 40; x < 56; x++)
        for (let c = 0; c < 3; c++)
          off[(y * W + x) * 3 + c] = Math.min(
            255,
            off[(y * W + x) * 3 + c]! + 30,
          );
    const docx = await handBuiltDocx({
      page: fixture.firstPage,
      pages: [
        [fixture.sequence[0]![0]!, { picture: 0 }],
        [fixture.sequence[1]![0]!, { picture: 1 }],
      ],
      pictures: [
        {
          bytes: handPng(W, H, "rgb8", off),
          ext: "png",
          width: 300,
          height: 200,
        },
        { ...fixture.pictures[1]!.file!, width: 300, height: 180 },
      ],
    });
    const report = await compareDocxPictures(fixture.pdf, docx);
    expect(report.pass, report.detail).toBe(true);
    expect(report.pictures.map((p) => p.docx)).toEqual([0, 1]);
  }, 60_000);

  it("COVERS, NEGATIVE CONTROL: a callout's raw pixels — the label the page writes on it undone — fail; the dark screenshot seen through its clear margin is not a cover", async () => {
    const fixture = await labelledCalloutPdf();
    const report = await compareDocxPictures(
      fixture.pdf,
      await handBuilt(fixture),
    );
    expect(report.pass).toBe(false);
    expect(report.matched).toBe(2);
    // The screenshot under the callout is covered too, by the callout.
    expect(report.detail).toMatch(/p1#2 \(\d+ of \d+ covered cells\)/);
    // The label's cells, and not the margin's: the callout's covered cells
    // fit inside its opaque box less two cells a side.
    const callout = report.pictures[1]!.covered!;
    expect(callout.cells).toBeGreaterThan(10);
    expect(callout.cells).toBeLessThanOrEqual(
      ((160 - 12) / 4 - 4) * ((48 - 12) / 4 - 4),
    );
  }, 60_000);
});
