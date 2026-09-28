/**
 * The ONE dynamic boundary in front of `pdf-lib` — the heaviest chunk any tool
 * page ships (~412 KB uncompressed, a third of the page), and the reason a
 * visitor who only READS a tool page used to pay for the engine they had not
 * asked to run yet.
 *
 * Every operation module under `src/lib/pdf/` gets its pdf-lib VALUES through
 * {@link loadPdfLib} at call time; only type-level imports (`import type`)
 * remain at module top, which erase at build time. That moves the engine out of
 * every tool page's initial chunk list while keeping module APIs untouched —
 * the same shape `page-count.ts` has used since it was written, generalized.
 *
 * Why not `next/dynamic` on the runners: measured in #45 — per-runner dynamic()
 * added chunk overhead and the shared baseline dominated, so the two most-used
 * tools got BIGGER. The weight is pdf-lib itself; this boundary sits exactly on
 * it and nothing else.
 *
 * {@link warmPdfLib} starts the download without awaiting it. The Dropzone
 * calls it the moment files arrive, so by the time a hand moves from the picker
 * to the run button the chunk is usually already here. Deliberately fire-and-
 * forget and error-swallowing: a failed warm-up must never surface — the real
 * `await` inside the operation will retry and report through the op's own
 * error path.
 *
 * It is also the one place allowed to call pdf-lib's raster image embedders —
 * see {@link embedRasterImage}, and the boundary guard that keeps it the only
 * one (`raster-embedder-boundary.test.ts`).
 */

import type { PDFDocument, PDFImage, PDFPage, Rotation } from "pdf-lib";
import {
  orientationMatrix,
  swapsAxes,
  uprightJpeg,
  type ExifOrientation,
} from "./jpeg-orientation";

/** The whole pdf-lib module, for helpers that thread it through sync code. */
export type PdfLibModule = typeof import("pdf-lib");

let loaded: Promise<PdfLibModule> | null = null;

/** Load (once) and return the pdf-lib module. */
export function loadPdfLib(): Promise<typeof import("pdf-lib")> {
  loaded ??= import("pdf-lib").catch((error) => {
    // Success is memoized; a rejection must not be. The failure is transient
    // (an offline blip at fetch time) but a cached rejection is permanent —
    // the typed-source tools reach this loader with no file pick and no warm,
    // so one failed attempt would brick every later run until a full reload.
    loaded = null;
    throw error;
  });
  return loaded;
}

/** Begin fetching pdf-lib without waiting for it (call on file pick). */
export function warmPdfLib(): void {
  void loadPdfLib().catch(() => {
    // Swallowed: the operation's own await is the surface that reports errors,
    // and the loader itself already forgets a failed attempt.
  });
}

/** The two raster image containers pdf-lib can embed. */
export type RasterImageFormat = "jpg" | "png";

/**
 * Give the embedder a view it cannot misread: offset 0, exact length, own
 * buffer. Returns the input untouched when it is already that shape, so the
 * paths we actually ship — a `File`/`Blob` read into a fresh `Uint8Array`, a
 * per-page JPEG off the rasterizer — copy nothing.
 *
 * `new Uint8Array(bytes)` and NOT `bytes.slice()`. On a Node `Buffer`,
 * `.slice()` is the deprecated alias for `subarray`: it returns a view with the
 * SAME `byteOffset`, sharing memory, so the "copy" is a no-op precisely for the
 * inputs that need it. The typed-array constructor copies for both a `Buffer`
 * and a plain view. (Measured, not remembered — `buf.slice().byteOffset` came
 * back as 8 for a `Buffer` at offset 8.)
 */
function normalizeImageBytes(bytes: Uint8Array): Uint8Array {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes
    : new Uint8Array(bytes);
}

/**
 * Embed a JPEG or PNG, from bytes in ANY valid `Uint8Array` shape.
 *
 * pdf-lib 1.17.1's `JpegEmbedder.for` reads the header through
 * `new DataView(imageData.buffer)` — the whole ArrayBuffer, discarding
 * `byteOffset` and `byteLength`. Hand it a view (a pooled Node `Buffer`, a
 * `subarray`) and it reads whatever precedes the image and throws
 * `SOI not found in JPEG` on a valid file. Every engine that embeds an image
 * catches that and re-words it as a problem with the user's file, so the bug
 * arrives disguised as bad input.
 *
 * Fixing it HERE rather than at each engine is the point: there were five call
 * sites when this was written, two of them (`grayscalePdf`, `redactPdf`) fed
 * by a browser canvas that no unit test could reach. (`grayscalePdf` has since
 * stopped embedding canvas output: it embeds its own one-component JPEG from
 * `gray-jpeg.ts`, and a jsdom runner test drives it end to end.) Five copies
 * of the same three lines is how the sixth call site gets missed.
 *
 * Upstream is not the answer for now: `pdf-lib@1.17.1` is still `latest` on npm
 * (published 2021-11-06) and `Hopding/pdf-lib@master` carries the same line, so
 * there is nothing to upgrade to. The maintained fork `@cantoo/pdf-lib` passes
 * `byteOffset`/`byteLength` — a dependency swap, decided separately.
 */
export async function embedRasterImage(
  doc: PDFDocument,
  bytes: Uint8Array,
  format: RasterImageFormat,
): Promise<PDFImage> {
  if (format === "png") return doc.embedPng(normalizeImageBytes(bytes));
  // The DCT stream is embedded as-is (lossless); only a turn requested by EXIF
  // is lifted out of it and recorded for {@link drawRasterImage}.
  const upright = uprightJpeg(bytes);
  const image = await doc.embedJpg(normalizeImageBytes(upright.bytes));
  if (upright.orientation !== 1) orientations.set(image, upright.orientation);
  return image;
}

/**
 * The EXIF turn each embedded JPEG still owes, keyed by the image itself so it
 * cannot be separated from it: whoever holds the `PDFImage` holds the turn.
 * Only {@link drawRasterImage} reads it, and `raster-draw-boundary.test.ts`
 * keeps every module that embeds through here drawing through there — a bare
 * `page.drawImage` would lay the stored pixels down on their side again.
 */
const orientations = new WeakMap<PDFImage, ExifOrientation>();

/**
 * The size an embedded image is SHOWN at, in pixels: what a browser reports as
 * its natural size. A portrait phone photo is stored 4032×3024 and shown
 * 3024×4032; fitting it to a page must use the second.
 */
export function rasterDisplaySize(image: PDFImage): {
  width: number;
  height: number;
} {
  const orientation = orientations.get(image) ?? 1;
  return swapsAxes(orientation)
    ? { width: image.height, height: image.width }
    : { width: image.width, height: image.height };
}

/**
 * Draw an image from {@link embedRasterImage} upright into `box` — a box in
 * DISPLAY shape ({@link rasterDisplaySize}).
 *
 * An image with no turn owed goes through `page.drawImage` exactly as before,
 * so upright JPEGs and every PNG produce the same content stream they always
 * did. A turned one is drawn through ONE matrix for all eight orientations
 * (see `orientationMatrix`), with the same `q … gs … cm … Do Q` shape pdf-lib
 * writes, so opacity behaves the same on both paths.
 *
 * `rotate` is pdf-lib's own `drawImage` option — the box turned about its
 * `(x, y)` corner, which is how Edit PDF anchors an image on a page the reader
 * sees rotated. On the turned path it is the same translate-then-rotate
 * pdf-lib applies, composed BEFORE the orientation matrix, so the EXIF turn
 * happens inside the box and the page turn moves the box.
 */
export async function drawRasterImage(
  page: PDFPage,
  image: PDFImage,
  box: {
    x: number;
    y: number;
    width: number;
    height: number;
    opacity?: number;
    rotate?: Rotation;
  },
): Promise<void> {
  const orientation = orientations.get(image) ?? 1;
  if (orientation === 1) {
    page.drawImage(image, box);
    return;
  }
  const {
    concatTransformationMatrix,
    drawObject,
    popGraphicsState,
    pushGraphicsState,
    setGraphicsState,
    toRadians,
  } = await loadPdfLib();
  const name = page.node.newXObject("Image", image.ref);
  const state =
    box.opacity === undefined
      ? []
      : [
          setGraphicsState(
            page.node.newExtGState(
              "GS",
              page.doc.context.obj({ Type: "ExtGState", ca: box.opacity }),
            ),
          ),
        ];
  const angle = box.rotate ? toRadians(box.rotate) : 0;
  const placement =
    angle === 0
      ? [concatTransformationMatrix(...orientationMatrix(orientation, box))]
      : [
          concatTransformationMatrix(
            Math.cos(angle),
            Math.sin(angle),
            -Math.sin(angle),
            Math.cos(angle),
            box.x,
            box.y,
          ),
          concatTransformationMatrix(
            ...orientationMatrix(orientation, { ...box, x: 0, y: 0 }),
          ),
        ];
  page.pushOperators(
    pushGraphicsState(),
    ...state,
    ...placement,
    drawObject(name),
    popGraphicsState(),
  );
}
