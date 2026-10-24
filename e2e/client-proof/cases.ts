import JSZip from "jszip";
import { expect, type Page } from "@playwright/test";
import { PDFDocument, degrees } from "pdf-lib";
import type { RunnerKind } from "../../src/lib/pdf/registry";
import { jpegComponentCount } from "../../src/lib/pdf/gray-jpeg";
import {
  createGrayscaleBuilder,
  grayscaleTitle,
} from "../../src/lib/pdf/grayscale-builder";
import {
  addDocumentStructure,
  lostStructure,
  readDocumentStructure,
} from "../../src/tests/fixtures-structured-pdf";
import {
  DEFAULT_RESOLUTION_ID,
  rasterScaleForDpi,
  resolutionById,
} from "../../src/lib/pdf/pdf-to-image";
import { DEFAULT_REDACTION_DRAFT } from "../../src/lib/pdf/redact-defaults";
import { addWatermark } from "../../src/lib/pdf/watermark";
import { addPageNumbers } from "../../src/lib/pdf/page-numbers";
import { fileInput, waitForHydration } from "../helpers";
import {
  collapsedStructuredProse,
  inkBlockRect,
  makeBlankImageInPage,
  makeFormPdf,
  makeImageBearingPdf,
  makeImagePagesPdf,
  makeJpegFixtureInPage,
  makeNeutralInkJpegInPage,
  makePngFixture,
  makeRasterPageInPage,
  makeRasterizedPdf,
  makeStructuredProsePdf,
  makeTextPdf,
  pageMarker,
  structuredProseProblems,
  writeTempFixture,
  type PointRect,
} from "./fixtures";
import {
  captureDownload,
  decodeEmbeddedPageImages,
  decodeImageInPage,
  decodePageRegions,
  expectMagic,
  normalizeText,
  pdfCropBoxes,
  pdfFormSnapshot,
  pdfImages,
  pdfPageCount,
  pdfPageImages,
  pdfPageTexts,
  pdfRotations,
  zipEntries,
  type ArtifactKind,
} from "./artifacts";

/**
 * One proof case per in-browser tool. The SET of tools is not defined here —
 * the spec derives it from the runner registry (the artifact the tool page
 * itself dispatches through) and fails loudly for any slug this table misses.
 *
 * Every case must satisfy three properties, enforced by the spec:
 *  1. `kind` pins the registry relationship: the case is written against a
 *     specific runner UI, so if the slug is ever re-pointed at a different
 *     runner, the proof fails instead of silently testing the wrong thing.
 *  2. `assert` inspects the DOWNLOADED bytes for content that would change if
 *     the engine were wrong — never just "no error appeared".
 *  3. `control` returns bytes the assertion MUST reject. A proof that cannot
 *     fail when the feature is removed is not a proof; this is the per-case
 *     positive control that keeps every assertion falsifiable, and it is
 *     required by the type rather than defaulted, because the obvious default
 *     (hand back the unmodified input) is the WEAKEST possible control
 *     wherever the tool changes container — a PDF fed to a "did we get a PNG"
 *     assertion is rejected by the magic bytes alone, which proves nothing
 *     about the engine. Read each case's control comment for what it varies.
 *
 * Measured 2026-08-21: with four engines neutered (merge, crop, watermark, and
 * the shared rasterizer blanked to model the pdfjs wasmUrl defect), exactly the
 * seven dependent cases went red, each on its own content assertion, and the
 * other twenty-three stayed green.
 */

export interface CaseContext {
  page: Page;
  /** Scratch shared between run/assert/control within one test. */
  data: Record<string, Buffer | string | number>;
}

export interface ToolCase {
  kind: RunnerKind;
  artifact: ArtifactKind;
  /** Drive the real UI from /tools/<slug> to the downloaded artifact bytes. */
  run: (ctx: CaseContext) => Promise<Buffer>;
  /** Content assertion over the downloaded bytes. */
  assert: (buf: Buffer, ctx: CaseContext) => Promise<void>;
  /**
   * Bytes `assert` MUST reject — one buffer, or several, each rejected on its
   * own. Required, not optional: a case without a positive control is a proof
   * that has never been shown capable of failing, and the type is the only
   * place that can make adding one unavoidable.
   *
   * Prefer a control that differs from the true artifact ONLY in the property
   * the assertion claims to check. A control of a different container type is
   * rejected by the container check alone, which proves far less — those are
   * called out case by case below. Where an assertion claims TWO independent
   * properties (grayscale: "the page was really rendered" AND "the colour was
   * removed"), return one control per property; a single control leaves the
   * other half unfalsified.
   */
  control: (ctx: CaseContext) => Promise<Buffer | Buffer[]>;
  /**
   * WHY each control must be rejected: for control N, a fragment of the
   * assertion message it must fail on. Optional, but set it wherever a case
   * returns one control per property — "rejected" alone accepts any throw,
   * including a precondition (a region that shrank to nothing, a page count)
   * that fires before the check the control exists to falsify. redact-pdf's
   * blank control was rejected exactly that way, so its "page 2 is blank"
   * check had never been shown able to fail. Share the fragment with the
   * assertion through one constant, so rewording one cannot orphan the other.
   */
  rejectsBecause?: string[];
}

/**
 * Run one control through its case's assertion and require the assertion to
 * reject it — and, where the case declares `rejectsBecause`, to reject it with
 * the message of the check that control exists for. Exported so the spec and
 * any offline replay of a case run the same verdict.
 */
export async function expectControlRejected(
  slug: string,
  proof: ToolCase,
  controls: Buffer[],
  index: number,
  ctx: CaseContext,
): Promise<void> {
  if (proof.rejectsBecause) {
    expect(
      proof.rejectsBecause.length,
      `"${slug}" declares ${proof.rejectsBecause.length} rejection reasons for ${controls.length} controls — every control needs exactly one`,
    ).toBe(controls.length);
  }
  let reason: string | null = null;
  try {
    await proof.assert(controls[index]!, ctx);
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error);
  }
  expect(
    reason,
    `the content assertion for "${slug}" ACCEPTED control #${index + 1}. It cannot distinguish a correct artifact from that one, so a green result here means nothing.`,
  ).not.toBeNull();
  const want = proof.rejectsBecause?.[index];
  if (want !== undefined) {
    expect(
      reason,
      `"${slug}" rejected control #${index + 1} for the wrong reason: the check it exists to falsify never ran, so that check has never been shown able to fail`,
    ).toContain(want);
  }
}

/* ------------------------------------------------------------------ *
 *  Shared driving helpers
 * ------------------------------------------------------------------ */

type FilePayload = { name: string; mimeType: string; buffer: Buffer };

/** Hydration-gated upload of generated bytes through the page's file picker. */
async function uploadPayloads(
  page: Page,
  files: FilePayload[] | string | string[],
): Promise<void> {
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles(files as never);
}

/** Generate a text PDF, stash its bytes in ctx, upload it, return the bytes. */
/** The grayscale proof's upload name, shared by its run and its assert. */
const GRAYSCALE_SOURCE = "colorful.pdf";

/**
 * A two-page grayscale-pdf artifact that is right in every respect but its
 * title: DeviceGray pages from the tool's own builder, with a mid-grey block
 * of ink over ~40% of each, saved as `title`.
 */
async function makeGrayArtifactTitled(
  title: string,
  [width, height]: [number, number],
): Promise<Buffer> {
  const builder = await createGrayscaleBuilder();
  for (let index = 0; index < 2; index++) {
    const plane = new Uint8Array(width * height).fill(255);
    for (let y = Math.floor(height * 0.2); y < height * 0.8; y++) {
      for (let x = Math.floor(width * 0.1); x < width * 0.8; x++) {
        plane[y * width + x] = 96;
      }
    }
    await builder.addPage(plane, {
      index,
      width,
      height,
      pageWidth: width,
      pageHeight: height,
    });
  }
  return Buffer.from(await builder.save(title));
}

async function uploadTextPdf(
  ctx: CaseContext,
  name: string,
  options: Parameters<typeof makeTextPdf>[1] = {},
): Promise<Buffer> {
  const bytes = Buffer.from(await makeTextPdf(name, options));
  ctx.data[name] = bytes;
  await uploadPayloads(ctx.page, [
    { name, mimeType: "application/pdf", buffer: bytes },
  ]);
  await expect(ctx.page.getByText(name, { exact: true })).toBeVisible();
  return bytes;
}

/** Click the run button, await the result heading, download via the CTA. */
async function runAndDownload(
  ctx: CaseContext,
  runName: RegExp,
  resultHeading: RegExp,
  ctaName: RegExp,
): Promise<Buffer> {
  const run = ctx.page.getByRole("button", { name: runName });
  await expect(run).toBeEnabled();
  await run.click();
  await expect(
    ctx.page.getByRole("heading", { name: resultHeading }),
  ).toBeVisible();
  return captureDownload(
    ctx.page,
    ctx.page.getByRole("button", { name: ctaName }),
  );
}

const input = (ctx: CaseContext, key: string): Buffer => {
  const bytes = ctx.data[key];
  if (!Buffer.isBuffer(bytes)) {
    throw new Error(`case did not stash input fixture "${key}"`);
  }
  return bytes;
};

/** Marker helper bound to a fixture file name. */
const marker = (name: string, page: number) => pageMarker(name, page);

/** The redact proof's page size, in points: makeTextPdf's default. */
const REDACT_PAGE: [number, number] = [320, 240];

/**
 * The redact proof's pixel checks, by the message each fails with. One
 * definition, read by the assertion AND by `rejectsBecause`, so each control
 * is pinned to the check it falsifies rather than to any throw.
 */
const REDACT_FAILS = {
  blankRender: "page 2 (no box) is blank — nothing was rendered",
  noInkUnderBox:
    "page 2 has no ink under the box's position — the white check on page 1 would prove nothing",
  unpainted: "the redaction box is not painted — the content under it survived",
  overpainted:
    "ink OUTSIDE the box is gone on page 1 — the redaction destroyed more than the box",
} as const;

function intersect(a: PointRect, b: PointRect): PointRect | null {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width);
  const y1 = Math.min(a.y + a.height, b.y + b.height);
  return x1 > x0 && y1 > y0
    ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
    : null;
}

/**
 * The regions the redact proof reads, derived from the two definitions they
 * describe — the runner's default box and the fixture's ink block — so moving
 * either moves the proof. Fails LOUDLY if they stop overlapping enough for the
 * proof to mean anything, instead of letting a region shrink into a vacuous
 * "at least 98% of nothing".
 */
function redactRegions(): {
  box: PointRect;
  overBlock: PointRect;
  blockOutsideBox: PointRect;
} {
  const box: PointRect = {
    x: DEFAULT_REDACTION_DRAFT.x,
    y: DEFAULT_REDACTION_DRAFT.y,
    width: DEFAULT_REDACTION_DRAFT.width,
    height: DEFAULT_REDACTION_DRAFT.height,
  };
  const block = inkBlockRect(REDACT_PAGE);
  const overBlock = intersect(box, block);
  if (
    !overBlock ||
    overBlock.width * overBlock.height < 0.5 * box.width * box.height
  ) {
    throw new Error(
      "redact proof precondition: the default box must sit mostly over the fixture's ink block, or a white box proves nothing",
    );
  }
  // The block's band above the box: fixture ink the box must NOT touch.
  const boxTop = box.y + box.height;
  const blockTop = block.y + block.height;
  const blockOutsideBox: PointRect = {
    x: block.x,
    y: boxTop,
    width: block.width,
    height: blockTop - boxTop,
  };
  if (blockOutsideBox.height < 6) {
    throw new Error(
      "redact proof precondition: the fixture's ink block must extend above the default box, or (c) has nothing to measure",
    );
  }
  return { box, overBlock, blockOutsideBox };
}

/**
 * US Letter, in points. Several runners default to stamp sizes scaled for a
 * real page (the watermark is 60pt), and a fixture smaller than the tool's own
 * defaults fails for reasons that have nothing to do with the engine.
 */
const LETTER: [number, number] = [612, 792];

/** The raster scale the pdf-to-image runner uses at its default resolution. */
const rasterScale = (): number =>
  rasterScaleForDpi(resolutionById(DEFAULT_RESOLUTION_ID).dpi);

/**
 * Assert a rendered raster matches the source page's geometry.
 *
 * Within one pixel, not exactly equal: the renderer FLOORS the viewport
 * dimensions (`Math.max(1, Math.floor(viewport.width))`), so a 320pt page at
 * the default scale lands on 666, while `Math.round(320 * scale)` is 667. The
 * first version of this assertion recomputed the expectation with `round` and
 * failed on a perfectly correct render. Recomputing it with the engine's own
 * helper instead would have "fixed" it by agreeing with whatever the engine
 * does — so the tolerance is stated here, and the aspect ratio (which no
 * rounding can move) is pinned exactly.
 */
function expectRasterSize(
  stats: { width: number; height: number },
  pageWidthPt: number,
  pageHeightPt: number,
): void {
  const scale = rasterScale();
  expect(Math.abs(stats.width - pageWidthPt * scale)).toBeLessThanOrEqual(1);
  expect(Math.abs(stats.height - pageHeightPt * scale)).toBeLessThanOrEqual(1);
  expect(stats.width / stats.height).toBeCloseTo(pageWidthPt / pageHeightPt, 2);
}

/* ------------------------------------------------------------------ *
 *  The cases
 * ------------------------------------------------------------------ */

/** Why a mixed JPG + PNG proof rejects an artifact, shared with its controls. */
const MIXED_IMAGES_PAGES = "one page per image: the JPG and the PNG";
const MIXED_IMAGES_FIRST = "page 1 is the JPEG, DCT-coded";
const MIXED_IMAGES_SECOND = "page 2 is the PNG, Flate-coded";

export const CASES: Record<string, ToolCase> = {
  "merge-pdf": {
    kind: "merge",
    artifact: "pdf",
    run: async (ctx) => {
      const alpha = Buffer.from(await makeTextPdf("alpha.pdf", { pages: 2 }));
      const beta = Buffer.from(await makeTextPdf("beta.pdf", { pages: 3 }));
      ctx.data["alpha.pdf"] = alpha;
      ctx.data["beta.pdf"] = beta;
      await uploadPayloads(ctx.page, [
        { name: "alpha.pdf", mimeType: "application/pdf", buffer: alpha },
        { name: "beta.pdf", mimeType: "application/pdf", buffer: beta },
      ]);
      await expect(
        ctx.page.getByText("beta.pdf", { exact: true }),
      ).toBeVisible();
      return runAndDownload(
        ctx,
        /merge 2 pdfs/i,
        /pdfs merged/i,
        /download merged pdf/i,
      );
    },
    assert: async (buf) => {
      expect(await pdfPageCount(buf)).toBe(5);
      const texts = await pdfPageTexts(buf);
      expect(texts[0]).toContain(marker("alpha.pdf", 1));
      expect(texts[2]).toContain(marker("beta.pdf", 1));
      expect(texts[4]).toContain(marker("beta.pdf", 3));
    },
    control: async (ctx) => input(ctx, "alpha.pdf"),
  },

  "split-pdf": {
    kind: "split",
    artifact: "zip",
    run: async (ctx) => {
      await uploadTextPdf(ctx, "quarters.pdf", { pages: 4 });
      // Default ranges for 4 pages are "1-2, 3-4" → two files → ZIP.
      return runAndDownload(
        ctx,
        /split into 2 files/i,
        /pdf split/i,
        /download zip \(2 files\)/i,
      );
    },
    assert: async (buf) => {
      const entries = await zipEntries(buf);
      expect(entries.size).toBe(2);
      const parts = [...entries.values()];
      expect(await pdfPageCount(parts[0]!)).toBe(2);
      expect(await pdfPageCount(parts[1]!)).toBe(2);
      expect((await pdfPageTexts(parts[0]!))[0]).toContain(
        marker("quarters.pdf", 1),
      );
      expect((await pdfPageTexts(parts[1]!))[0]).toContain(
        marker("quarters.pdf", 3),
      );
    },
    // A ZIP, not the input PDF: handing this assertion a PDF proves only that
    // the download was an archive. This control IS an archive — of one
    // untouched 4-page document — so the entry count and the per-part page
    // counts are what has to reject it.
    control: async (ctx) => {
      const zip = new JSZip();
      zip.file("quarters.pdf", input(ctx, "quarters.pdf"));
      return zip.generateAsync({ type: "nodebuffer" });
    },
  },

  "rotate-pdf": {
    kind: "rotate",
    artifact: "pdf",
    run: async (ctx) => {
      // A document with something to lose: bookmarks, a filled form field,
      // Title/Author, page labels, /Lang and tag markers. The plain text PDF
      // this case used to upload had none of them, so it stayed green while
      // the tool rebuilt every file and deleted all of them.
      const doc = await PDFDocument.load(
        await makeTextPdf("spin.pdf", { pages: 3 }),
      );
      await addDocumentStructure(doc);
      const bytes = Buffer.from(await doc.save());
      ctx.data["spin.pdf"] = bytes;
      await uploadPayloads(ctx.page, [
        { name: "spin.pdf", mimeType: "application/pdf", buffer: bytes },
      ]);
      await expect(
        ctx.page.getByText("spin.pdf", { exact: true }),
      ).toBeVisible();
      // All pages are selected by default; one "Right" rotates them all 90°.
      await ctx.page.getByRole("button", { name: /^right$/i }).click();
      return runAndDownload(
        ctx,
        /apply rotation/i,
        /pdf rotated/i,
        /download rotated pdf/i,
      );
    },
    assert: async (buf, ctx) => {
      expect(await pdfRotations(buf)).toEqual([90, 90, 90]);
      const before = await readDocumentStructure(input(ctx, "spin.pdf"));
      // Health check: the upload carried structure, so "nothing lost" means
      // something rather than holding over an empty walk.
      expect(before.catalog.size).toBeGreaterThanOrEqual(6);
      expect(before.fields.size).toBe(1);
      expect(
        lostStructure(before, await readDocumentStructure(buf)),
        "members of the uploaded PDF missing from the rotated download",
      ).toEqual([]);
    },
    // Two properties, two controls. The untouched input has every member but
    // no rotation. The rebuild the tool used to ship has the right rotation
    // and lost the structure — it differs from a correct artifact ONLY in
    // what it dropped, so it is what keeps the structure half falsifiable.
    //
    // That rebuild was made with the app's own organizePages(). Its plan here
    // keeps every page once, in order, and since L01 (9a4c5c26, `removesNothing`)
    // such a plan takes organizePages' IN-PLACE path: no copy at all, so the
    // "lossy" control lost nothing and the assertion ACCEPTED it (2026-10-08,
    // integration e2e). Organize's rebuild path still drops the tag tree, as its
    // page says. A control built by the engine under test moves when the engine
    // is fixed. This one is plain pdf-lib: copyPages into a fresh document,
    // which is what the old tool did and still drops every catalog, Info and
    // form member the upload carries.
    control: async (ctx) => {
      const original = input(ctx, "spin.pdf");
      const source = await PDFDocument.load(original);
      const fresh = await PDFDocument.create();
      for (const page of await fresh.copyPages(source, [0, 1, 2])) {
        page.setRotation(degrees(90));
        fresh.addPage(page);
      }
      return [original, Buffer.from(await fresh.save())];
    },
  },

  "remove-pages": {
    kind: "delete-pages",
    artifact: "pdf",
    run: async (ctx) => {
      await uploadTextPdf(ctx, "trim.pdf", { pages: 3 });
      await ctx.page.getByRole("button", { name: "Page 2" }).click();
      return runAndDownload(
        ctx,
        /delete 1 page/i,
        /pages removed/i,
        /^download pdf$/i,
      );
    },
    assert: async (buf) => {
      expect(await pdfPageCount(buf)).toBe(2);
      const texts = await pdfPageTexts(buf);
      expect(texts[0]).toContain(marker("trim.pdf", 1));
      expect(texts[1]).toContain(marker("trim.pdf", 3));
      expect(texts.join(" ")).not.toContain(marker("trim.pdf", 2));
    },
    control: async (ctx) => input(ctx, "trim.pdf"),
  },

  "extract-pages": {
    kind: "extract-pages",
    artifact: "pdf",
    run: async (ctx) => {
      await uploadTextPdf(ctx, "pick.pdf", { pages: 3 });
      await ctx.page.getByRole("button", { name: "Page 1" }).click();
      await ctx.page.getByRole("button", { name: "Page 3" }).click();
      return runAndDownload(
        ctx,
        /extract 2 pages/i,
        /pages extracted/i,
        /^download pdf$/i,
      );
    },
    assert: async (buf) => {
      expect(await pdfPageCount(buf)).toBe(2);
      const texts = await pdfPageTexts(buf);
      expect(texts[0]).toContain(marker("pick.pdf", 1));
      expect(texts[1]).toContain(marker("pick.pdf", 3));
    },
    control: async (ctx) => input(ctx, "pick.pdf"),
  },

  "organize-pages": {
    kind: "organize",
    artifact: "pdf",
    run: async (ctx) => {
      await uploadTextPdf(ctx, "shuffle.pdf", { pages: 3 });
      await ctx.page.getByRole("button", { name: "Reverse" }).click();
      return runAndDownload(
        ctx,
        /apply.*export/i,
        /pages organized/i,
        /download organized pdf/i,
      );
    },
    assert: async (buf) => {
      expect(await pdfPageCount(buf)).toBe(3);
      const texts = await pdfPageTexts(buf);
      expect(texts[0]).toContain(marker("shuffle.pdf", 3));
      expect(texts[2]).toContain(marker("shuffle.pdf", 1));
    },
    control: async (ctx) => input(ctx, "shuffle.pdf"),
  },

  "compress-pdf": {
    kind: "compress",
    artifact: "pdf",
    run: async (ctx) => {
      // Saved WITHOUT object streams so the analyzer's lossless repack has a
      // real, deterministic saving to offer — otherwise the only download is
      // the file unchanged ("Download unchanged PDF").
      await uploadTextPdf(ctx, "bulky.pdf", {
        pages: 4,
        unoptimized: true,
        bodyLines: Array.from({ length: 30 }, (_, i) => {
          return `filler line ${i} — repack me repack me repack me`;
        }),
      });
      const cta = ctx.page.getByRole("button", {
        name: /download optimized pdf/i,
      });
      await expect(cta).toBeVisible();
      return captureDownload(ctx.page, cta);
    },
    assert: async (buf, ctx) => {
      expect(await pdfPageCount(buf)).toBe(4);
      expect(buf.byteLength).toBeLessThan(input(ctx, "bulky.pdf").byteLength);
      expect((await pdfPageTexts(buf))[0]).toContain(marker("bulky.pdf", 1));
    },
    control: async (ctx) => input(ctx, "bulky.pdf"),
  },

  "pdf-to-text": {
    kind: "pdf-to-text",
    artifact: "text",
    run: async (ctx) => {
      await uploadTextPdf(ctx, "prose.pdf", { pages: 2 });
      return runAndDownload(
        ctx,
        /^extract text$/i,
        /text extracted/i,
        /download txt/i,
      );
    },
    assert: async (buf) => {
      const text = buf.toString("utf8");
      // Not a leaked container. The input PDF stores its (uncompressed)
      // content streams with these markers embedded, so the format check is
      // what makes the identity control fail — then the content check makes
      // a wrong extraction fail.
      expect(text).not.toContain("%PDF-");
      expect(text).not.toContain("endstream");
      expect(text).toContain(marker("prose.pdf", 1));
      expect(text).toContain(marker("prose.pdf", 2));
    },
    control: async (ctx) => input(ctx, "prose.pdf"),
  },

  "pdf-to-markdown": {
    kind: "pdf-to-markdown",
    artifact: "text",
    run: async (ctx) => {
      // Its own fixture, not `uploadTextPdf`: that one draws a single line per
      // page, so a converter that collapsed every page into ONE paragraph
      // passed this proof — there was no second block on the page to lose.
      const bytes = Buffer.from(
        await makeStructuredProsePdf("notes.pdf", { pages: 2 }),
      );
      ctx.data["notes.pdf"] = bytes;
      await uploadPayloads(ctx.page, [
        { name: "notes.pdf", mimeType: "application/pdf", buffer: bytes },
      ]);
      await expect(
        ctx.page.getByText("notes.pdf", { exact: true }),
      ).toBeVisible();
      return runAndDownload(
        ctx,
        /create markdown/i,
        /markdown created/i,
        /download md/i,
      );
    },
    assert: async (buf) => {
      const text = buf.toString("utf8");
      expect(text).not.toContain("%PDF-");
      expect(text).not.toContain("endstream");
      // Every heading, paragraph and list item of both pages is its own
      // block — read from the downloaded text the way a renderer splits it.
      expect(structuredProseProblems(text, "notes.pdf", 2)).toEqual([]);
    },
    // The identity control fails on the container; the collapsed control is
    // the pre-geometry output — every word present, every boundary gone —
    // and fails only on structure.
    control: async (ctx) => [
      input(ctx, "notes.pdf"),
      Buffer.from(collapsedStructuredProse("notes.pdf", 2)),
    ],
  },

  "text-to-pdf": {
    kind: "text-to-pdf",
    artifact: "pdf",
    run: async (ctx) => {
      const body = "text-to-pdf-proof :: the quick brown fox";
      ctx.data.body = body;
      await ctx.page
        .getByPlaceholder("Paste or type plain text here…")
        .fill(body);
      return runAndDownload(
        ctx,
        /create pdf/i,
        /pdf created/i,
        /^download pdf$/i,
      );
    },
    assert: async (buf, ctx) => {
      // Normalized: pdfjs returned this line as "the quick brown   fox",
      // splitting one drawn string into separate positioned runs. The claim is
      // that the typed text reached the page, not that the kerning survived.
      expect(normalizeText((await pdfPageTexts(buf)).join(" "))).toContain(
        normalizeText(String(ctx.data.body)),
      );
    },
    // No input file exists; the control is a valid PDF without the typed text.
    control: async () => Buffer.from(await makeTextPdf("unrelated.pdf")),
  },

  "markdown-to-pdf": {
    kind: "markdown-to-pdf",
    artifact: "pdf",
    run: async (ctx) => {
      const heading = "Markdown Proof Heading";
      // A snake_case word and an inline code span: the old inline stripper
      // printed this line as "markdownbodyproof MAXSIZE line". What is
      // expected is what a reader should see, not what was typed.
      const body = "markdown_body_proof `MAX_SIZE` line";
      ctx.data.heading = heading;
      ctx.data.body = "markdown_body_proof MAX_SIZE line";
      ctx.data.cellKey = "proof_cell_key";
      ctx.data.cellValue = "proof_cell_value";
      ctx.data.nested = "nested_proof_child";
      await ctx.page
        .locator("textarea")
        .fill(
          [
            `# ${heading}`,
            "",
            body,
            "",
            "| Key | Value |",
            "| --- | ----- |",
            `| ${ctx.data.cellKey} | ${ctx.data.cellValue} |`,
            "",
            "- parent_proof_item",
            `  - ${ctx.data.nested}`,
          ].join("\n"),
        );
      return runAndDownload(
        ctx,
        /create pdf/i,
        /pdf created/i,
        /^download pdf$/i,
      );
    },
    assert: async (buf, ctx) => {
      const text = normalizeText((await pdfPageTexts(buf)).join(" "));
      expect(text).toContain(normalizeText(String(ctx.data.heading)));
      expect(text).toContain(normalizeText(String(ctx.data.body)));
      expect(text).toContain(String(ctx.data.cellKey));
      expect(text).toContain(String(ctx.data.cellValue));
      expect(text).toContain(String(ctx.data.nested));
      // The table is drawn as a grid, not printed as its own syntax.
      expect(text).not.toMatch(/\|\s*-{3,}|(?:^|\s)-{3,}(?:\s|$)/);
    },
    control: async () => Buffer.from(await makeTextPdf("unrelated.pdf")),
  },

  "jpg-to-pdf": {
    kind: "image-to-pdf",
    artifact: "pdf",
    // A JPG and a PNG in ONE upload, because that is the defect this case
    // was widened for (2026-10-09): until 2026-10-08 JPG to PDF kept only
    // JPEGs, so a mixed pair came back as a 1-page PDF and the PNG was
    // dropped without a word. The PNG is a different size from the JPEG, so
    // a page holding the wrong image cannot pass on its dimensions.
    run: async (ctx) => {
      const jpeg = await makeJpegFixtureInPage(ctx.page, "photo.jpg");
      const png = makePngFixture("art.png", 240, 160);
      ctx.data["photo.jpg"] = jpeg.bytes;
      ctx.data["art.png"] = png.bytes;
      ctx.data.jpgWidth = jpeg.width;
      ctx.data.jpgHeight = jpeg.height;
      ctx.data.pngWidth = png.width;
      ctx.data.pngHeight = png.height;
      await uploadPayloads(ctx.page, [
        { name: "photo.jpg", mimeType: "image/jpeg", buffer: jpeg.bytes },
        { name: "art.png", mimeType: "image/png", buffer: png.bytes },
      ]);
      await expect(
        ctx.page.getByText("photo.jpg", { exact: true }),
      ).toBeVisible();
      await expect(
        ctx.page.getByText("art.png", { exact: true }),
      ).toBeVisible();
      return runAndDownload(
        ctx,
        /create pdf/i,
        /jpg pdf created/i,
        /^download pdf$/i,
      );
    },
    assert: async (buf, ctx) => {
      const pages = await pdfPageImages(buf);
      expect(pages.length, MIXED_IMAGES_PAGES).toBe(2);
      const [first, second] = pages.map((images) => images[0]);
      // Page 1: the JPEG stream itself, DCT-coded, at its native size.
      expect(first?.filter, MIXED_IMAGES_FIRST).toContain("DCTDecode");
      expect(first?.width).toBe(Number(ctx.data.jpgWidth));
      expect(first?.height).toBe(Number(ctx.data.jpgHeight));
      // Page 2: the PNG, Flate-coded (not re-encoded as a JPEG), native size.
      expect(second?.filter, MIXED_IMAGES_SECOND).toContain("FlateDecode");
      expect(second?.width).toBe(Number(ctx.data.pngWidth));
      expect(second?.height).toBe(Number(ctx.data.pngHeight));
    },
    // Three near misses, each differing from the true artifact in ONE way:
    //  1. the old defect — the PNG dropped, one page holding the JPEG;
    //  2. both pages DCT — the PNG re-encoded as a JPEG on the way in;
    //  3. the right images in the wrong order.
    control: async (ctx) => {
      const jpg = {
        bytes: ctx.data["photo.jpg"] as Buffer,
        format: "jpg" as const,
      };
      const png = {
        bytes: ctx.data["art.png"] as Buffer,
        format: "png" as const,
      };
      return [
        Buffer.from(await makeImagePagesPdf([jpg])),
        Buffer.from(await makeImagePagesPdf([jpg, jpg])),
        Buffer.from(await makeImagePagesPdf([png, jpg])),
      ];
    },
    rejectsBecause: [
      MIXED_IMAGES_PAGES,
      MIXED_IMAGES_SECOND,
      MIXED_IMAGES_FIRST,
    ],
  },

  "png-to-pdf": {
    kind: "image-to-pdf",
    artifact: "pdf",
    run: async (ctx) => {
      const png = makePngFixture("art.png");
      ctx.data["art.png"] = png.bytes;
      ctx.data.imageWidth = png.width;
      ctx.data.imageHeight = png.height;
      await uploadPayloads(ctx.page, [
        { name: "art.png", mimeType: "image/png", buffer: png.bytes },
      ]);
      await expect(
        ctx.page.getByText("art.png", { exact: true }),
      ).toBeVisible();
      return runAndDownload(
        ctx,
        /create pdf/i,
        /png pdf created/i,
        /^download pdf$/i,
      );
    },
    assert: async (buf, ctx) => {
      expect(await pdfPageCount(buf)).toBe(1);
      const images = await pdfImages(buf);
      expect(images.length).toBeGreaterThanOrEqual(1);
      const embedded = images[0]!;
      expect(embedded.width).toBe(Number(ctx.data.imageWidth));
      expect(embedded.height).toBe(Number(ctx.data.imageHeight));
    },
    control: async () => [
      Buffer.from(await makeTextPdf("no-image.pdf")),
      Buffer.from((await makeImageBearingPdf("other-image.pdf")).pdf),
    ],
  },

  "pdf-to-jpg": {
    kind: "pdf-to-image",
    artifact: "jpg",
    run: async (ctx) => {
      await uploadTextPdf(ctx, "poster.pdf", { pages: 1 });
      return runAndDownload(
        ctx,
        /render 1 page/i,
        /1 jpg image ready/i,
        /^download jpg$/i,
      );
    },
    assert: async (buf, ctx) => {
      expectMagic(buf, "jpg");
      const stats = await decodeImageInPage(ctx.page, buf, "image/jpeg");
      expectRasterSize(stats, 320, 240);
      // The fixture's black rectangle covers ~17% of the page. A well-formed
      // but BLANK render (the wasmUrl defect class) fails here.
      expect(stats.inkPixels / stats.totalPixels).toBeGreaterThan(0.1);
    },
    // A blank JPEG at the RIGHT size, not the input PDF: the container check
    // would reject a PDF on its own, which would prove only that the download
    // was a JPEG. This control differs from a correct artifact in exactly one
    // property — whether the page was actually drawn.
    control: async (ctx) =>
      makeBlankImageInPage(
        ctx.page,
        "image/jpeg",
        Math.round(320 * rasterScale()),
        Math.round(240 * rasterScale()),
      ),
  },

  "pdf-to-png": {
    kind: "pdf-to-image",
    artifact: "png",
    run: async (ctx) => {
      await uploadTextPdf(ctx, "plate.pdf", { pages: 1 });
      return runAndDownload(
        ctx,
        /render 1 page/i,
        /1 png image ready/i,
        /^download png$/i,
      );
    },
    assert: async (buf, ctx) => {
      expectMagic(buf, "png");
      const stats = await decodeImageInPage(ctx.page, buf, "image/png");
      expectRasterSize(stats, 320, 240);
      expect(stats.inkPixels / stats.totalPixels).toBeGreaterThan(0.1);
    },
    control: async (ctx) =>
      makeBlankImageInPage(
        ctx.page,
        "image/png",
        Math.round(320 * rasterScale()),
        Math.round(240 * rasterScale()),
      ),
  },

  "page-numbers": {
    kind: "page-numbers",
    artifact: "pdf",
    run: async (ctx) => {
      await uploadTextPdf(ctx, "paged.pdf", { pages: 3 });
      // A non-default option, driven through the disclosure the page shows:
      // the cover is counted but not stamped. Until 2026-10-24 this case ran
      // the defaults only, so an option the runner dropped on the way to the
      // engine could not turn it red.
      await ctx.page
        .getByRole("button", { name: /pages, font and color/i })
        .click();
      await ctx.page
        .getByRole("checkbox", { name: /leave the cover unnumbered/i })
        .check();
      return runAndDownload(
        ctx,
        /add page numbers/i,
        /page numbers added/i,
        /download numbered pdf/i,
      );
    },
    assert: async (buf) => {
      const texts = await pdfPageTexts(buf);
      expect(texts.length).toBe(3);
      expect(normalizeText(texts[0]!), "the cover is unnumbered").not.toMatch(
        /Page \d+ of/,
      );
      expect(texts[1]).toContain("Page 2 of 3");
      expect(texts[2]).toContain("Page 3 of 3");
    },
    // The input (no numbers at all), and the DEFAULT run — numbered from the
    // cover — which differs from the right artifact only in the option this
    // case drives.
    control: async (ctx) => [
      input(ctx, "paged.pdf"),
      Buffer.from(await addPageNumbers(input(ctx, "paged.pdf"))),
    ],
    rejectsBecause: ["Page 2 of 3", "the cover is unnumbered"],
  },

  "watermark-pdf": {
    kind: "watermark",
    artifact: "pdf",
    run: async (ctx) => {
      // LETTER, not the 320x240 default. History: the runner's default
      // watermark is 60pt "CONFIDENTIAL" — about 480pt wide — and the engine
      // used to draw it at that size on any page, so on the small fixture it
      // hung off both edges and pdfjs (which omits glyphs outside the page box
      // from getTextContent) extracted "NFIDENTIAL" at tilt 45 and
      // "ONFIDENTIA" at tilt 0. This comment called that a fixture too small
      // for the defaults, not an engine defect. It WAS an engine defect — a
      // real A6 page or a long company name hit it — and the engine now
      // shrinks the text to fit each page's visible box and the result panel
      // says how many pages it shrank (src/lib/pdf/watermark.test.ts sweeps
      // every pdf-lib page size through pdfjs). LETTER stays so this proof
      // exercises the unshrunk, full-size path; asserting a truncated string
      // would still pin the wrong behaviour.
      await uploadTextPdf(ctx, "stamped.pdf", { pages: 3, size: LETTER });
      // Default watermark text is CONFIDENTIAL; the fixture never contains it.
      // Two non-default options (2026-10-24): Tile, and Selected pages 2-3,
      // so page 1 must come back clean and pages 2-3 must carry several
      // whole copies.
      await ctx.page
        .getByRole("checkbox", { name: /tile across the page/i })
        .check();
      await ctx.page.getByRole("button", { name: /pages and layer/i }).click();
      await ctx.page.getByRole("radio", { name: /selected pages/i }).click();
      await ctx.page.getByLabel(/^pages \(1–3\)/i).fill("2-3");
      return runAndDownload(
        ctx,
        /add watermark/i,
        /watermark added/i,
        /download watermarked pdf/i,
      );
    },
    assert: async (buf) => {
      const texts = await pdfPageTexts(buf);
      expect(texts.length).toBe(3);
      const copies = (text: string) =>
        normalizeText(text).split("CONFIDENTIAL").length - 1;
      expect(copies(texts[0]!), "page 1 was not listed").toBe(0);
      // Listed pages, whole word, more than once — a tile that collapsed to
      // the single centred mark, or a list that stamped page 2 only, fails.
      for (const index of [1, 2]) {
        expect(
          copies(texts[index]!),
          `tiled on page ${index + 1}`,
        ).toBeGreaterThan(1);
      }
      for (const [index, text] of texts.entries()) {
        expect(normalizeText(text)).toContain(marker("stamped.pdf", index + 1));
      }
    },
    // The input (no mark), the default run (every page, one copy each), and
    // a tiled run on every page: each differs from the right artifact in one
    // of the two options this case drives.
    control: async (ctx) => [
      input(ctx, "stamped.pdf"),
      Buffer.from(
        await addWatermark(input(ctx, "stamped.pdf"), "CONFIDENTIAL"),
      ),
      Buffer.from(
        await addWatermark(input(ctx, "stamped.pdf"), "CONFIDENTIAL", {
          position: "tile",
        }),
      ),
    ],
    rejectsBecause: [
      "tiled on page 2",
      "page 1 was not listed",
      "page 1 was not listed",
    ],
  },

  "header-footer": {
    kind: "header-footer",
    artifact: "pdf",
    run: async (ctx) => {
      await uploadTextPdf(ctx, "framed.pdf", { pages: 2 });
      await ctx.page.getByLabel("Header text").fill("E2E-HEADER-MARK");
      // Default footer stays "Page {n} of {total}".
      return runAndDownload(
        ctx,
        /add header & footer/i,
        /header & footer added/i,
        /^download pdf$/i,
      );
    },
    assert: async (buf) => {
      const texts = await pdfPageTexts(buf);
      expect(texts[0]).toContain("E2E-HEADER-MARK");
      expect(texts[0]).toContain("Page 1 of 2");
      expect(texts[1]).toContain("Page 2 of 2");
    },
    control: async (ctx) => input(ctx, "framed.pdf"),
  },

  "crop-pdf": {
    kind: "crop",
    artifact: "pdf",
    run: async (ctx) => {
      await uploadTextPdf(ctx, "trimmed.pdf", { pages: 2 });
      // Default margins: 24pt on every side.
      return runAndDownload(
        ctx,
        /^crop pdf$/i,
        /pdf cropped/i,
        /download cropped pdf/i,
      );
    },
    assert: async (buf) => {
      const boxes = await pdfCropBoxes(buf);
      expect(boxes.length).toBe(2);
      for (const box of boxes) {
        expect(box.width).toBeCloseTo(320 - 48, 1);
        expect(box.height).toBeCloseTo(240 - 48, 1);
      }
    },
    control: async (ctx) => input(ctx, "trimmed.pdf"),
  },

  "sign-pdf": {
    kind: "sign",
    artifact: "pdf",
    run: async (ctx) => {
      await uploadTextPdf(ctx, "contract.pdf", { pages: 1 });
      // The runner defaults to the "Type" source precisely so signing works
      // without a pointer; the drawn-signature path stays a named gap.
      await ctx.page.getByLabel("Your signature").fill("Ada Sign-Proof");
      return runAndDownload(
        ctx,
        /^sign pdf$/i,
        /pdf signed/i,
        /download signed pdf/i,
      );
    },
    assert: async (buf) => {
      expect((await pdfPageTexts(buf))[0]).toContain("Ada Sign-Proof");
    },
    control: async (ctx) => input(ctx, "contract.pdf"),
  },

  "flatten-pdf": {
    kind: "flatten",
    artifact: "pdf",
    run: async (ctx) => {
      const bytes = Buffer.from(await makeFormPdf("form.pdf"));
      ctx.data["form.pdf"] = bytes;
      await uploadPayloads(ctx.page, [
        { name: "form.pdf", mimeType: "application/pdf", buffer: bytes },
      ]);
      await expect(
        ctx.page.getByText(/found 2 fillable form fields/i),
      ).toBeVisible();
      return runAndDownload(
        ctx,
        /flatten form fields/i,
        /form fields flattened/i,
        /download flattened pdf/i,
      );
    },
    assert: async (buf) => {
      const form = await pdfFormSnapshot(buf);
      expect(form.fieldNames).toEqual([]);
      // The value is baked into static page content, not lost.
      expect((await pdfPageTexts(buf))[0]).toContain("Ada Lovelace");
    },
    control: async (ctx) => input(ctx, "form.pdf"),
  },

  "overlay-pdf": {
    kind: "overlay",
    artifact: "pdf",
    run: async (ctx) => {
      await uploadTextPdf(ctx, "base.pdf", { pages: 2 });
      const stamp = Buffer.from(
        await makeTextPdf("letterhead.pdf", { pages: 1 }),
      );
      ctx.data["letterhead.pdf"] = stamp;
      // The base dropzone is gone once the base PDF loads; the remaining
      // picker belongs to the overlay zone.
      await uploadPayloads(ctx.page, [
        { name: "letterhead.pdf", mimeType: "application/pdf", buffer: stamp },
      ]);
      await expect(
        ctx.page.getByText("letterhead.pdf", { exact: true }),
      ).toBeVisible();
      return runAndDownload(
        ctx,
        /overlay onto 2 pages/i,
        /overlay applied/i,
        /download overlaid pdf/i,
      );
    },
    assert: async (buf) => {
      expect(await pdfPageCount(buf)).toBe(2);
      const texts = await pdfPageTexts(buf);
      expect(texts[0]).toContain(marker("base.pdf", 1));
      expect(texts[0]).toContain(marker("letterhead.pdf", 1));
      expect(texts[1]).toContain(marker("base.pdf", 2));
      expect(texts[1]).toContain(marker("letterhead.pdf", 1));
    },
    control: async (ctx) => input(ctx, "base.pdf"),
  },

  "grayscale-pdf": {
    kind: "grayscale",
    artifact: "pdf",
    run: async (ctx) => {
      // A COLOUR fixture. With the default black-ink fixture "the output has
      // no colour" is already true of the input, so the assertion would pass
      // on an engine that did nothing to the pixels.
      //
      // It carries its own /Title, so the output's title is exercised on the
      // source-title branch, read by pdf.js in the browser: the one hop of the
      // title chain the Node tests do not run in a real browser engine.
      await uploadTextPdf(ctx, GRAYSCALE_SOURCE, {
        pages: 2,
        colorful: true,
        title: "Colour Proof Sheet",
      });
      return runAndDownload(
        ctx,
        /convert to grayscale/i,
        /grayscale pdf ready/i,
        /download grayscale pdf/i,
      );
    },
    assert: async (buf, ctx) => {
      expect(await pdfPageCount(buf)).toBe(2);
      // Genuinely rasterized: page content became embedded images and the
      // input's selectable text is gone.
      const images = await pdfImages(buf);
      expect(images.length).toBeGreaterThanOrEqual(2);
      const texts = await pdfPageTexts(buf);
      expect(texts.join("").trim()).toBe("");

      // The pixels, not just the structure. "Contains images and no text" is
      // equally true of two blank white pages — which is exactly what the
      // pdfjs wasmUrl defect produced through this same rasterizer. Every page
      // image is decoded, whether it was stored as a JPEG or a Flate plane.
      const stats = await decodeEmbeddedPageImages(ctx.page, buf);
      expect(stats.length).toBeGreaterThanOrEqual(2);
      for (const page of stats) {
        // Ink: the drawn blocks cover ~35% of the page and go mid-grey.
        expect(
          (page.totalPixels - page.whitePixels) / page.totalPixels,
          "the rendered page is blank",
        ).toBeGreaterThan(0.1);
        // And it is grey: the red and blue blocks must have lost their hue.
        expect(
          (page.redPixels + page.bluePixels) / page.totalPixels,
          "saturated colour survived a grayscale conversion",
        ).toBeLessThan(0.01);
      }

      // And the file DECLARES itself grayscale. Neutral pixels in a DeviceRGB
      // image pass both checks above — that is what this tool shipped until
      // its pages became DeviceGray — and a print driver, a print shop's
      // preflight or Acrobat's Output Preview still calls that file colour.
      // Checked LAST so the two controls above still fail on their own
      // property rather than on this one.
      for (const image of images) {
        expect(image.colorSpace, "a page image is not DeviceGray").toBe(
          "/DeviceGray",
        );
        if (image.filter?.includes("DCTDecode")) {
          expect(
            jpegComponentCount(image.bytes),
            "a DeviceGray JPEG whose frame header is not one-component",
          ).toBe(1);
        }
      }

      // And it is titled after what was uploaded, not "Grayscale PDF" like
      // every output before it. Derived from the bytes this run uploaded, so
      // the expectation cannot drift from the fixture. Checked after the
      // colour-space block so the first three controls keep failing on their
      // own property.
      const source = ctx.data[GRAYSCALE_SOURCE];
      if (!Buffer.isBuffer(source))
        throw new Error("the uploaded source's bytes were not recorded");
      const sourceTitle = (await PDFDocument.load(source)).getTitle();
      expect(
        sourceTitle,
        "the source carries no /Title, so only the file-name fallback is exercised",
      ).toBeTruthy();
      const title = (await PDFDocument.load(buf)).getTitle();
      expect(title, "the output lost the source's title").toContain(
        sourceTitle,
      );
      expect(title).toBe(grayscaleTitle(sourceTitle, GRAYSCALE_SOURCE));
    },
    // Four controls, one per claimed property: a rasterized output that
    // rendered nothing, one that kept its colour, one that LOOKS grey but is a
    // three-component (DeviceRGB) image — the pre-fix pages exactly — and a
    // correct DeviceGray artifact carrying the pre-fix title.
    control: async (ctx) => {
      const size: [number, number] = [320, 240];
      const colour = await makeJpegFixtureInPage(
        ctx.page,
        "colour-control.jpg",
        320,
        240,
      );
      return [
        await makeRasterizedPdf(
          await makeBlankImageInPage(ctx.page, "image/jpeg", 320, 240),
          2,
          size,
        ),
        await makeRasterizedPdf(colour.bytes, 2, size),
        await makeRasterizedPdf(
          await makeNeutralInkJpegInPage(ctx.page, 320, 240),
          2,
          size,
        ),
        await makeGrayArtifactTitled(grayscaleTitle(null, undefined), size),
      ];
    },
  },

  "redact-pdf": {
    kind: "redact",
    artifact: "pdf",
    run: async (ctx) => {
      await uploadTextPdf(ctx, "secret.pdf", { pages: 2, size: REDACT_PAGE });
      // WHITE, deliberately. The fixture's black block sits under most of the
      // default box, so a black fill cannot be told from a box that was never
      // painted — that is exactly how the previous version of this proof
      // passed with no paint at all. White over black can only come from the
      // paint. (The black fill's paint is pinned by
      // src/lib/pdf/redact-paint.test.ts, which reads the canvas directly.)
      const white = ctx.page
        .getByRole("radiogroup", { name: /redaction fill/i })
        .getByRole("radio", { name: /^white$/i });
      await white.click();
      await expect(white).toHaveAttribute("aria-checked", "true");
      const addArea = ctx.page.getByRole("button", { name: /add area/i });
      await expect(addArea).toBeEnabled();
      await addArea.click();
      await expect(
        ctx.page.getByRole("button", { name: /remove redaction area 1/i }),
      ).toBeVisible();
      return runAndDownload(
        ctx,
        /^redact pdf$/i,
        /redacted pdf ready/i,
        /download redacted pdf/i,
      );
    },
    assert: async (buf, ctx) => {
      expect(await pdfPageCount(buf)).toBe(2);
      // Redaction rasterizes: no selectable text may survive (that is the
      // guarantee), and each page must carry a real rendered image.
      const texts = await pdfPageTexts(buf);
      expect(texts.join("").trim()).toBe("");
      expect((await pdfImages(buf)).length).toBeGreaterThanOrEqual(2);

      // "No text and some images" also describes two blank pages, and whole-
      // page ink counts describe the FIXTURE: its own black block is 17% of
      // the page and sits under the default box, so they passed with the paint
      // deleted. Every check below is about a REGION, located from the
      // runner's own default box and the fixture's own block definition.
      const { box, overBlock, blockOutsideBox } = redactRegions();
      // Inset 8px: one JPEG block. The box borders the fixture's black block
      // on two sides, and DCT ringing stays inside the 8x8 block that holds
      // the edge — a 3px inset would let it decide the 98% verdict.
      const [first, second] = await decodePageRegions(
        ctx.page,
        buf,
        [box, overBlock, blockOutsideBox],
        8,
      );
      if (!first || !second) throw new Error("expected two decoded pages");
      const ratio = (n: number, of: { totalPixels: number }) =>
        n / of.totalPixels;

      // Page 2 has no box: it was rendered, and the fixture's ink really is
      // where the box goes. Without this, (a) could pass on a blank render.
      expect(
        ratio(
          second.whole.totalPixels - second.whole.whitePixels,
          second.whole,
        ),
        REDACT_FAILS.blankRender,
      ).toBeGreaterThan(0.1);
      expect(
        ratio(second.regions[1]!.inkPixels, second.regions[1]!),
        REDACT_FAILS.noInkUnderBox,
      ).toBeGreaterThan(0.9);

      // (a) The box: on page 1 it is the chosen fill, over ink that page 2
      //     shows is there. A no-op paint leaves it ~80% black.
      const onBox = first.regions[0]!;
      expect(
        ratio(onBox.whitePixels, onBox),
        REDACT_FAILS.unpainted,
      ).toBeGreaterThan(0.98);

      // (c) Only the box changed: the fixture's block, where it sticks out of
      //     the box, is still solid ink on page 1. Catches a paint that
      //     whitewashed the page, and a render that produced nothing.
      const outside = first.regions[2]!;
      expect(
        ratio(outside.inkPixels, outside),
        REDACT_FAILS.overpainted,
      ).toBeGreaterThan(0.9);
    },
    // One control per property, each run through the assertion above:
    //  1. a well-formed 2-page raster that rendered nothing;
    //  2. the fixture rendered faithfully with NO box painted — the output of
    //     a no-op paint, and what the old whole-page ink checks accepted;
    //  3. page 1 whitewashed entirely (box "painted" over everything), page 2
    //     faithful — (a) and page 2's checks pass, so only (c) can reject it.
    // Each carries one image PER PAGE, like the real output, at the real
    // output's px/pt scale. Both were once wrong, and both times the control
    // was still "rejected" — for a reason that says nothing about rendering:
    //  - one image shared across both pages tripped the "at least two
    //    images" check before any pixel was read;
    //  - then a 320x240 px blank for a 320x240 pt page (1 px/pt) left the
    //    12pt band of region (c) at 12 px, which the 8px inset on each side
    //    shrinks to nothing, so decodePageRegions threw "covers no pixels"
    //    and the page-2 blank check below it never ran.
    // `rejectsBecause` now pins each control to its check's message, so a
    // control that dies on a precondition is red, not "rejected".
    control: async (ctx) => {
      const scale = 150 / 72;
      const unpainted = await makeRasterPageInPage(
        ctx.page,
        REDACT_PAGE,
        scale,
        [{ rect: inkBlockRect(REDACT_PAGE), color: "#000000" }],
      );
      const whitewashed = await makeRasterPageInPage(
        ctx.page,
        REDACT_PAGE,
        scale,
        [],
      );
      // A well-formed render of nothing: the same all-white page as
      // `whitewashed`, on BOTH pages, so page 2's own checks must reject it.
      return [
        await makeRasterizedPdf([whitewashed, whitewashed], 2, REDACT_PAGE),
        await makeRasterizedPdf([unpainted, unpainted], 2, REDACT_PAGE),
        await makeRasterizedPdf([whitewashed, unpainted], 2, REDACT_PAGE),
      ];
    },
    rejectsBecause: [
      REDACT_FAILS.blankRender,
      REDACT_FAILS.unpainted,
      REDACT_FAILS.overpainted,
    ],
  },

  "fill-forms": {
    kind: "fill-forms",
    artifact: "pdf",
    run: async (ctx) => {
      const bytes = Buffer.from(await makeFormPdf("intake.pdf"));
      ctx.data["intake.pdf"] = bytes;
      await uploadPayloads(ctx.page, [
        { name: "intake.pdf", mimeType: "application/pdf", buffer: bytes },
      ]);
      await expect(ctx.page.getByText("e2e.name")).toBeVisible();
      // Overwrite the prefilled value so the artifact provably changed.
      await ctx.page
        .getByPlaceholder("Type here…")
        .first()
        .fill("Grace Hopper-E2E");
      return runAndDownload(
        ctx,
        /^fill form$/i,
        /form filled/i,
        /download filled pdf/i,
      );
    },
    assert: async (buf) => {
      const form = await pdfFormSnapshot(buf);
      expect(form.textValues["e2e.name"]).toBe("Grace Hopper-E2E");
    },
    control: async (ctx) => input(ctx, "intake.pdf"),
  },

  "create-forms": {
    kind: "create-forms",
    artifact: "pdf",
    run: async (ctx) => {
      // Tall page: the default field draft sits at y=700.
      await uploadTextPdf(ctx, "blank.pdf", { pages: 1, size: [612, 792] });
      // One text-field draft ("field_1") exists by default and validates.
      return runAndDownload(
        ctx,
        /^create form$/i,
        /fillable form ready/i,
        /download form pdf/i,
      );
    },
    assert: async (buf) => {
      const form = await pdfFormSnapshot(buf);
      expect(form.fieldNames).toContain("field_1");
    },
    control: async (ctx) => input(ctx, "blank.pdf"),
  },

  "annotate-pdf": {
    kind: "annotate",
    artifact: "pdf",
    run: async (ctx) => {
      await uploadTextPdf(ctx, "markup.pdf", { pages: 1, size: [612, 792] });
      // The note type draws TEXT, which the artifact assertion can extract.
      await ctx.page.getByRole("radio", { name: "Note" }).click();
      await ctx.page.getByLabel("Note text").fill("E2E-NOTE-MARK");
      await ctx.page.getByRole("button", { name: /add markup/i }).click();
      return runAndDownload(
        ctx,
        /apply 1 markup/i,
        /annotated pdf ready/i,
        /download annotated pdf/i,
      );
    },
    assert: async (buf) => {
      expect((await pdfPageTexts(buf))[0]).toContain("E2E-NOTE-MARK");
    },
    control: async (ctx) => input(ctx, "markup.pdf"),
  },

  "edit-pdf": {
    kind: "edit",
    artifact: "pdf",
    run: async (ctx) => {
      await uploadTextPdf(ctx, "revise.pdf", { pages: 1, size: [612, 792] });
      // Default content type is "text" at an in-bounds position.
      await ctx.page.getByLabel("Text", { exact: true }).fill("E2E-EDIT-MARK");
      await ctx.page.getByRole("button", { name: /add to page/i }).click();
      return runAndDownload(
        ctx,
        /apply 1 edit/i,
        /edited pdf ready/i,
        /download edited pdf/i,
      );
    },
    assert: async (buf) => {
      expect((await pdfPageTexts(buf))[0]).toContain("E2E-EDIT-MARK");
    },
    control: async (ctx) => input(ctx, "revise.pdf"),
  },

  "extract-images": {
    kind: "extract-images",
    artifact: "png",
    run: async (ctx) => {
      const fixture = await makeImageBearingPdf("gallery.pdf");
      const bytes = Buffer.from(fixture.pdf);
      ctx.data["gallery.pdf"] = bytes;
      ctx.data.imageWidth = fixture.imageWidth;
      ctx.data.imageHeight = fixture.imageHeight;
      await uploadPayloads(ctx.page, [
        { name: "gallery.pdf", mimeType: "application/pdf", buffer: bytes },
      ]);
      await expect(
        ctx.page.getByText("gallery.pdf", { exact: true }),
      ).toBeVisible();
      return runAndDownload(
        ctx,
        /^extract images$/i,
        /1 image extracted/i,
        /download image/i,
      );
    },
    assert: async (buf, ctx) => {
      expectMagic(buf, "png");
      const stats = await decodeImageInPage(ctx.page, buf, "image/png");
      expect(stats.width).toBe(Number(ctx.data.imageWidth));
      expect(stats.height).toBe(Number(ctx.data.imageHeight));
      // The fixture image is a red/blue split; a decode that reaches the real
      // pixels sees both halves.
      expect(stats.redPixels / stats.totalPixels).toBeGreaterThan(0.3);
      expect(stats.bluePixels / stats.totalPixels).toBeGreaterThan(0.3);
    },
    // A PNG of the right size carrying nothing — the extracted-but-blank case.
    // The input PDF would be rejected by the PNG magic check alone.
    control: async (ctx) =>
      makeBlankImageInPage(
        ctx.page,
        "image/png",
        Number(ctx.data.imageWidth),
        Number(ctx.data.imageHeight),
      ),
  },

  "compare-pdf": {
    kind: "compare",
    artifact: "text",
    run: async (ctx) => {
      const left = Buffer.from(
        await makeTextPdf("left.pdf", { pages: 1, bodyLines: ["shared line"] }),
      );
      const right = Buffer.from(
        await makeTextPdf("right.pdf", {
          pages: 1,
          bodyLines: ["shared line", "only-in-right-line"],
        }),
      );
      ctx.data["left.pdf"] = left;
      ctx.data["right.pdf"] = right;
      await uploadPayloads(ctx.page, [
        { name: "left.pdf", mimeType: "application/pdf", buffer: left },
        { name: "right.pdf", mimeType: "application/pdf", buffer: right },
      ]);
      // In the panel: How it works quotes the same words in a step's text,
      // in the HTML (one press away) since 2026-10-23.
      await expect(
        ctx.page.locator("[data-tool-panel]").getByText("2/2 selected"),
      ).toBeVisible();
      return runAndDownload(
        ctx,
        /compare pdfs/i,
        /differences found/i,
        /download comparison report/i,
      );
    },
    assert: async (buf) => {
      const report = buf.toString("utf8");
      expect(report).not.toContain("%PDF-");
      expect(report).toContain("left.pdf");
      expect(report).toContain("right.pdf");
      // The differing line must be flagged AS AN ADDITION. Without the "+" the
      // assertion is satisfied by a report that merely echoes both documents'
      // text, which is what a diff that found nothing would also produce.
      expect(report).toMatch(/^\+ .*only-in-right-line/m);
      expect(report).toContain("Selectable text identical: no");
      expect(report).not.toContain("No selectable-text differences found.");
    },
    // A report-shaped control that names both files and finds nothing. The
    // input PDF would be rejected by the container check alone, proving only
    // that the download was text.
    control: async () =>
      Buffer.from(
        [
          "PDF comparison: left.pdf vs right.pdf",
          "Selectable text identical: yes",
          "Changed lines: 0 (0 added, 0 removed)",
          "Diff:",
          "No selectable-text differences found.",
        ].join("\n"),
        "utf8",
      ),
  },
};

/**
 * Tools with an in-browser runner that this harness does NOT prove AT ALL.
 * An entry here is a loud, reviewed exception — the spec fails if a registry
 * slug is missing from BOTH tables, and also fails if an entry goes stale
 * (names a slug the registry no longer carries).
 *
 * It is currently empty, and that is a real result rather than an omission:
 * every one of the 30 registered in-browser tools is driven end to end and
 * checked on its downloaded bytes. The gaps that DO exist are narrower than a
 * whole tool — they are input modes inside a tool that a headless run cannot
 * reach — and they are enumerated in `PROOF_LIMITS` below.
 */
export const UNPROVEN: Record<string, string> = {
  // (empty) — every registered in-browser tool currently has a proof case.
};

/**
 * What the proofs above do NOT cover, per tool.
 *
 * An empty `UNPROVEN` would otherwise read as "30/30, everything is proven",
 * and that would be the same presence-only claim this whole suite exists to
 * stop making: each case proves ONE path through a runner that often offers
 * several. Every entry here is a mode a green tick above does not cover.
 *
 * These are not TODOs to be silently closed. A pointer-driven mode reached
 * through a real drag is worth adding; deleting the line because the tool "is
 * tested" is the failure this table prevents. The spec fails if an entry names
 * a slug that has no proof case, so the list cannot outlive its subject.
 */
export const PROOF_LIMITS: Record<string, string> = {
  "sign-pdf":
    "Only the TYPED signature source is exercised. The drawn-signature path (signature-pad.tsx) needs real pointer strokes on a canvas, and the uploaded-image source is untested.",
  "annotate-pdf":
    "Only the Note markup type, added through the form controls. The Highlight, Box and Line/arrow types are not exercised, and neither is placement accuracy. (There is no freehand or drag-to-place canvas: markups are placed by numeric coordinates.)",
  "edit-pdf":
    "Only a text insertion at the default position through the form controls. The Box, Line/arrow and Image elements are not exercised, and neither is placement accuracy. (There is no drag-to-place canvas: elements are placed by numeric coordinates.)",
  "redact-pdf":
    "Proves, on the decoded page images, that the default area added via the Add area button is painted with the WHITE fill over the fixture's ink on page 1, that the same spot on page 2 (no box) keeps its ink, and that fixture ink outside the box survives — sampled only in the fixture block's band ABOVE the box, so white paint spilling left of or below the box is not seen here (the unit test's outside-the-box tally covers that). Only the White fill is proven here: the fixture's black block sits under the default box, so a Black fill cannot be told from an unpainted one in this browser proof, and its paint is pinned only by the unit test src/lib/pdf/redact-paint.test.ts. Areas drawn by dragging on the page are not exercised, so the mapping from a dragged rectangle to page coordinates is unproven, and rotated (/Rotate 90) pages are not exercised.",
  "fill-forms":
    "Only a text field is written. Checkboxes, radio groups, dropdowns and the appearance-stream regeneration those need are not exercised.",
  "create-forms":
    "Only the default single text-field draft. Adding several fields, other field types, and dragged placement are not exercised.",
  "crop-pdf":
    "Only the default uniform margins applied to every page of an unrotated PDF. Per-side margins, pages carrying /Rotate, page selection and the schematic preview are not exercised end to end. Per-side margins on every /Rotate are proved by pdfjs reading the saved file in src/lib/pdf/crop.test.ts, and the Uniform/Per side switch and the rotated preview by src/components/tools/runner/crop-runner.test.tsx; neither runs in a real browser.",
  "compare-pdf":
    "Both documents are uploaded through the same multi-file picker, which is the flow the runner offers. The no-text verdicts — neither PDF, or only ONE of them, has selectable text — are not exercised here; src/components/tools/runner/compare-pdf-runner.test.tsx renders them from real PDF bytes in jsdom, but reads them with pdfjs's legacy build, not the browser build a user runs. The too-large-to-diff error is likewise covered only there, with synthetic text.",
  "compress-pdf":
    "Only the in-browser lossless repack, on a fixture built to be repackable. The hybrid secure-worker step this tool offers is a server path and is covered by worker:prove-tools, not here.",
  "split-pdf":
    "Only the default even split into two ranges. Custom ranges, per-page splitting and the single-output (no ZIP) branch are not exercised.",
  "organize-pages":
    "Only the Reverse bulk action. Drag reordering, duplication and per-page rotation inside the organizer are not exercised.",
  "pdf-to-jpg":
    "Only the default resolution, single page. Other DPI presets and the multi-page ZIP branch are not exercised in a real browser. src/components/tools/runner/pdf-to-image-chain.test.tsx drives the same runner and the real rasterizePdf at Print in jsdom, but for PNG output only, so the JPEG encoder at those presets is not exercised anywhere.",
  "pdf-to-png":
    "Only the default resolution, single page. Other DPI presets and the multi-page ZIP branch are not exercised in a real browser. src/components/tools/runner/pdf-to-image-chain.test.tsx covers Print in jsdom through the real rasterizePdf: an A2 page and an ARCH D page are capped at 5,000 px and the note names the DPI of the downloaded pixels, while Letter stays at 2550 x 3300 with no note, both as a single PNG and as a ZIP. It uses pdfjs's legacy build, a render that paints nothing, and a stub encoder that writes the canvas size, so it proves pixel dimensions and the note, not pixel content.",
  "extract-images":
    "Only a single opaque Flate-coded RGB image. This tool never decodes JPEG 2000 or JBIG2 (nor goes through pdfjs at all): it deliberately lists them as skipped, and that skip disclosure is what is unexercised here, not decoding. Transparency (/SMask, /Mask, the PNG's alpha), palette (Indexed) images, inline-image disclosure and the saved-without-transparency caveat are covered only by unit tests — src/lib/pdf/extract-images.test.ts and src/components/tools/runner/extract-images-runner.test.tsx — not by this browser proof.",
  "grayscale-pdf":
    "Only the default DPI preset. The screen/print preset difference is not exercised. The fixture's pages are flat blocks and text, which the tool stores as lossless Flate DeviceGray planes; the one-component JPEG branch it picks for photographic pages is proven in Node (src/lib/pdf/grayscale-output.test.ts, decoded by pdf.js), not in a browser here.",
  "watermark-pdf":
    "Only the default text, size, tilt and opacity on a Letter page. Note that the tool's own 60pt default overflows a small page and pdfjs then omits the off-page glyphs from extraction — so a watermark's VISUAL placement is not what this proof checks.",
};

/** Where a temp file is still needed (upload via path), reuse this. */
export { writeTempFixture };
