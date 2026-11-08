import JSZip from "jszip";
import { expect, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { SETTINGS_BATCH_TOOLS } from "../../src/lib/batch/tools";
import { fileInput, waitForHydration } from "../helpers";
import {
  captureDownload,
  pdfPageCount,
  pdfPageTexts,
  pdfRotations,
  zipEntries,
} from "./artifacts";
import { makeFormPdf, makeTextPdf, pageMarker } from "./fixtures";
import type { CaseContext, VariantCase } from "./cases";

/**
 * The settings batches (batch plan P1), proved through the page the way a
 * person uses them: two PDFs with THE SAME NAME picked at once, the batch's
 * Run, "Download all (2)", and the ZIP the browser saves — opened, its two
 * entries named apart, and each PDF in it decoded for the tool's effect.
 *
 * Every request the page makes while the batch runs is counted: a batch of
 * browser tools sends nothing to `/api/`. The count is taken in `run` and
 * checked in `assert`, beside the bytes.
 *
 * Run on desktop by `client-tools.spec.ts` (they are VARIANTS) and on a
 * phone by `batch-tools.mobile.spec.ts`.
 */

type Slug = keyof typeof SETTINGS_BATCH_TOOLS;

/** The two inputs: the same name, two and three pages, told apart by size. */
const INPUT = "report.pdf";
const PAGES = [2, 3] as const;

/** Why each control must fail: the assertion's own words. */
const NOT_APPLIED = "the batch's effect is missing from";
const ARCHIVE_NAMES = "the archive's entries";
const ZERO_API = "requests to /api/ while the batch ran";

async function payloads(slug: Slug): Promise<Uint8Array[]> {
  if (slug === "flatten-pdf")
    return [await makeFormPdf("first"), await makeFormPdf("second")];
  return Promise.all(
    PAGES.map((pages, i) =>
      makeTextPdf(i === 0 ? "first" : "second", { pages }),
    ),
  );
}

/** The name each output gets in the archive: the second is told apart. */
function entryNames(slug: Slug): string[] {
  const suffix: Record<Slug, string> = {
    "rotate-pdf": "rotated",
    "flatten-pdf": "flattened",
    "page-numbers": "numbered",
    "watermark-pdf": "watermarked",
    "split-pdf-pages-in-half": "halved",
  };
  return [`report-${suffix[slug]}.pdf`, `report-${suffix[slug]} (2).pdf`];
}

/**
 * Count the page's requests from now on: to our API, and in all. The total
 * is the counter's health check — the batch's own chunk is fetched when the
 * files arrive, so a counter that saw nothing at all was never listening.
 */
function countRequests(page: Page): () => { api: number; all: number } {
  let api = 0;
  let all = 0;
  page.on("request", (request) => {
    all += 1;
    if (new URL(request.url()).pathname.startsWith("/api/")) api += 1;
  });
  return () => ({ api, all });
}

/** Pick both files, run the batch, and save "Download all". */
async function runBatch(
  ctx: CaseContext,
  slug: Slug,
  runName: RegExp,
): Promise<Buffer> {
  const inputs = await payloads(slug);
  inputs.forEach((bytes, i) => (ctx.data[`input-${i}`] = Buffer.from(bytes)));
  const input = fileInput(ctx.page);
  await waitForHydration(input);
  const requests = countRequests(ctx.page);
  await input.setInputFiles(
    inputs.map((bytes) => ({
      name: INPUT,
      mimeType: "application/pdf",
      buffer: Buffer.from(bytes),
    })),
  );
  const run = ctx.page.getByRole("button", { name: runName });
  await expect(run).toBeVisible({ timeout: 20_000 });
  await run.click();
  await expect(
    ctx.page.getByRole("heading", {
      name: "Batch complete. 2 done, 0 failed.",
    }),
  ).toBeVisible({ timeout: 60_000 });
  const zip = await captureDownload(
    ctx.page,
    ctx.page.getByRole("button", { name: "Download all (2)" }),
  );
  ctx.data.apiRequests = requests().api;
  ctx.data.requestsSeen = requests().all;
  return zip;
}

/** The two PDFs in the archive, in input order, under the names expected. */
async function outputsOf(buf: Buffer, slug: Slug): Promise<Buffer[]> {
  const entries = await zipEntries(buf);
  const want = entryNames(slug);
  expect([...entries.keys()].sort(), ARCHIVE_NAMES).toEqual([...want].sort());
  return want.map((name) => entries.get(name)!);
}

/** A ZIP of the INPUTS under the right names: everything right but the effect. */
async function untouchedZip(ctx: CaseContext, slug: Slug): Promise<Buffer> {
  const zip = new JSZip();
  entryNames(slug).forEach((name, i) =>
    zip.file(name, ctx.data[`input-${i}`] as Buffer),
  );
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

/** The right outputs under the names a ZIP with no de-duplication would use. */
async function collidingZip(buf: Buffer, slug: Slug): Promise<Buffer> {
  const entries = await zipEntries(buf);
  const zip = new JSZip();
  // One entry: the second file overwrote the first, as before P0a.
  zip.file(entryNames(slug)[0]!, entries.get(entryNames(slug)[1]!)!);
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

function batchCase(
  slug: Slug,
  kind: VariantCase["kind"],
  runName: RegExp,
  check: (pdf: Buffer, index: number) => Promise<void>,
): VariantCase {
  return {
    slug,
    name: "a batch of two PDFs with the same name",
    kind,
    artifact: "zip",
    run: (ctx) => runBatch(ctx, slug, runName),
    assert: async (buf, ctx) => {
      expect(
        ctx.data.requestsSeen,
        "the request counter saw nothing: it was not listening",
      ).toBeGreaterThan(0);
      expect(ctx.data.apiRequests, ZERO_API).toBe(0);
      const outputs = await outputsOf(buf, slug);
      for (const [i, pdf] of outputs.entries()) await check(pdf, i);
    },
    // One differs in the effect only (the inputs, untouched, correctly
    // named); one in the names only (the right output, the other lost to a
    // name collision).
    control: async (ctx) => [
      await untouchedZip(ctx, slug),
      await collidingZip(ctx.data.artifact as Buffer, slug),
    ],
    rejectsBecause: [NOT_APPLIED, ARCHIVE_NAMES],
  };
}

/** Keep the true archive for the name control. */
function keepingArtifact(c: VariantCase): VariantCase {
  return {
    ...c,
    run: async (ctx) => {
      const buf = await c.run(ctx);
      ctx.data.artifact = buf;
      return buf;
    },
  };
}

const PAGE_TEXT = async (pdf: Buffer) => pdfPageTexts(pdf);

export const BATCH_VARIANTS: readonly VariantCase[] = [
  batchCase("rotate-pdf", "rotate", /^Rotate 2 PDFs$/, async (pdf, i) => {
    const rotations = await pdfRotations(pdf);
    expect(rotations, `${NOT_APPLIED} output ${i + 1}`).toEqual(
      Array.from({ length: PAGES[i]! }, () => 90),
    );
  }),
  batchCase("flatten-pdf", "flatten", /^Flatten 2 PDFs$/, async (pdf, i) => {
    const doc = await PDFDocument.load(pdf);
    expect(
      doc.getForm().getFields().length,
      `${NOT_APPLIED} output ${i + 1}`,
    ).toBe(0);
    // The answers are now page content.
    expect((await pdfPageTexts(pdf))[0]).toContain("Ada Lovelace");
  }),
  batchCase(
    "page-numbers",
    "page-numbers",
    /^Number 2 PDFs$/,
    async (pdf, i) => {
      const texts = await PAGE_TEXT(pdf);
      // Restarts in each file: page 1 of each reads 1 of its own count.
      expect(texts[0], `${NOT_APPLIED} output ${i + 1}`).toContain(
        `Page 1 of ${PAGES[i]}`,
      );
      expect(texts[0]).toContain(pageMarker(i === 0 ? "first" : "second", 1));
    },
  ),
  batchCase(
    "watermark-pdf",
    "watermark",
    /^Watermark 2 PDFs$/,
    async (pdf, i) => {
      const texts = await PAGE_TEXT(pdf);
      expect(texts, `${NOT_APPLIED} output ${i + 1}`).toHaveLength(PAGES[i]!);
      for (const text of texts)
        expect(
          text.replace(/\s+/g, ""),
          `${NOT_APPLIED} output ${i + 1}`,
        ).toContain("CONFIDENTIAL");
    },
  ),
  batchCase(
    "split-pdf-pages-in-half",
    "split-half",
    /^Split 2 PDFs$/,
    async (pdf, i) => {
      expect(await pdfPageCount(pdf), `${NOT_APPLIED} output ${i + 1}`).toBe(
        PAGES[i]! * 2,
      );
    },
  ),
].map(keepingArtifact);
