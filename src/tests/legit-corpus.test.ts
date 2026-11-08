// @native-canvas
// The positive control for every hostile-input guard: real files from real
// producers must keep working.
//
// Each file in src/tests/fixtures/legit-corpus was written by a program people
// actually use. The live worker image (LibreOffice Writer, Ghostscript 10.00
// pdfwrite, qpdf 11.3 object streams / linearization / QDF / page merge /
// rotation, ocrmypdf PDF/A, poppler's cairo backend) wrote most of them, with
// no network. Chromium's Skia backend ("Save as PDF") wrote one locally, and
// one is a LibreOffice file with a classic incremental update appended. A
// guard that refuses a damaged file is only half right if it also refuses one
// of these; this test is the other half.
//
// The page counts are pinned, and both parsers (pdf-lib and pdf.js) must agree
// with the pin. If two parsers drifted the same way, a check of one against the
// other would still pass; the pin would not.
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { optimizeLossless } from "@/lib/pdf/analyze";
import { countDigitalSignatures } from "@/lib/pdf/digital-signatures";
import { getEditPageSizes } from "@/lib/pdf/edit";
import { classifyPdfAccess, type PdfjsForAccess } from "@/lib/pdf/encryption";
import {
  getPageCount,
  loadPdf,
  mergePdfs,
  rotatePages,
} from "@/lib/pdf/engine";
import { extractPdfImages } from "@/lib/pdf/extract-images";
import { inspectFormFields } from "@/lib/pdf/forms";
import { readPdfMetadata } from "@/lib/pdf/metadata";
import { addPageNumbers } from "@/lib/pdf/page-numbers";
import { countPdfPagesDetailed } from "@/lib/pdf/page-count";
import { countPagesWithPdfjs } from "@/lib/pdf/pdfjs-page-count";
import { probePdf } from "@/lib/pdf/probe";
import { getRedactPageSizes } from "@/lib/pdf/redact";
import { extractPdfText } from "@/lib/pdf/text";
import { watermarkPdf } from "@/lib/pdf/watermark";

const DIR = path.join(process.cwd(), "src/tests/fixtures/legit-corpus");
const MAX_BYTES = 50 * 1024 * 1024;

/**
 * Pages per file, measured once with pdf-lib AND pdf.js, which agreed on every
 * file (qpdf-merged = the 2-page HTML export + pages 1-2 of the long one).
 */
const PAGES: Record<string, number> = {
  "cairo.pdf": 2,
  "chromium-skia.pdf": 2,
  "gs-ebook-long.pdf": 13,
  "gs-pdfwrite.pdf": 2,
  "incremental-update.pdf": 2,
  "lo-writer-html.pdf": 2,
  "lo-writer-long.pdf": 13,
  "ocrmypdf-pdfa.pdf": 1,
  "qpdf-linearized.pdf": 2,
  "qpdf-merged.pdf": 4,
  "qpdf-objstm-linearized.pdf": 2,
  "qpdf-objstm.pdf": 13,
  "qpdf-qdf.pdf": 2,
  "qpdf-rotated.pdf": 2,
};

const require = createRequire(import.meta.url);
let pdfjsPromise: Promise<PdfjsForAccess> | null = null;
function pdfjs(): Promise<PdfjsForAccess> {
  pdfjsPromise ??= import(
    /* @vite-ignore */ pathToFileURL(
      require.resolve("pdfjs-dist/legacy/build/pdf.mjs"),
    ).href
  ) as Promise<PdfjsForAccess>;
  return pdfjsPromise;
}
// The text reader and the page counter take the same module.
const reader = pdfjs as unknown as Parameters<typeof extractPdfText>[1];
const counter = pdfjs as unknown as Parameters<typeof countPagesWithPdfjs>[1];

const files = readdirSync(DIR)
  .filter((name) => name.endsWith(".pdf"))
  .sort();
const read = (name: string) =>
  new Uint8Array(readFileSync(path.join(DIR, name)));

async function pagesOf(bytes: Uint8Array): Promise<number> {
  return (await PDFDocument.load(bytes)).getPageCount();
}

describe("legit corpus: health", () => {
  it("is the pinned set, and not implausibly small", () => {
    // A corpus that quietly shrank would pass every assertion below.
    expect(files.length).toBeGreaterThanOrEqual(14);
    expect(files).toEqual(Object.keys(PAGES).sort());
  });

  it("covers the structures the guards touch", () => {
    const text = (name: string) => Buffer.from(read(name)).toString("latin1");
    // Object streams and xref streams, linearization, an appended revision.
    expect(text("qpdf-objstm.pdf")).toMatch(/\/Type\s*\/ObjStm/);
    expect(text("qpdf-objstm.pdf")).toMatch(/\/Type\s*\/XRef/);
    expect(text("qpdf-linearized.pdf")).toMatch(/\/Linearized/);
    expect(text("incremental-update.pdf")).toMatch(/\/Prev\s+\d+/);
    expect(text("qpdf-rotated.pdf")).toMatch(/\/Rotate\s+90/);
  });
});

describe.each(files)("legit corpus: %s", (name) => {
  const want = PAGES[name]!;

  it("both parsers agree with the pinned page count", async () => {
    const bytes = read(name);
    expect(await getPageCount(bytes)).toBe(want);
    expect((await loadPdf(bytes)).getPageCount()).toBe(want);
    expect(await countPdfPagesDetailed(bytes, MAX_BYTES)).toEqual({
      ok: true,
      count: want,
    });
    expect(await countPagesWithPdfjs(bytes, counter)).toBe(want);
    expect(await classifyPdfAccess(bytes, await pdfjs())).toEqual({
      kind: "unencrypted",
      pageCount: want,
    });
    const probe = await probePdf(bytes, { maxBytes: MAX_BYTES });
    expect(probe).toMatchObject({ read: "ok", pages: want });
  }, 60_000);

  it("reads: text, metadata, forms, sizes, images, signatures", async () => {
    const bytes = read(name);
    const text = await extractPdfText(bytes, reader);
    expect(text.pageCount).toBe(want);
    await expect(readPdfMetadata(bytes)).resolves.toBeDefined();
    await expect(inspectFormFields(bytes)).resolves.toBeDefined();
    for (const sizes of [
      await getEditPageSizes(bytes),
      await getRedactPageSizes(bytes),
    ]) {
      expect(sizes).toHaveLength(want);
      for (const s of sizes) {
        expect(Number.isFinite(s.width) && s.width > 0).toBe(true);
        expect(Number.isFinite(s.height) && s.height > 0).toBe(true);
      }
    }
    await expect(extractPdfImages(bytes)).resolves.toBeDefined();
    expect(countDigitalSignatures(bytes)).toBe(0);
  }, 60_000);

  it("writes: stamp, number, rotate, merge, optimise keep every page", async () => {
    const bytes = read(name);
    const stamped = await watermarkPdf(bytes, "DRAFT");
    expect(stamped.totalPages).toBe(want);
    expect(await pagesOf(stamped.bytes)).toBe(want);
    expect(await pagesOf(await addPageNumbers(bytes))).toBe(want);
    expect(await pagesOf(await rotatePages(bytes, [0], 90))).toBe(want);
    expect(await pagesOf(await mergePdfs([bytes, bytes]))).toBe(want * 2);
    expect(await pagesOf((await optimizeLossless(bytes)).bytes)).toBe(want);
  }, 60_000);
});
