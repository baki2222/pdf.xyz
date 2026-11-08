import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { greyPng, ppmOf } from "@/tests/density-fixtures";
import { guides } from "@/lib/guides/catalog";
import { toolContent } from "./content";
import {
  DEFAULT_IMAGE_PAGE_OPTIONS,
  IMAGE_MARGINS,
  IMAGE_PAGE_SIZES,
  imageMarginPoints,
  imagePageSizeById,
  type ImagePageOptions,
} from "@/lib/pdf/image-page-layout";
import { imagesToPdf } from "@/lib/pdf/image-to-pdf";

/*
 * "A 300 dpi scan of an A4 sheet becomes an A4 page" (audits jpg-to-pdf#4,
 * png-to-pdf#4). ADDED after review, 2026-11-08: three sentences said it of
 * Fit to image alone, and the tests behind them quietly used margin None.
 * Under the default margin (Large, 0.5 in) Fit to image gives A4 plus an
 * inch on each axis. So every sentence that makes the claim, on any tool
 * page or guide, must name the margin it holds under, and that margin is
 * run through the engine and must give the A4 MediaBox.
 */

const CLAIM = /becomes an A4 page/;
const FIT = IMAGE_PAGE_SIZES.find((s) => s.id === "fit")!.label;

const corpus = [
  ...Object.entries(toolContent).map(([slug, c]) => [slug, c] as const),
  ...guides.map((g) => [g.slug, g] as const),
].flatMap(([where, value]) =>
  JSON.stringify(value)
    .split(/(?<=\.)\s+|\\n|","/)
    .filter((s) => CLAIM.test(s))
    .map((sentence) => ({ where, sentence })),
);

async function a4ScanPage(margin: ImagePageOptions["margin"]) {
  // 2480 × 3508 px is A4 at 300 dpi.
  const scan = greyPng(2480, 3508, { x: ppmOf(300), y: ppmOf(300), unit: 1 });
  const pdf = await imagesToPdf(
    "png",
    [{ name: "scan.png", type: "image/png", bytes: scan }],
    { ...DEFAULT_IMAGE_PAGE_OPTIONS, pageSize: "fit", margin },
  );
  return (await PDFDocument.load(pdf)).getPage(0).getSize();
}

const A4 = imagePageSizeById("a4").size!;

describe("the A4-scan claim names the margin it is true under", () => {
  it("health check: the corpus holds every page that makes the claim", () => {
    // PNG intro, JPG intro, JPG's TIFF paragraph, PNG guide, TIFF guide.
    expect(corpus.length).toBeGreaterThanOrEqual(5);
    const where = new Set(corpus.map((c) => c.where));
    for (const slug of [
      "jpg-to-pdf",
      "png-to-pdf",
      "how-to-convert-png-to-pdf",
      "how-to-convert-tiff-to-pdf",
    ])
      expect(where).toContain(slug);
  });

  it("positive control: under the default margin it is NOT an A4 page", async () => {
    const m = imageMarginPoints(DEFAULT_IMAGE_PAGE_OPTIONS.margin);
    expect(m).toBeGreaterThan(0);
    const page = await a4ScanPage(DEFAULT_IMAGE_PAGE_OPTIONS.margin);
    expect(page.width).toBeCloseTo(A4.width + 2 * m, 0);
    expect(page.height).toBeCloseTo(A4.height + 2 * m, 0);
  });

  it.each(corpus)(
    "$where: names Fit to image and a margin, and that margin gives A4",
    async ({ sentence }) => {
      expect(sentence).toContain(`${FIT} under Page size`);
      const stated = IMAGE_MARGINS.filter((m) =>
        sentence.includes(`${m.label} under Margin`),
      );
      expect(stated.map((m) => m.label)).toHaveLength(1);
      const page = await a4ScanPage(stated[0]!.id);
      expect(page.width).toBeCloseTo(A4.width, 0);
      expect(page.height).toBeCloseTo(A4.height, 0);
    },
  );
});
