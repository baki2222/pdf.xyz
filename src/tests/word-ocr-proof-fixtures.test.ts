// @vitest-environment node
// @native-canvas
/**
 * The PDF to Word OCR proof's fixture must really be a scan, and its verdict
 * must be able to fail. Without the first, a "found the words" pass could be
 * the export reading a text layer the fixture carried all along; without the
 * second, the proof passes whatever the worker returns.
 */
import JSZip from "jszip";
import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { PDFJS_DOCUMENT_DEFAULTS } from "@/lib/pdf/wasm-assets";
import { awaitPdfjsDocument } from "@/lib/pdf/pdfjs";
import { renderPdfPages, regionMean } from "./pdf-render";
import {
  SCANNED_LINE,
  scannedDocxVerdict,
  scannedTextPdf,
} from "./word-ocr-proof-fixtures";

async function docx(paragraphs: string[]): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs
      .map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`)
      .join("")}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

describe("scannedTextPdf — a real scan of a known sentence", () => {
  it("has NO selectable text, so only OCR can put its words in a DOCX", async () => {
    const pdf = await scannedTextPdf();
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = pdfjs.getDocument({ ...PDFJS_DOCUMENT_DEFAULTS, data: pdf });
    const doc = await awaitPdfjsDocument(task);
    const content = await (await doc.getPage(1)).getTextContent();
    await task.destroy();
    expect(content.items).toEqual([]);
  });

  it("positive control: its one picture carries ink where the line was typed, and paper elsewhere", async () => {
    const pdf = await scannedTextPdf();
    const doc = await PDFDocument.load(pdf);
    const images = [...doc.context.enumerateIndirectObjects()].filter(
      ([, o]) =>
        o instanceof PDFRawStream &&
        o.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"),
    );
    expect(images).toHaveLength(1);
    const [page] = await renderPdfPages(pdf, 842);
    // The line sits at y=700 of 842 (from the bottom): ~13-18% from the top.
    const ink = regionMean(page!, 0.07, 0.15, 0.6, 0.18);
    const paper = regionMean(page!, 0.07, 0.5, 0.6, 0.6);
    expect(Math.min(...ink)).toBeLessThan(235);
    expect(Math.min(...paper)).toBeGreaterThan(250);
  }, 30_000);
});

describe("scannedDocxVerdict", () => {
  it("passes a DOCX whose text holds every word, even broken across lines", async () => {
    const [a, b] = [
      SCANNED_LINE.split(" ").slice(0, 3).join(" "),
      SCANNED_LINE.split(" ").slice(3).join(" "),
    ];
    expect((await scannedDocxVerdict(await docx([a!, b!]))).ok).toBe(true);
  });

  it("fails a DOCX with the picture's page and no words (the export without OCR)", async () => {
    const verdict = await scannedDocxVerdict(await docx([]));
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(/missing/);
  });

  it("fails a DOCX that lost one word, and bytes that are not a DOCX", async () => {
    const dropped = SCANNED_LINE.replace("4718", "");
    expect((await scannedDocxVerdict(await docx([dropped]))).ok).toBe(false);
    expect((await scannedDocxVerdict(new Uint8Array([1, 2, 3]))).ok).toBe(
      false,
    );
  });
});
