import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { Page } from "@playwright/test";
import { drawRasterImage, embedRasterImage } from "../../src/lib/pdf/pdf-lib";

/**
 * Fixture generators for the in-browser tool proofs. Every input is synthesized
 * per run — never a committed sample and never a user document — following the
 * same rule `scripts/worker-prove-tools.ts` states for the worker proofs.
 *
 * Each page carries two things on purpose:
 *  - a MARKER line (`pageMarker(label, n)`) that content assertions can look
 *    for, so "the right pages, in the right order" is checkable after any
 *    structural operation;
 *  - a solid black rectangle, so raster outputs (PNG/JPG renders, redact,
 *    grayscale) contain ink a pixel count can see. A blank-but-well-formed
 *    render — the exact shape of the historical `wasmUrl` defect — fails the
 *    ink assertion instead of passing on file magic alone.
 */

/** The marker line drawn on page `n` (1-based) of a fixture labelled `label`. */
export function pageMarker(label: string, n: number): string {
  return `${label}::page-${n}`;
}

export interface TextPdfOptions {
  pages?: number;
  /** Page size in points. Defaults to 320x240 (fast to rasterize). */
  size?: [number, number];
  /** Extra body lines drawn under the marker on every page. */
  bodyLines?: string[];
  /** Save without object streams (bloats the file so a repack shrinks it). */
  unoptimized?: boolean;
  /**
   * Draw saturated red and blue blocks instead of the black one. Required by
   * the grayscale proof: the default fixture is already achromatic, so
   * "the output has no colour" would be true of it before the tool ran.
   */
  colorful?: boolean;
}

/** A valid multi-page PDF with per-page marker text and an ink rectangle. */
export async function makeTextPdf(
  label: string,
  {
    pages = 2,
    size = [320, 240],
    bodyLines = [],
    unoptimized,
    colorful,
  }: TextPdfOptions = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage(size);
    const [w, h] = size;
    page.drawText(pageMarker(label, i + 1), {
      x: 20,
      y: h - 40,
      size: 14,
      font,
    });
    bodyLines.forEach((line, j) => {
      page.drawText(line, { x: 20, y: h - 64 - j * 16, size: 10, font });
    });
    // Ink for raster assertions: a solid block, ~1/5 of the page. In colour
    // mode it is split red/blue so a desaturation can be measured.
    if (colorful) {
      page.drawRectangle({
        x: w * 0.1,
        y: h * 0.15,
        width: w * 0.35,
        height: h * 0.5,
        color: rgb(1, 0, 0),
      });
      page.drawRectangle({
        x: w * 0.5,
        y: h * 0.15,
        width: w * 0.35,
        height: h * 0.5,
        color: rgb(0, 0, 1),
      });
    } else {
      page.drawRectangle({
        x: w * 0.1,
        y: h * 0.15,
        width: w * 0.5,
        height: h * 0.35,
        color: rgb(0, 0, 0),
      });
    }
  }
  return doc.save(unoptimized ? { useObjectStreams: false } : undefined);
}

/**
 * A PDF carrying a fillable AcroForm: one text field (`e2e.name`, prefilled
 * "Ada Lovelace") and one checked checkbox (`e2e.agree`). The prefill matters:
 * the fill-forms proof writes a DIFFERENT value, so the assertion can tell the
 * filled artifact from the input.
 */
export async function makeFormPdf(label: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([320, 240]);
  page.drawText(pageMarker(label, 1), { x: 20, y: 210, size: 12, font });
  const form = doc.getForm();
  const name = form.createTextField("e2e.name");
  name.setText("Ada Lovelace");
  name.addToPage(page, { x: 24, y: 160, width: 200, height: 20 });
  const agree = form.createCheckBox("e2e.agree");
  agree.check();
  agree.addToPage(page, { x: 24, y: 130, width: 16, height: 16 });
  return doc.save();
}

/**
 * A PDF with one embedded raster image (a generated PNG) and no other content
 * besides the marker — the extract-images input. The image is a red/blue
 * split so a decode of the extracted artifact can check actual pixel content.
 */
export async function makeImageBearingPdf(label: string): Promise<{
  pdf: Uint8Array;
  imageWidth: number;
  imageHeight: number;
}> {
  const width = 96;
  const height = 64;
  const png = encodePng(rgbSplit(width, height), width, height);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([320, 240]);
  page.drawText(pageMarker(label, 1), { x: 20, y: 210, size: 12, font });
  const image = await embedRasterImage(doc, png, "png");
  await drawRasterImage(page, image, { x: 40, y: 60, width: 192, height: 128 });
  return { pdf: await doc.save(), imageWidth: width, imageHeight: height };
}

/**
 * Copy bytes into a Buffer that OWNS its ArrayBuffer.
 *
 * `Buffer.from(string, "base64")` serves small results out of Node's shared
 * 8 KB pool, so the returned view has a non-zero `byteOffset`. pdf-lib 1.17.1's
 * JpegEmbedder then does `new DataView(data.buffer)` — dropping the offset — and
 * reads the pool's first two bytes instead of the image's, failing with
 * "SOI not found in JPEG" on a perfectly valid JPEG.
 *
 * The nasty part is that it depends on SIZE: a ~1 KB blank JPEG is pooled and
 * breaks, while the larger red/blue one is allocated outright and works. So the
 * same helper passed in one case and failed in another, and the error named the
 * image rather than the allocator. `Buffer.alloc` never uses the pool.
 *
 * TASK-75 moved the real fix to the boundary — `embedRasterImage` normalizes
 * the offset for every embed in the repo, so this is no longer load-bearing for
 * the embed. It stays because a fixture that OWNS its bytes is independently
 * worth having: these buffers are written to temp files and handed to a
 * browser, and a view into a shared pool is a footgun in both places.
 */
function detached(bytes: Buffer): Buffer {
  const owned = Buffer.alloc(bytes.length);
  bytes.copy(owned);
  return owned;
}

/** Write bytes to a fresh temp file and return its absolute path. */
export function writeTempFixture(name: string, bytes: Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), "pdfxyz-proof-"));
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
}

/* ------------------------------------------------------------------ *
 *  Raster fixtures (PNG in Node, JPEG via the browser's own encoder)
 * ------------------------------------------------------------------ */

/** Left half red, right half blue — unmistakable under any correct decode. */
function rgbSplit(width: number, height: number): Buffer {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 3;
      if (x < width / 2) raw[o] = 0xff;
      else raw[o + 2] = 0xff;
    }
  }
  return raw;
}

/**
 * Minimal PNG encoder (8-bit truecolour, filter 0) — mirrors the reviewable
 * byte-level approach of the worker proof harness rather than importing from
 * it (that file is being edited in parallel and is owned by another task).
 */
export function encodePng(
  rgbData: Buffer,
  width: number,
  height: number,
): Buffer {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: none
    rgbData.copy(raw, y * stride + 1, y * width * 3, (y + 1) * width * 3);
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

let CRC_TABLE: Int32Array | null = null;
function crc32(buf: Buffer): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return c ^ 0xffffffff;
}

/** A generated PNG file on disk: red/blue split at the stated size. */
export function makePngFixture(
  name: string,
  width = 400,
  height = 300,
): { path: string; bytes: Buffer; width: number; height: number } {
  const bytes = encodePng(rgbSplit(width, height), width, height);
  return { path: writeTempFixture(name, bytes), bytes, width, height };
}

/**
 * A PDF of `pages` pages, each covered edge to edge by the supplied JPEG.
 *
 * This is the shape every rasterizing tool here produces (grayscale-pdf,
 * redact-pdf), so it can stand in as their control: hand it a BLANK jpeg and
 * it is "a rasterized output that rendered nothing"; hand it a COLOUR jpeg and
 * it is "a rasterized output that forgot to desaturate". Both are structurally
 * indistinguishable from a correct artifact, which is the point.
 */
export async function makeRasterizedPdf(
  jpeg: Buffer,
  pages: number,
  size: [number, number],
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const image = await embedRasterImage(doc, jpeg, "jpg");
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage(size);
    await drawRasterImage(page, image, {
      x: 0,
      y: 0,
      width: size[0],
      height: size[1],
    });
  }
  return Buffer.from(await doc.save());
}

/**
 * A blank white image of exactly the given size, encoded by the browser.
 *
 * This is the positive control for every raster proof: it is well formed, it
 * has the right magic bytes and the right dimensions, and it contains nothing.
 * That is precisely what the pdfjs `wasmUrl` defect shipped — pages that
 * decoded to an empty raster while the tool reported success — so a raster
 * assertion that accepts this is blind to the one defect the raster path has
 * actually had.
 */
export async function makeBlankImageInPage(
  page: Page,
  mime: "image/png" | "image/jpeg",
  width: number,
  height: number,
): Promise<Buffer> {
  const dataUrl = await page.evaluate(
    ([w, h, type]) => {
      const canvas = document.createElement("canvas");
      canvas.width = w as number;
      canvas.height = h as number;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2d context unavailable");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w as number, h as number);
      return canvas.toDataURL(type as string, 0.92);
    },
    [width, height, mime] as const,
  );
  const base64 = dataUrl.split(",")[1];
  if (!base64) throw new Error("canvas.toDataURL returned no payload");
  const bytes = detached(Buffer.from(base64, "base64"));
  assertEncodedAs(bytes, mime, dataUrl);
  return bytes;
}

/**
 * A fixture that is not the format it claims is a silent hole: it makes the
 * control it feeds unrepresentative, and the failure surfaces far away as a
 * parse error inside pdf-lib. Check it where it is made, and say what arrived.
 */
function assertEncodedAs(
  bytes: Buffer,
  mime: "image/png" | "image/jpeg",
  dataUrl: string,
): void {
  const ok =
    mime === "image/jpeg"
      ? bytes[0] === 0xff && bytes[1] === 0xd8
      : bytes
          .subarray(0, 8)
          .equals(
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          );
  if (!ok) {
    throw new Error(
      `the browser was asked for ${mime} but returned ${dataUrl.slice(0, 32)}… ` +
        `(first bytes ${[...bytes.subarray(0, 4)].map((b) => b.toString(16)).join(" ")})`,
    );
  }
}

/**
 * A generated JPEG, encoded by the browser under test via a canvas — no JPEG
 * encoder dependency in Node, and the bytes are still synthesized per run.
 * Runs inside the already-loaded tool page, so the CSP in force is the
 * production one.
 */
export async function makeJpegFixtureInPage(
  page: Page,
  name: string,
  width = 400,
  height = 300,
): Promise<{ path: string; bytes: Buffer; width: number; height: number }> {
  const dataUrl = await page.evaluate(
    ([w, h]) => {
      const canvas = document.createElement("canvas");
      canvas.width = w as number;
      canvas.height = h as number;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2d context unavailable");
      ctx.fillStyle = "#ff0000";
      ctx.fillRect(0, 0, (w as number) / 2, h as number);
      ctx.fillStyle = "#0000ff";
      ctx.fillRect((w as number) / 2, 0, (w as number) / 2, h as number);
      return canvas.toDataURL("image/jpeg", 0.92);
    },
    [width, height],
  );
  const base64 = dataUrl.split(",")[1];
  if (!base64) throw new Error("canvas.toDataURL returned no payload");
  const bytes = detached(Buffer.from(base64, "base64"));
  assertEncodedAs(bytes, "image/jpeg", dataUrl);
  return { path: writeTempFixture(name, bytes), bytes, width, height };
}
