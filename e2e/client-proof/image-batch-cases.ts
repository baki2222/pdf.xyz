import JSZip from "jszip";
import { expect, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { IMAGE_BATCH_TOOLS } from "../../src/lib/batch/tools";
import { decodePng, pixelAt } from "../../src/lib/png-probe";
import { fileInput, waitForHydration } from "../helpers";
import {
  captureDownload,
  expectMagic,
  pdfPageTexts,
  zipEntries,
} from "./artifacts";
import { encodePng, makeImagePagesPdf } from "./fixtures";
import type { CaseContext, VariantCase } from "./cases";

/**
 * The images batches and Text to PDF's batch (batch plan P2), proved
 * through the page the way a person uses them: files of THE SAME NAME picked
 * at once, the batch's Run, "Download all", and the ZIP the browser saves,
 * opened and decoded.
 *
 *  - PDF to PNG, PDF to JPG, Extract Images: each input's images sit in a
 *    folder of its own name, the second "report (2)"; every page (or every
 *    embedded image) is there, decoded as the format the tool says, and a
 *    PNG's pixels are the page's red, not a blank canvas.
 *  - Text to PDF: one PDF per text file, each holding its own text.
 *
 * No request reaches `/api/` while a batch runs; the counter's own health
 * check needs it to have seen the batch chunk load. Two controls per case,
 * each rejected for its own reason. Run on desktop as client-tools VARIANTS
 * and on a phone by `batch-tools.mobile.spec.ts`.
 */

type ImageSlug = keyof typeof IMAGE_BATCH_TOOLS;

const INPUT = "report.pdf";
/** The two inputs' page counts: told apart by how many images each gives. */
const PAGES = [2, 3] as const;
const FOLDERS = ["report", "report (2)"] as const;

/** Why each control must fail: the assertion's own words. */
const ARCHIVE_NAMES = "the archive's entries";
const NOT_IMAGES = "an archived file is not the image the tool makes";
const ZERO_API = "requests to /api/ while the batch ran";
const NOT_TEXT = "a PDF in the archive does not hold its own text";

const RED: [number, number, number] = [220, 30, 30];

/** A solid red PNG, `w` × `h`. */
function redPng(w: number, h: number): Buffer {
  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i += 1) rgb.set(RED, i * 3);
  return encodePng(rgb, w, h);
}

/** `pages` pages, each one red picture of its own size, edge to edge. */
export async function redPicturesPdf(pages: number): Promise<Uint8Array> {
  return makeImagePagesPdf(
    Array.from({ length: pages }, (_, i) => ({
      bytes: new Uint8Array(redPng(40 + 8 * i, 30)),
      format: "png" as const,
    })),
  );
}

/**
 * Count the page's requests from now on: to our API, and in all. The total
 * is the counter's health check.
 */
export function countRequests(page: Page): () => { api: number; all: number } {
  let api = 0;
  let all = 0;
  page.on("request", (request) => {
    all += 1;
    if (new URL(request.url()).pathname.startsWith("/api/")) api += 1;
  });
  return () => ({ api, all });
}

/** Pick the files, run the batch, wait for its end, save "Download all". */
export async function runFilesBatch(
  ctx: CaseContext,
  files: { name: string; mimeType: string; buffer: Buffer }[],
  runName: RegExp,
  done: number,
): Promise<Buffer> {
  const input = fileInput(ctx.page);
  await waitForHydration(input);
  const requests = countRequests(ctx.page);
  await input.setInputFiles(files);
  const run = ctx.page.getByRole("button", { name: runName });
  await expect(run).toBeVisible({ timeout: 20_000 });
  await run.click();
  await expect(
    ctx.page.getByRole("heading", {
      name: `Batch complete. ${done} done, 0 failed.`,
    }),
  ).toBeVisible({ timeout: 120_000 });
  const zip = await captureDownload(
    ctx.page,
    ctx.page.getByRole("button", { name: `Download all (${done})` }),
  );
  ctx.data.apiRequests = requests().api;
  ctx.data.requestsSeen = requests().all;
  return zip;
}

function expectNoApi(ctx: CaseContext): void {
  expect(
    ctx.data.requestsSeen,
    "the request counter saw nothing: it was not listening",
  ).toBeGreaterThan(0);
  expect(ctx.data.apiRequests, ZERO_API).toBe(0);
}

interface ImageWant {
  run: RegExp;
  /** Every entry the archive must hold, folder by folder. */
  entries: (folder: string, pages: number) => string[];
  /** One archived file, decoded as the tool's format. */
  check: (bytes: Buffer, entry: string) => void;
}

const pageEntries = (ext: string) => (folder: string, pages: number) =>
  Array.from(
    { length: pages },
    (_, i) => `${folder}/report-page-${i + 1}.${ext}`,
  );

/** A rendered page's PNG: a real image whose middle is the page's red. */
function checkPng(bytes: Buffer, entry: string): void {
  let png;
  try {
    png = decodePng(new Uint8Array(bytes));
  } catch (err) {
    throw new Error(`${NOT_IMAGES}: ${entry} (${String(err)})`);
  }
  const mid = pixelAt(
    png,
    Math.floor(png.width / 2),
    Math.floor(png.height / 2),
  );
  expect(
    mid.r > 150 && mid.g < 100 && mid.b < 100,
    `${NOT_IMAGES}: ${entry} is not red in the middle (${JSON.stringify(mid)})`,
  ).toBe(true);
}

function checkJpeg(bytes: Buffer, entry: string): void {
  expect(
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    `${NOT_IMAGES}: ${entry} is not a JPEG`,
  ).toBe(true);
}

const WANT: Record<ImageSlug, ImageWant> = {
  "pdf-to-png": {
    run: /^Convert 2 PDFs$/,
    entries: pageEntries("png"),
    check: checkPng,
  },
  "pdf-to-jpg": {
    run: /^Convert 2 PDFs$/,
    entries: pageEntries("jpg"),
    check: checkJpeg,
  },
  // Each page's own picture, pulled out as the PNG it was embedded as.
  "extract-images": {
    run: /^Extract from 2 PDFs$/,
    entries: (folder, pages) =>
      Array.from(
        { length: pages },
        (_, i) =>
          `${folder}/page-${String(i + 1).padStart(3, "0")}-image-001.png`,
      ),
    check: checkPng,
  },
};

const wantedEntries = (slug: ImageSlug) =>
  FOLDERS.flatMap((folder, i) => WANT[slug].entries(folder, PAGES[i]!));

function imageCase(slug: ImageSlug, kind: VariantCase["kind"]): VariantCase {
  const want = WANT[slug];
  return {
    slug,
    name: "a batch of two PDFs with the same name",
    kind,
    artifact: "zip",
    run: async (ctx) => {
      const inputs = await Promise.all(PAGES.map((n) => redPicturesPdf(n)));
      inputs.forEach((b, i) => (ctx.data[`input-${i}`] = Buffer.from(b)));
      const buf = await runFilesBatch(
        ctx,
        inputs.map((bytes) => ({
          name: INPUT,
          mimeType: "application/pdf",
          buffer: Buffer.from(bytes),
        })),
        want.run,
        2,
      );
      ctx.data.artifact = buf;
      return buf;
    },
    assert: async (buf, ctx) => {
      expectNoApi(ctx);
      const entries = await zipEntries(buf);
      expect([...entries.keys()].sort(), ARCHIVE_NAMES).toEqual(
        wantedEntries(slug).sort(),
      );
      for (const [name, bytes] of entries) want.check(bytes, name);
    },
    // One with every image at the top level (no folders, so the two
    // inputs' pages collide); one with the right names over the input PDFs.
    control: async (ctx) => {
      const entries = await zipEntries(ctx.data.artifact as Buffer);
      const flat = new JSZip();
      for (const [name, bytes] of entries)
        flat.file(name.slice(name.indexOf("/") + 1), bytes);
      const wrong = new JSZip();
      wantedEntries(slug).forEach((name, i) =>
        wrong.file(name, ctx.data[`input-${i % 2}`] as Buffer),
      );
      return [
        Buffer.from(await flat.generateAsync({ type: "nodebuffer" })),
        Buffer.from(await wrong.generateAsync({ type: "nodebuffer" })),
      ];
    },
    rejectsBecause: [ARCHIVE_NAMES, NOT_IMAGES],
  };
}

const TEXTS = ["First note, from the batch.", "Second note, from the batch."];

const textCase: VariantCase = {
  slug: "text-to-pdf",
  name: "a batch of two text files with the same name",
  kind: "text-to-pdf",
  artifact: "zip",
  run: async (ctx) => {
    const buf = await runFilesBatch(
      ctx,
      TEXTS.map((text) => ({
        name: "notes.txt",
        mimeType: "text/plain",
        buffer: Buffer.from(text, "utf8"),
      })),
      /^Convert 2 text files$/,
      2,
    );
    ctx.data.artifact = buf;
    return buf;
  },
  assert: async (buf, ctx) => {
    expectNoApi(ctx);
    const entries = await zipEntries(buf);
    const names = ["notes-pdf.pdf", "notes-pdf (2).pdf"];
    expect([...entries.keys()].sort(), ARCHIVE_NAMES).toEqual(
      [...names].sort(),
    );
    for (const [i, name] of names.entries()) {
      const pdf = entries.get(name)!;
      expectMagic(pdf, "pdf");
      // Runs of spaces collapsed: the extractor reads a wide word gap on the
      // page as several ("First note,   from"), which is layout, not text.
      const text = (await pdfPageTexts(pdf)).join(" ").split(/\s+/).join(" ");
      expect(text, NOT_TEXT).toContain(TEXTS[i]!);
    }
  },
  control: async (ctx) => {
    const entries = await zipEntries(ctx.data.artifact as Buffer);
    // One entry: the second file overwrote the first, as before P0a.
    const colliding = new JSZip();
    colliding.file("notes-pdf.pdf", entries.get("notes-pdf (2).pdf")!);
    // Both names, each holding the other's PDF.
    const swapped = new JSZip();
    swapped.file("notes-pdf.pdf", entries.get("notes-pdf (2).pdf")!);
    swapped.file("notes-pdf (2).pdf", entries.get("notes-pdf.pdf")!);
    return [
      Buffer.from(await colliding.generateAsync({ type: "nodebuffer" })),
      Buffer.from(await swapped.generateAsync({ type: "nodebuffer" })),
    ];
  },
  rejectsBecause: [ARCHIVE_NAMES, NOT_TEXT],
};

export const IMAGE_TEXT_BATCH_VARIANTS: readonly VariantCase[] = [
  imageCase("pdf-to-png", "pdf-to-image"),
  imageCase("pdf-to-jpg", "pdf-to-image"),
  imageCase("extract-images", "extract-images"),
  textCase,
];

/** Health for a spec: a PDF this module builds really has `pages` pages. */
export async function pageCountOf(bytes: Uint8Array): Promise<number> {
  return (await PDFDocument.load(bytes)).getPageCount();
}
