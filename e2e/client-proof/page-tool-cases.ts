import { expect, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { cropPdf } from "../../src/lib/pdf/crop";
import { addHeaderFooter } from "../../src/lib/pdf/header-footer";
import { splitPagesInHalf } from "../../src/lib/pdf/split-half";
import { fileInput, waitForHydration } from "../helpers";
import { captureDownload, loadPdf, pdfPageTexts } from "./artifacts";
import { makeTextPdf } from "./fixtures";
import type { CaseContext, VariantCase } from "./cases";

/**
 * Option variants of the page tools added by the 2026-11-22 audit wave
 * (lane w1a), each driven through the page and proved on the downloaded
 * file. Run by `client-tools.spec.ts` with every other variant.
 */

/** Pick `bytes` as `name` on the page's drop box. */
export async function uploadPdf(
  page: Page,
  name: string,
  bytes: Uint8Array,
): Promise<void> {
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name,
    mimeType: "application/pdf",
    buffer: Buffer.from(bytes),
  });
  await expect(page.getByText(name, { exact: true })).toBeVisible({
    timeout: 20_000,
  });
}

/** Press Run, wait for the result, and save the file the CTA downloads. */
export async function runAndSave(
  page: Page,
  runName: RegExp,
  resultHeading: RegExp,
  ctaName: RegExp,
): Promise<Buffer> {
  const run = page.getByRole("button", { name: runName });
  await expect(run).toBeEnabled();
  await waitForHydration(run);
  await run.click();
  await expect(page.getByRole("heading", { name: resultHeading })).toBeVisible({
    timeout: 60_000,
  });
  return captureDownload(page, page.getByRole("button", { name: ctaName }));
}

/** Why the header-footer caret variant rejects an artifact. */
const AT_CARET = "the field landed where the caret was, mid-text";

/** The header typed around the caret: the field goes between the words. */
const HEADER_BEFORE = "Sheet ";
const HEADER_AFTER = " end";

const headerFooterAtCaret: VariantCase = {
  slug: "header-footer",
  name: "{n} inserted at the caret, mid-text",
  kind: "header-footer",
  artifact: "pdf",
  run: async (ctx: CaseContext) => {
    const bytes = await makeTextPdf("caret.pdf", { pages: 2 });
    ctx.data.input = Buffer.from(bytes);
    await uploadPdf(ctx.page, "caret.pdf", bytes);
    const box = ctx.page.getByLabel("Header left", { exact: true });
    await box.fill(HEADER_BEFORE + HEADER_AFTER);
    // The caret goes between the two words, as a person clicks it there.
    await box.focus();
    await box.press("End");
    for (let i = 0; i < HEADER_AFTER.length; i++) await box.press("ArrowLeft");
    await ctx.page
      .getByRole("button", { name: "Insert {n} into Header left" })
      .click();
    await expect(box).toHaveValue(`${HEADER_BEFORE}{n}${HEADER_AFTER}`);
    return runAndSave(
      ctx.page,
      /add header & footer/i,
      /header & footer added/i,
      /^download pdf$/i,
    );
  },
  assert: async (buf) => {
    const texts = await pdfPageTexts(buf);
    expect(texts, AT_CARET).toHaveLength(2);
    expect(texts[1]!.replace(/\s+/g, " "), AT_CARET).toContain(
      `${HEADER_BEFORE}2${HEADER_AFTER}`,
    );
  },
  // The same file stamped with the field appended at the end, as the button
  // did before: every word right but the field's place.
  control: async (ctx) => {
    const appended = await addHeaderFooter(
      new Uint8Array(ctx.data.input as Buffer),
      {
        header: { left: `${HEADER_BEFORE}${HEADER_AFTER}{n}` },
        footer: { center: "Page {n} of {total}" },
      },
    );
    await PDFDocument.load(appended);
    return Buffer.from(appended);
  },
  rejectsBecause: [AT_CARET],
};

/** Why the crop variant rejects an artifact. */
const DEEP_CUT = "the right edge lost 395 pt in one run";

const A4: [number, number] = [595.28, 841.89];
const DEEP_RIGHT = 395;
/** The runner's starting margin, left on the other three edges. */
const START = 24;

const cropDeepRight: VariantCase = {
  slug: "crop-pdf",
  name: "Per side, 395 pt off the right of an A4 page",
  kind: "crop",
  artifact: "pdf",
  run: async (ctx) => {
    const bytes = await makeTextPdf("deep.pdf", { pages: 1, size: A4 });
    ctx.data.input = Buffer.from(bytes);
    await uploadPdf(ctx.page, "deep.pdf", bytes);
    await ctx.page
      .getByRole("radiogroup", { name: "Crop mode" })
      .getByRole("radio", { name: "Per side" })
      .click();
    // The limits come from the page sizes, read a moment after the file
    // opens: the preview sheet appears with them.
    await expect(ctx.page.locator("[data-crop-sheet]")).toBeVisible();
    await ctx.page.getByLabel("Right in pt").fill(String(DEEP_RIGHT));
    return runAndSave(
      ctx.page,
      /^crop pdf$/i,
      /pdf cropped/i,
      /download cropped pdf/i,
    );
  },
  assert: async (buf) => {
    const doc = await loadPdf(buf);
    const box = doc.getPage(0).getCropBox();
    expect(box.x, DEEP_CUT).toBeCloseTo(START, 3);
    expect(box.width, DEEP_CUT).toBeCloseTo(A4[0] - DEEP_RIGHT - START, 3);
    expect(box.height, DEEP_CUT).toBeCloseTo(A4[1] - 2 * START, 3);
  },
  // The cut the old 300 pt cap allowed in one run.
  control: async (ctx) =>
    Buffer.from(
      await cropPdf(new Uint8Array(ctx.data.input as Buffer), {
        margins: { top: START, right: 300, bottom: START, left: START },
      }),
    ),
  rejectsBecause: [DEEP_CUT],
};

/* ------------------------------------------------------------------ *
 *  Split PDF Pages in Half
 * ------------------------------------------------------------------ */

/** Each page as a viewer shows it: CropBox size, turned by /Rotate. */
async function displayedSizes(buf: Buffer): Promise<[number, number][]> {
  const doc = await loadPdf(buf);
  return doc.getPages().map((page) => {
    const { width, height } = page.getCropBox();
    const turned = page.getRotation().angle % 180 !== 0;
    return [
      Math.round(turned ? height : width),
      Math.round(turned ? width : height),
    ];
  });
}

/** Spreads with each half stamped with its page number ("PAGE-8"). */
async function stampedSpreads(
  sheets: [number, number][],
  [w, h]: [number, number] = [800, 560],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const [left, right] of sheets) {
    const page = doc.addPage([w, h]);
    page.drawText(`PAGE-${left}`, { x: 60, y: h / 2, size: 18, font });
    page.drawText(`PAGE-${right}`, { x: w / 2 + 60, y: h / 2, size: 18, font });
  }
  return doc.save();
}

/** The page number each output page shows, read by pdf.js. */
async function pageNumbersOf(buf: Buffer): Promise<number[][]> {
  return (await pdfPageTexts(buf)).map((text) =>
    [...text.matchAll(/PAGE-([0-9]+)/g)].map((m) => Number(m[1])),
  );
}

/** Open the split tool on `bytes`, apply `setup`, run and save. */
async function splitThroughPage(
  ctx: CaseContext,
  name: string,
  bytes: Uint8Array,
  setup: (page: Page) => Promise<void>,
): Promise<Buffer> {
  ctx.data.input = Buffer.from(bytes);
  await uploadPdf(ctx.page, name, bytes);
  await setup(ctx.page);
  return runAndSave(
    ctx.page,
    /^split pages$/i,
    /pages split in half/i,
    /download split pdf/i,
  );
}

const inputOf = (ctx: CaseContext) => new Uint8Array(ctx.data.input as Buffer);

/** Why the cut-position variant rejects an artifact. */
const CUT_AT_40 = "each half is 40% and 60% of the spread, with its own text";

/** A spread whose gutter is at 40% of its width. */
async function offCentreSpread(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([1000, 600]);
  page.drawText("LEFTPAGE", { x: 40, y: 300, size: 20, font });
  page.drawText("RIGHTPAGE", { x: 600, y: 300, size: 20, font });
  return doc.save();
}

const splitAt40: VariantCase = {
  slug: "split-pdf-pages-in-half",
  name: "the cut moved to 40%",
  kind: "split-half",
  artifact: "pdf",
  run: (ctx) =>
    offCentreSpread().then((bytes) =>
      splitThroughPage(ctx, "gutter.pdf", bytes, async (page) => {
        // The line on the page is the same value as the slider.
        const line = page.getByRole("slider", { name: "Cut line" });
        await expect(line).toHaveAttribute("aria-valuenow", "50");
        await page.getByLabel("Cut position").fill("40");
        await expect(line).toHaveAttribute("aria-valuenow", "40");
      }),
    ),
  assert: async (buf) => {
    expect(await displayedSizes(buf), CUT_AT_40).toEqual([
      [400, 600],
      [600, 600],
    ]);
    const texts = await pdfPageTexts(buf);
    expect(texts[0], CUT_AT_40).toContain("LEFTPAGE");
    expect(texts[0], CUT_AT_40).not.toContain("RIGHTPAGE");
    expect(texts[1], CUT_AT_40).toContain("RIGHTPAGE");
    expect(texts[1], CUT_AT_40).not.toContain("LEFTPAGE");
  },
  // The same spread cut in the middle, as before the option.
  control: async (ctx) =>
    Buffer.from(
      (
        await splitPagesInHalf(inputOf(ctx), {
          direction: "left-right",
          order: "left-first",
        })
      ).bytes,
    ),
  rejectsBecause: [CUT_AT_40],
};

/** Why the booklet variant rejects an artifact. */
const READING_ORDER = "the booklet's halves read 1 to 8";

const splitBooklet: VariantCase = {
  slug: "split-pdf-pages-in-half",
  name: "Booklet scan order",
  kind: "split-half",
  artifact: "pdf",
  run: async (ctx) =>
    splitThroughPage(
      ctx,
      "booklet.pdf",
      await stampedSpreads([
        [8, 1],
        [2, 7],
        [6, 3],
        [4, 5],
      ]),
      async (page) => {
        await page
          .getByRole("radiogroup", { name: "Page order" })
          .getByRole("radio", { name: "Booklet scan" })
          .click();
      },
    ),
  assert: async (buf) => {
    expect(await pageNumbersOf(buf), READING_ORDER).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8].map((n) => [n]),
    );
  },
  // The same scan split in source order: 8 1 2 7 6 3 4 5.
  control: async (ctx) =>
    Buffer.from(
      (
        await splitPagesInHalf(inputOf(ctx), {
          direction: "left-right",
          order: "left-first",
        })
      ).bytes,
    ),
  rejectsBecause: [READING_ORDER],
};

/** Why the shape variant rejects an artifact. */
const SHAPES_KEPT = "only the spreads were split; the portrait plate is whole";

/** A landscape spread, a portrait plate, and a spread stored upright. */
async function mixedScan(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([800, 560]);
  doc.addPage([420, 600]);
  doc.addPage([560, 800]).setRotation(degrees(90));
  return doc.save();
}

const splitOnlyWide: VariantCase = {
  slug: "split-pdf-pages-in-half",
  name: "Only split pages wider than tall",
  kind: "split-half",
  artifact: "pdf",
  run: async (ctx) =>
    splitThroughPage(ctx, "mixed.pdf", await mixedScan(), async (page) => {
      await page
        .getByRole("checkbox", { name: /^Only split pages wider than tall/ })
        .check();
    }),
  assert: async (buf) => {
    expect(await displayedSizes(buf), SHAPES_KEPT).toEqual([
      [400, 560],
      [400, 560],
      [420, 600],
      [400, 560],
      [400, 560],
    ]);
  },
  // Every page split, the plate too.
  control: async (ctx) =>
    Buffer.from(
      (
        await splitPagesInHalf(inputOf(ctx), {
          direction: "left-right",
          order: "left-first",
        })
      ).bytes,
    ),
  rejectsBecause: [SHAPES_KEPT],
};

export const PAGE_TOOL_VARIANTS: readonly VariantCase[] = [
  headerFooterAtCaret,
  cropDeepRight,
  splitAt40,
  splitBooklet,
  splitOnlyWide,
];
