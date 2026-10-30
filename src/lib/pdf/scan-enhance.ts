/**
 * Scan to PDF's clean-up filters — pure functions over RGBA pixels, no DOM, so
 * the browser runner and the Node tests run the same code.
 *
 *  - "original": the photo as taken (colour).
 *  - "document": high-contrast grayscale. Luminance (Rec. 601), then the
 *    darkest and lightest {@link DOCUMENT_CLIP} of pixels are clipped and the
 *    rest stretched across 0–255, so a grey, dim photo of paper becomes white
 *    paper with dark text. One channel: the PDF stores it as DeviceGray.
 *  - "bw": black & white, 1 bit per pixel. A fixed threshold fails on a
 *    phone photo — the corner nearest the window is lighter than the one in
 *    your shadow — so each pixel is compared with the MEAN of the window
 *    around it (Bradley's adaptive threshold, via an integral image): darker
 *    than that mean by more than {@link BW_SENSITIVITY} is ink, the rest is
 *    paper. The window is an eighth of the image's width, so a thumbnail and
 *    the full photo threshold the same way.
 *
 * There is no automatic page-edge detection or perspective correction: the
 * photo is used as framed. `scan-to-pdf.test.ts` holds each filter to what it
 * claims (one channel; only 0 and 255; an uneven background read as paper).
 */

export type ScanEnhancement = "original" | "document" | "bw";

export const SCAN_ENHANCEMENTS: readonly {
  id: ScanEnhancement;
  label: string;
  hint: string;
}[] = [
  { id: "original", label: "Original", hint: "The photo's own colours." },
  {
    id: "document",
    label: "Document",
    hint: "High-contrast grayscale: whiter paper, darker text.",
  },
  {
    id: "bw",
    label: "Black & white",
    hint: "Pure black and white, the smallest file. Best for text.",
  },
];

/** Share of pixels clipped at each end by "document" before stretching. */
export const DOCUMENT_CLIP = 0.01;

/** "bw": a pixel this much darker than its neighbourhood's mean is ink. */
export const BW_SENSITIVITY = 0.15;

/** One 8-bit sample per pixel (Rec. 601 luma), row-major, top row first. */
export function luminance(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const n = rgba.length >> 2;
  const out = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i += 1, p += 4) {
    out[i] = Math.round(
      0.299 * rgba[p]! + 0.587 * rgba[p + 1]! + 0.114 * rgba[p + 2]!,
    );
  }
  return out;
}

/** "document": luminance, clipped and stretched to the full 0–255 range. */
export function documentPlane(
  rgba: Uint8ClampedArray | Uint8Array,
): Uint8Array {
  const plane = luminance(rgba);
  const histogram = new Uint32Array(256);
  for (const v of plane) histogram[v]! += 1;
  const clip = Math.floor(plane.length * DOCUMENT_CLIP);
  let low = 0;
  for (let seen = 0; low < 255; low += 1) {
    seen += histogram[low]!;
    if (seen > clip) break;
  }
  let high = 255;
  for (let seen = 0; high > 0; high -= 1) {
    seen += histogram[high]!;
    if (seen > clip) break;
  }
  if (high <= low) return plane;
  const span = high - low;
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v += 1) {
    lut[v] = Math.max(0, Math.min(255, Math.round(((v - low) / span) * 255)));
  }
  for (let i = 0; i < plane.length; i += 1) plane[i] = lut[plane[i]!]!;
  return plane;
}

/**
 * "bw": 0 (ink) or 255 (paper) per pixel, by Bradley's adaptive threshold
 * over an integral image of the luminance.
 */
export function blackWhitePlane(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const plane = luminance(rgba);
  if (plane.length !== width * height) {
    throw new RangeError(
      `blackWhitePlane: ${plane.length} pixels for ${width}×${height}.`,
    );
  }
  // Integral image, one row and column of padding: sum[y][x] is the total of
  // every pixel above and to the left of (x, y).
  const stride = width + 1;
  const sum = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let row = 0;
    for (let x = 0; x < width; x += 1) {
      row += plane[y * width + x]!;
      sum[(y + 1) * stride + x + 1] = sum[y * stride + x + 1]! + row;
    }
  }
  const half = Math.max(1, Math.floor(width / 16));
  const out = new Uint8Array(plane.length);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - half);
    const y1 = Math.min(height, y + half + 1);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(width, x + half + 1);
      const area = (x1 - x0) * (y1 - y0);
      const total =
        sum[y1 * stride + x1]! -
        sum[y0 * stride + x1]! -
        sum[y1 * stride + x0]! +
        sum[y0 * stride + x0]!;
      const i = y * width + x;
      out[i] = plane[i]! * area < total * (1 - BW_SENSITIVITY) ? 0 : 255;
    }
  }
  return out;
}

/**
 * Pack a 0/255 plane into 1-bit rows (MSB first, each row padded to a whole
 * byte), as a PDF image with `/BitsPerComponent 1 /ColorSpace /DeviceGray`
 * reads it: 0 is black, 1 is white.
 */
export function packBits(
  plane: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const rowBytes = Math.ceil(width / 8);
  const out = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (plane[y * width + x]! >= 128) {
        out[y * rowBytes + (x >> 3)]! |= 0x80 >> (x & 7);
      }
    }
  }
  return out;
}

/** A gray plane back to opaque RGBA, for drawing a preview on a canvas. */
export function planeToRgba(plane: Uint8Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(plane.length * 4);
  for (let i = 0, p = 0; i < plane.length; i += 1, p += 4) {
    const v = plane[i]!;
    out[p] = v;
    out[p + 1] = v;
    out[p + 2] = v;
    out[p + 3] = 255;
  }
  return out;
}
