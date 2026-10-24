import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";
import JSZip from "jszip";
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
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
 * The raster images each page's resources hold, page by page — so a proof
 * can say WHICH page carries which image, not only that the file holds them.
 * (`pdfImages` walks every object in the file, in object order.)
 */
export async function pdfPageImages(
  buf: Buffer,
): Promise<Omit<PdfImageInfo, "bytes">[][]> {
  const doc = await loadPdf(buf);
  return doc.getPages().map((page) => {
    const xobjects = page.node
      .Resources()
      ?.lookupMaybe(PDFName.of("XObject"), PDFDict);
    if (!xobjects) return [];
    return [...xobjects.entries()].flatMap(([, ref]) => {
      const obj = doc.context.lookup(ref);
      if (!(obj instanceof PDFRawStream)) return [];
      const dict = obj.dict;
      if (dict.get(PDFName.of("Subtype"))?.toString() !== "/Image") return [];
      const num = (key: string): number => {
        const v = dict.get(PDFName.of(key));
        return v ? Number(v.toString()) : NaN;
      };
      return [
        {
          width: num("Width"),
          height: num("Height"),
          filter: dict.get(PDFName.of("Filter"))?.toString(),
          colorSpace: dict.get(PDFName.of("ColorSpace"))?.toString(),
          bitsPerComponent: num("BitsPerComponent"),
        },
      ];
    });
  });
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

/** A text run as a reader sees it: viewer points from the page's TOP-LEFT. */
export interface PdfTextRun {
  str: string;
  /** Baseline-left, viewer frame (after /Rotate and the CropBox), y down. */
  x: number;
  y: number;
  width: number;
  /** Glyphs read left to right, upright on screen. */
  upright: boolean;
}

/**
 * Per page: every text run's position in the frame a reader sees, through
 * pdfjs's own viewport transform — where `/Rotate` and the CropBox are
 * applied. The test-side twin of `src/tests/pdf-viewer-read.ts`, which cannot
 * be imported here (it reaches `import.meta` through `src/lib/pdf/pdfjs`).
 */
export async function pdfTextPositions(
  buf: Buffer,
): Promise<{ width: number; height: number; runs: PdfTextRun[] }[]> {
  expectMagic(buf, "pdf");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: new Uint8Array(buf),
    useWorkerFetch: false,
    disableFontFace: true,
    ...PDFJS_DOCUMENT_DEFAULTS,
    ...pdfjsAssetOptions(),
  });
  type M = [number, number, number, number, number, number];
  const mul = (m: M, n: M): M => [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
  try {
    const doc = await task.promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const runs: PdfTextRun[] = [];
      for (const item of content.items) {
        if (!("str" in item) || item.str.trim() === "") continue;
        const m = mul(vp.transform as M, item.transform as M);
        runs.push({
          str: item.str,
          x: m[4],
          y: m[5],
          width: item.width,
          upright:
            m[0] > 0 &&
            Math.abs(m[1]) < 1e-6 &&
            Math.abs(m[2]) < 1e-6 &&
            m[3] < 0,
        });
      }
      pages.push({ width: vp.width, height: vp.height, runs });
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

/** An annotation as a reader's viewer receives it (pdfjs `getAnnotations`). */
export interface PdfAnnotation {
  subtype: string;
  /** Viewer frame, points from the page's TOP-LEFT, y down. */
  rect: { x: number; y: number; width: number; height: number };
  url?: string;
  /** 0-based page a go-to link lands on. */
  destPage?: number;
  fieldName?: string;
  fieldType?: string;
  fieldValue?: unknown;
  checkBox?: boolean;
  radioButton?: boolean;
}

/**
 * Per page: the rotation pdfjs applies and every annotation — links and
 * form widgets — with its box mapped through the page's own viewport.
 */
export async function pdfAnnotations(
  buf: Buffer,
): Promise<{ rotate: number; annots: PdfAnnotation[] }[]> {
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
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const m = page.getViewport({ scale: 1 }).transform as number[];
      const to = (x: number, y: number) => [
        m[0]! * x + m[2]! * y + m[4]!,
        m[1]! * x + m[3]! * y + m[5]!,
      ];
      const annots: PdfAnnotation[] = [];
      for (const a of (await page.getAnnotations()) as Record<
        string,
        unknown
      >[]) {
        const r = a.rect as number[];
        const [x0, y0] = to(r[0]!, r[1]!);
        const [x1, y1] = to(r[2]!, r[3]!);
        let destPage: number | undefined;
        if (Array.isArray(a.dest) && a.dest[0]) {
          destPage = await doc.getPageIndex(a.dest[0]);
        }
        annots.push({
          subtype: a.subtype as string,
          rect: {
            x: Math.min(x0!, x1!),
            y: Math.min(y0!, y1!),
            width: Math.abs(x1! - x0!),
            height: Math.abs(y1! - y0!),
          },
          url: a.url as string | undefined,
          destPage,
          fieldName: a.fieldName as string | undefined,
          fieldType: a.fieldType as string | undefined,
          fieldValue: a.fieldValue,
          checkBox: a.checkBox as boolean | undefined,
          radioButton: a.radioButton as boolean | undefined,
        });
      }
      pages.push({ rotate: page.rotate, annots });
    }
    return pages;
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

/** A rectangle in PDF points with a bottom-left origin (the page's own space). */
export interface PagePointRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageRegionStats {
  /** Output page size in points (its CropBox). */
  pageWidth: number;
  pageHeight: number;
  /** The whole page image. */
  whole: DecodedImageStats;
  /** One entry per requested region, in request order. */
  regions: DecodedImageStats[];
}

/**
 * Decode each output page's own raster image and report pixel statistics for
 * the whole image AND for given regions of the page.
 *
 * Whole-image counts cannot tell WHERE ink is, and for a redaction that is the
 * entire question: a fixture that already has a black block under the box
 * satisfies "the page has dark pixels" with or without the box. Regions are
 * given in page points (bottom-left origin) and mapped here, independently of
 * the app's own point→pixel code, to the image's top-left pixel grid at the
 * image's px/pt scale, then shrunk by `insetPx` on every side so JPEG ringing
 * at an edge cannot decide a verdict.
 *
 * Images are found through each PAGE's /XObject resources, not by enumerating
 * the file, so page N's statistics are page N's — an enumeration order that
 * happened to match would be a guess.
 */
export async function decodePageRegions(
  page: Page,
  buf: Buffer,
  regions: PagePointRect[],
  insetPx = 3,
): Promise<PageRegionStats[]> {
  const doc = await loadPdf(buf);
  const out: PageRegionStats[] = [];
  for (const [index, pdfPage] of doc.getPages().entries()) {
    const { width: pageWidth, height: pageHeight } = pdfPage.getCropBox();
    const xobjects = pdfPage.node
      .Resources()
      ?.lookupMaybe(PDFName.of("XObject"), PDFDict);
    const images: PDFRawStream[] = [];
    for (const [, ref] of xobjects?.entries() ?? []) {
      const obj = doc.context.lookup(ref);
      if (
        obj instanceof PDFRawStream &&
        obj.dict.get(PDFName.of("Subtype"))?.toString() === "/Image" &&
        obj.dict.get(PDFName.of("Filter"))?.toString().includes("DCTDecode")
      ) {
        images.push(obj);
      }
    }
    expect(
      images.length,
      `output page ${index + 1} should carry exactly one JPEG page image`,
    ).toBe(1);
    const jpeg = Buffer.from(images[0]!.getContents());
    const pixelRegions = regions.map((r) => ({
      // Scale factors come from the decoded image, so they are resolved in
      // the page context below; pass the point geometry through.
      left: r.x / pageWidth,
      right: (r.x + r.width) / pageWidth,
      top: (pageHeight - r.y - r.height) / pageHeight,
      bottom: (pageHeight - r.y) / pageHeight,
    }));
    const decoded = await page.evaluate(
      async ([b64, fractions, inset]) => {
        const img = new Image();
        img.src = `data:image/jpeg;base64,${b64}`;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("2d context unavailable");
        ctx.drawImage(img, 0, 0);
        const W = canvas.width;
        const H = canvas.height;
        const { data } = ctx.getImageData(0, 0, W, H);
        const stats = (x0: number, y0: number, x1: number, y1: number) => {
          let ink = 0;
          let red = 0;
          let blue = 0;
          let white = 0;
          let total = 0;
          for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) {
              const i = (y * W + x) * 4;
              const r = data[i] as number;
              const g = data[i + 1] as number;
              const b = data[i + 2] as number;
              if (r < 128 && g < 128 && b < 128) ink++;
              if (r > 160 && b < 96) red++;
              if (b > 160 && r < 96) blue++;
              if (r > 240 && g > 240 && b > 240) white++;
              total++;
            }
          }
          return {
            width: Math.max(0, x1 - x0),
            height: Math.max(0, y1 - y0),
            inkPixels: ink,
            redPixels: red,
            bluePixels: blue,
            whitePixels: white,
            totalPixels: total,
          };
        };
        const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
        return {
          whole: stats(0, 0, W, H),
          regions: (
            fractions as {
              left: number;
              right: number;
              top: number;
              bottom: number;
            }[]
          ).map((f) =>
            stats(
              clamp(Math.ceil(f.left * W) + (inset as number), W),
              clamp(Math.ceil(f.top * H) + (inset as number), H),
              clamp(Math.floor(f.right * W) - (inset as number), W),
              clamp(Math.floor(f.bottom * H) - (inset as number), H),
            ),
          ),
        };
      },
      [jpeg.toString("base64"), pixelRegions, insetPx] as const,
    );
    for (const [i, region] of decoded.regions.entries()) {
      // A region that shrank to nothing would make every ratio NaN and every
      // "at least 98%" vacuous; say so instead.
      expect(
        region.totalPixels,
        `region #${i + 1} on page ${index + 1} covers no pixels after the inset`,
      ).toBeGreaterThan(100);
    }
    out.push({ pageWidth, pageHeight, ...decoded });
  }
  return out;
}
