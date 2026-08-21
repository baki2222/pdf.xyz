import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { expect, type Download, type Locator, type Page } from "@playwright/test";

/**
 * Artifact inspection for the in-browser tool proofs. Everything here reads
 * the bytes the browser actually downloaded — never the app's own state — so
 * an engine that "succeeded" while producing a wrong file fails here.
 *
 * Extraction independence: the text reader is pdfjs run in the TEST process,
 * while the engines under test produce their PDFs with pdf-lib in the browser.
 * Only pdf-to-text / pdf-to-markdown use pdfjs on both sides; their assertions
 * therefore compare against the KNOWN drawn fixture strings, not against a
 * second extraction.
 */

/** Save a Playwright download and return its bytes. */
export async function downloadBytesOf(download: Download): Promise<Buffer> {
  const path = await download.path();
  return readFileSync(path);
}

/**
 * Click a download CTA and capture the file it hands the browser. The CTAs are
 * blob-anchor clicks (`downloadBytes` in src/lib/pdf/browser.ts), which
 * surface as Playwright `download` events.
 */
export async function captureDownload(
  page: Page,
  cta: Locator,
): Promise<Buffer> {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    cta.click(),
  ]);
  return downloadBytesOf(download);
}

/* ------------------------------------------------------------------ *
 *  Magic bytes
 * ------------------------------------------------------------------ */

export type ArtifactKind = "pdf" | "png" | "jpg" | "zip" | "text";

/** Assert the artifact's container type from its leading bytes. */
export function expectMagic(buf: Buffer, kind: ArtifactKind): void {
  const head = buf.subarray(0, 8);
  switch (kind) {
    case "pdf":
      expect(buf.subarray(0, 5).toString("latin1"), "PDF magic").toBe("%PDF-");
      break;
    case "png":
      expect(
        head.equals(
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        ),
        "PNG magic",
      ).toBe(true);
      break;
    case "jpg":
      expect(buf[0], "JPEG SOI 0xFF").toBe(0xff);
      expect(buf[1], "JPEG SOI 0xD8").toBe(0xd8);
      break;
    case "zip":
      expect(buf[0], "ZIP magic P").toBe(0x50);
      expect(buf[1], "ZIP magic K").toBe(0x4b);
      break;
    case "text":
      // A text artifact must NOT be a PDF/ZIP/PNG that leaked through — the
      // check that makes the identity control meaningful for text outputs.
      expect(buf.subarray(0, 5).toString("latin1"), "text, not PDF").not.toBe(
        "%PDF-",
      );
      expect(buf[0], "text, not ZIP").not.toBe(0x50 as never);
      break;
  }
}

/* ------------------------------------------------------------------ *
 *  PDF structure (pdf-lib)
 * ------------------------------------------------------------------ */

export async function loadPdf(buf: Buffer): Promise<PDFDocument> {
  expectMagic(buf, "pdf");
  return PDFDocument.load(new Uint8Array(buf), { updateMetadata: false });
}

export async function pdfPageCount(buf: Buffer): Promise<number> {
  return (await loadPdf(buf)).getPageCount();
}

export async function pdfRotations(buf: Buffer): Promise<number[]> {
  const doc = await loadPdf(buf);
  return doc.getPages().map((p) => p.getRotation().angle);
}

export async function pdfCropBoxes(
  buf: Buffer,
): Promise<{ width: number; height: number }[]> {
  const doc = await loadPdf(buf);
  return doc.getPages().map((p) => {
    const { width, height } = p.getCropBox();
    return { width, height };
  });
}

export interface PdfFormSnapshot {
  fieldNames: string[];
  textValues: Record<string, string | undefined>;
}

export async function pdfFormSnapshot(buf: Buffer): Promise<PdfFormSnapshot> {
  const doc = await loadPdf(buf);
  const form = doc.getForm();
  const fields = form.getFields();
  const textValues: Record<string, string | undefined> = {};
  for (const field of fields) {
    if (field.constructor.name === "PDFTextField") {
      textValues[field.getName()] = form.getTextField(field.getName()).getText();
    }
  }
  return { fieldNames: fields.map((f) => f.getName()), textValues };
}

export interface PdfImageInfo {
  width: number;
  height: number;
  filter: string | undefined;
  colorSpace: string | undefined;
}

/**
 * Enumerate the raster image XObjects a PDF embeds — the check that tells a
 * genuinely rasterized artifact (redact, grayscale, image-to-pdf) from a
 * pass-through of its text-only input.
 */
export async function pdfImages(buf: Buffer): Promise<PdfImageInfo[]> {
  const doc = await loadPdf(buf);
  const images: PdfImageInfo[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    const subtype = dict.get(PDFName.of("Subtype"));
    if (subtype?.toString() !== "/Image") continue;
    const num = (key: string): number => {
      const v = dict.get(PDFName.of(key));
      return v ? Number(v.toString()) : NaN;
    };
    images.push({
      width: num("Width"),
      height: num("Height"),
      filter: dict.get(PDFName.of("Filter"))?.toString(),
      colorSpace: dict.get(PDFName.of("ColorSpace"))?.toString(),
    });
  }
  return images;
}

/* ------------------------------------------------------------------ *
 *  PDF text (pdfjs, in the test process)
 * ------------------------------------------------------------------ */

/** Extract per-page text with pdfjs (no worker; independent of the browser). */
export async function pdfPageTexts(buf: Buffer): Promise<string[]> {
  expectMagic(buf, "pdf");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: new Uint8Array(buf),
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: 0,
  });
  const doc = await task.promise;
  try {
    const texts: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      texts.push(
        content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" "),
      );
    }
    return texts;
  } finally {
    await doc.destroy();
  }
}

/* ------------------------------------------------------------------ *
 *  ZIP
 * ------------------------------------------------------------------ */

export async function zipEntries(
  buf: Buffer,
): Promise<Map<string, Buffer>> {
  expectMagic(buf, "zip");
  const zip = await JSZip.loadAsync(buf);
  const out = new Map<string, Buffer>();
  for (const name of Object.keys(zip.files)) {
    const file = zip.files[name];
    if (!file || file.dir) continue;
    out.set(name, Buffer.from(await file.async("nodebuffer")));
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  Raster decode (via the browser under test)
 * ------------------------------------------------------------------ */

export interface DecodedImageStats {
  width: number;
  height: number;
  /** Pixels darker than mid-grey — "ink". */
  inkPixels: number;
  /** Pixels where red clearly dominates blue, and the reverse. */
  redPixels: number;
  bluePixels: number;
  totalPixels: number;
}

/**
 * Decode an image artifact with the browser's own decoder and report pixel
 * statistics. This is what catches the "well-formed but blank" render class
 * (the wasmUrl defect): magic bytes and dimensions pass, ink does not.
 */
export async function decodeImageInPage(
  page: Page,
  bytes: Buffer,
  mime: "image/png" | "image/jpeg",
): Promise<DecodedImageStats> {
  return page.evaluate(
    async ([b64, mimeType]) => {
      const img = new Image();
      img.src = `data:${mimeType};base64,${b64}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2d context unavailable");
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let ink = 0;
      let red = 0;
      let blue = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i] as number;
        const g = data[i + 1] as number;
        const b = data[i + 2] as number;
        if (r < 128 && g < 128 && b < 128) ink++;
        if (r > 160 && b < 96) red++;
        if (b > 160 && r < 96) blue++;
      }
      return {
        width: canvas.width,
        height: canvas.height,
        inkPixels: ink,
        redPixels: red,
        bluePixels: blue,
        totalPixels: canvas.width * canvas.height,
      };
    },
    [bytes.toString("base64"), mime] as const,
  );
}
