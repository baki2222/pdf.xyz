import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";
import JSZip from "jszip";
import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import {
  expect,
  type Download,
  type Locator,
  type Page,
} from "@playwright/test";
import { PDFJS_DOCUMENT_DEFAULTS } from "../../src/lib/pdf/wasm-assets";

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

const PDF_MAGIC = Buffer.from("%PDF-", "latin1");
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
/** Local file header. A one-byte "is it P?" test is not a ZIP test: the
 *  compare report opens with "PDF comparison:", and the first spelling of this
 *  check rejected it as a leaked archive. Every signature below is matched at
 *  full length for that reason. */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

const startsWith = (buf: Buffer, magic: Buffer): boolean =>
  buf.subarray(0, magic.length).equals(magic);

/** Assert the artifact's container type from its leading bytes. */
export function expectMagic(buf: Buffer, kind: ArtifactKind): void {
  switch (kind) {
    case "pdf":
      expect(startsWith(buf, PDF_MAGIC), "PDF magic").toBe(true);
      break;
    case "png":
      expect(startsWith(buf, PNG_MAGIC), "PNG magic").toBe(true);
      break;
    case "jpg":
      expect(startsWith(buf, JPEG_MAGIC), "JPEG SOI").toBe(true);
      break;
    case "zip":
      expect(startsWith(buf, ZIP_MAGIC), "ZIP local file header").toBe(true);
      break;
    case "text":
      // A text artifact must NOT be a binary container that leaked through —
      // the check that makes an identity control meaningful for text outputs.
      expect(startsWith(buf, PDF_MAGIC), "text artifact is a PDF").toBe(false);
      expect(startsWith(buf, ZIP_MAGIC), "text artifact is a ZIP").toBe(false);
      expect(startsWith(buf, PNG_MAGIC), "text artifact is a PNG").toBe(false);
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
      textValues[field.getName()] = form
        .getTextField(field.getName())
        .getText();
    }
  }
  return { fieldNames: fields.map((f) => f.getName()), textValues };
}

export interface PdfImageInfo {
  width: number;
  height: number;
  filter: string | undefined;
  colorSpace: string | undefined;
  bitsPerComponent: number;
  /** The image XObject's raw stream bytes, before any PDF-level filter. */
  bytes: Buffer;
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
      bitsPerComponent: num("BitsPerComponent"),
      bytes: Buffer.from(obj.getContents()),
    });
  }
  return images;
}

/**
 * Decode the JPEG page images a rasterizing tool embedded, and report their
 * pixel statistics.
 *
 * This exists because "the output contains images and no selectable text" is
 * satisfied by a page of pure white. That is not a hypothetical: it is exactly
 * what the pdfjs `wasmUrl` defect produced — a well-formed render with nothing
 * in it — and grayscale-pdf and redact-pdf both run through the same
 * `rasterizePdf` path that defect lived in. A structural assertion cannot see
 * it; only the pixels can.
 */
export async function decodeEmbeddedJpegs(
  page: Page,
  buf: Buffer,
): Promise<DecodedImageStats[]> {
  const images = await pdfImages(buf);
  const jpegs = images.filter((image) => image.filter?.includes("DCTDecode"));
  expect(
    jpegs.length,
    "no DCTDecode image XObjects to decode — this artifact was not rasterized the way the assertion assumes",
  ).toBeGreaterThan(0);
  const stats: DecodedImageStats[] = [];
  for (const jpeg of jpegs) {
    stats.push(await decodeImageInPage(page, jpeg.bytes, "image/jpeg"));
  }
  return stats;
}

/**
 * Decode EVERY page image a rasterizing tool embedded, whatever it was stored
 * as, and report pixel statistics — the grayscale tool keeps each page as
 * whichever is smaller of a one-component JPEG and a Flate-compressed
 * DeviceGray plane, so a JPEG-only reader would see only some of its pages
 * (and, on a text-only fixture, none of them).
 *
 *  - `DCTDecode` → decoded by the browser under test, as `decodeEmbeddedJpegs`.
 *  - `FlateDecode` over 8-bit `DeviceGray` → inflated here; the samples ARE
 *    the pixels.
 *
 * Any other image shape FAILS rather than being skipped: a reader that
 * silently skipped what it could not decode would report a blank page as
 * "nothing to check".
 */
export async function decodeEmbeddedPageImages(
  page: Page,
  buf: Buffer,
): Promise<DecodedImageStats[]> {
  const images = await pdfImages(buf);
  expect(
    images.length,
    "no image XObjects to decode — this artifact was not rasterized",
  ).toBeGreaterThan(0);
  const stats: DecodedImageStats[] = [];
  for (const image of images) {
    if (image.filter?.includes("DCTDecode")) {
      stats.push(await decodeImageInPage(page, image.bytes, "image/jpeg"));
      continue;
    }
    expect(
      [image.filter, image.colorSpace, image.bitsPerComponent],
      "an embedded page image this reader cannot decode",
    ).toEqual(["/FlateDecode", "/DeviceGray", 8]);
    const samples = inflateSync(image.bytes);
    expect(samples.length, "inflated plane does not match /Width×/Height").toBe(
      image.width * image.height,
    );
    let ink = 0;
    let white = 0;
    for (const v of samples) {
      if (v < 128) ink++;
      if (v > 240) white++;
    }
    stats.push({
      width: image.width,
      height: image.height,
      inkPixels: ink,
      // One channel: there is no hue for either count to find.
      redPixels: 0,
      bluePixels: 0,
      whitePixels: white,
      totalPixels: samples.length,
    });
  }
  return stats;
}

/**
 * Collapse runs of whitespace. pdfjs emits one text item per positioned run,
 * so a line the engine drew as one string can come back split — the
 * text-to-pdf proof read back `"the quick brown   fox"`. The property those
 * assertions claim is "this content reached the page", not "the kerning is
 * unchanged", so they compare normalized.
 *
 * Deliberately NOT applied to the per-page `pageMarker` assertions: those carry
 * no spaces, so a split there would be a real defect and must stay visible.
 */
export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/* ------------------------------------------------------------------ *
 *  PDF text (pdfjs, in the test process)
 * ------------------------------------------------------------------ */

/**
 * Local overrides for the TEST-SIDE pdfjs reader.
 *
 * `PDFJS_DOCUMENT_DEFAULTS` IS spread below — deliberately, so this reader
 * inherits every future option the app adds — but two of its values cannot
 * survive the move: `wasmUrl` and `cMapUrl` are same-origin HTTP paths served
 * by the Next app, and this reader runs in the Node test process where those
 * resolve to nothing. Dropping them silently is exactly the shape of defect
 * that module exists to prevent (a reader with no decoders returns a blank page
 * and no error), so they are re-derived from the installed package, pointing at
 * the very files `scripts/copy-pdfjs-wasm.ts` copies into `public/`.
 *
 * Note for whoever widens `src/lib/pdf/wasm-assets.test.ts`: that guard walks
 * `src` and `scripts` only, so this call site sits outside the set it searches.
 */
const pdfjsAssetOptions = (): {
  wasmUrl: string;
  cMapUrl: string;
  cMapPacked: true;
} => {
  // Resolved from the project root rather than from `import.meta.url`:
  // Playwright transpiles specs to CommonJS, where `import.meta` is a syntax
  // error at load time. `process.cwd()` is the config's root directory — the
  // same anchor `e2e/global-setup.ts` uses to find `.next`.
  const require = createRequire(join(process.cwd(), "package.json"));
  const dir = dirname(require.resolve("pdfjs-dist/package.json"));
  const dirUrl = (name: string) => `${pathToFileURL(join(dir, name)).href}/`;
  return {
    wasmUrl: dirUrl("wasm"),
    cMapUrl: dirUrl("cmaps"),
    cMapPacked: true,
  };
};

/** Extract per-page text with pdfjs (no worker; independent of the browser). */
export async function pdfPageTexts(buf: Buffer): Promise<string[]> {
  expectMagic(buf, "pdf");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: new Uint8Array(buf),
    useWorkerFetch: false,
    disableFontFace: true,
    ...PDFJS_DOCUMENT_DEFAULTS,
    ...pdfjsAssetOptions(),
  });
  try {
    const doc = await task.promise;
    const texts: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      texts.push(
        content.items.map((item) => ("str" in item ? item.str : "")).join(" "),
      );
    }
    return texts;
  } finally {
    await task.destroy();
  }
}

/* ------------------------------------------------------------------ *
 *  ZIP
 * ------------------------------------------------------------------ */

export async function zipEntries(buf: Buffer): Promise<Map<string, Buffer>> {
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
  /**
   * Near-white pixels. `inkPixels` alone cannot see a mid-grey render: a
   * grayscale conversion turns saturated red into ~0x4c and blue into ~0x1d,
   * both of which happen to be dark — but a lighter colour would not be, and
   * "not white" is the property those proofs actually mean by "drawn".
   */
  whitePixels: number;
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
      let white = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i] as number;
        const g = data[i + 1] as number;
        const b = data[i + 2] as number;
        if (r < 128 && g < 128 && b < 128) ink++;
        if (r > 160 && b < 96) red++;
        if (b > 160 && r < 96) blue++;
        if (r > 240 && g > 240 && b > 240) white++;
      }
      return {
        width: canvas.width,
        height: canvas.height,
        inkPixels: ink,
        redPixels: red,
        bluePixels: blue,
        whitePixels: white,
        totalPixels: canvas.width * canvas.height,
      };
    },
    [bytes.toString("base64"), mime] as const,
  );
}
