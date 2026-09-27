/**
 * The EXIF Orientation of a JPEG, and the page transform that honours it.
 *
 * A phone saves a portrait photo as LANDSCAPE pixels plus an EXIF tag that
 * says "turn me 90° to show me". Every browser honours that tag — the preview
 * grid in PNG/JPG to PDF, and the size an `<img>` reports to the editor, are
 * both upright — but pdf-lib embeds a JPEG as its raw DCT stream and never
 * reads APP1, and a PDF has no notion of EXIF. So the PDF got the raw pixels:
 * every portrait phone photo came out lying on its side, sized as a landscape.
 *
 * The fix keeps the lossless passthrough (the DCT stream is embedded as-is, at
 * its stored size) and moves the turn into the page's content stream: the
 * image is drawn through the matrix {@link orientationMatrix} builds, into a
 * box that has the DISPLAY shape.
 *
 * This module is pure (no pdf-lib values), so the table can be tested without
 * a document and the drawing helper in `pdf-lib.ts` stays the only place that
 * turns it into operators.
 */

/** TIFF/EXIF orientation values 1..8 (1 = stored upright). */
export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

interface OrientationTag {
  orientation: ExifOrientation;
  /** Absolute offset of the tag's 2-byte SHORT value in the file. */
  valueOffset: number;
  littleEndian: boolean;
}

const ORIENTATION_TAG = 0x0112;
const TIFF_SHORT = 3;

/**
 * Find the Orientation tag the way a browser does: the first APP1 segment that
 * carries an `Exif\0\0` header, anywhere before the scan starts (so APP0/JFIF,
 * XMP APP1 and ICC APP2 segments ahead of it are walked past), IFD0 entry
 * 0x0112 of type SHORT, count 1.
 *
 * TOTAL: it never throws and reads nothing outside `bytes`. A truncated or
 * malformed header reads as "no tag" — the image then converts exactly as it
 * did before this existed (upright as stored), which is the only safe answer:
 * throwing here would turn a photo that converts today into a hard failure.
 */
function findOrientationTag(bytes: Uint8Array): OrientationTag | null {
  const len = bytes.length;
  if (len < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let pos = 2;
  while (pos + 4 <= len) {
    if (bytes[pos] !== 0xff) return null;
    const marker = bytes[pos + 1]!;
    // Fill bytes: any number of 0xFF may precede a marker.
    if (marker === 0xff) {
      pos += 1;
      continue;
    }
    // Start of scan / end of image: no header segment follows.
    if (marker === 0xda || marker === 0xd9) return null;
    // Stand-alone markers carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2;
      continue;
    }
    const segLen = (bytes[pos + 2]! << 8) | bytes[pos + 3]!;
    if (segLen < 2) return null;
    const dataStart = pos + 4;
    const segEnd = pos + 2 + segLen;
    if (segEnd > len) return null;
    if (
      marker === 0xe1 &&
      segEnd - dataStart >= 6 &&
      bytes[dataStart] === 0x45 && // E
      bytes[dataStart + 1] === 0x78 && // x
      bytes[dataStart + 2] === 0x69 && // i
      bytes[dataStart + 3] === 0x66 && // f
      bytes[dataStart + 4] === 0 &&
      bytes[dataStart + 5] === 0
    ) {
      // The first Exif APP1 decides, as it does in the browser.
      return readTiffOrientation(bytes, dataStart + 6, segEnd);
    }
    pos = segEnd;
  }
  return null;
}

/** IFD0's Orientation entry, from a TIFF header at `tiff` bounded by `end`. */
function readTiffOrientation(
  bytes: Uint8Array,
  tiff: number,
  end: number,
): OrientationTag | null {
  if (tiff + 8 > end) return null;
  let littleEndian: boolean;
  if (bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49) littleEndian = true;
  else if (bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d)
    littleEndian = false;
  else return null;
  const u16 = (at: number) =>
    littleEndian
      ? bytes[at]! | (bytes[at + 1]! << 8)
      : (bytes[at]! << 8) | bytes[at + 1]!;
  const u32 = (at: number) =>
    littleEndian
      ? (bytes[at]! |
          (bytes[at + 1]! << 8) |
          (bytes[at + 2]! << 16) |
          (bytes[at + 3]! << 24)) >>>
        0
      : ((bytes[at]! << 24) |
          (bytes[at + 1]! << 16) |
          (bytes[at + 2]! << 8) |
          bytes[at + 3]!) >>>
        0;
  if (u16(tiff + 2) !== 42) return null;
  const ifd = tiff + u32(tiff + 4);
  if (ifd < tiff + 8 || ifd + 2 > end) return null;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return null;
    if (u16(entry) !== ORIENTATION_TAG) continue;
    if (u16(entry + 2) !== TIFF_SHORT || u32(entry + 4) !== 1) return null;
    const value = u16(entry + 8);
    if (value < 1 || value > 8) return null;
    return {
      orientation: value as ExifOrientation,
      valueOffset: entry + 8,
      littleEndian,
    };
  }
  return null;
}

/** The EXIF Orientation a browser would apply to these JPEG bytes (1 = none). */
export function readJpegOrientation(bytes: Uint8Array): ExifOrientation {
  return findOrientationTag(bytes)?.orientation ?? 1;
}

/**
 * The orientation, and bytes that no longer ask to be turned.
 *
 * Once the page's content stream applies the turn, a viewer that ALSO honoured
 * EXIF inside the embedded DCT stream would turn the photo twice. pdf.js
 * already ignores it; not every viewer is pdf.js. Rewriting the tag's value to
 * 1 is a same-length, two-byte patch — no re-encode, no quality loss — made on
 * a copy, so the caller's bytes are never changed.
 *
 * Bytes with no turn to make come back as the SAME array: an upright JPEG, and
 * every canvas-made one (grayscale, redact), embed exactly as before.
 */
export function uprightJpeg(bytes: Uint8Array): {
  orientation: ExifOrientation;
  bytes: Uint8Array;
} {
  const tag = findOrientationTag(bytes);
  if (!tag || tag.orientation === 1) return { orientation: 1, bytes };
  const copy = new Uint8Array(bytes);
  copy[tag.valueOffset] = tag.littleEndian ? 1 : 0;
  copy[tag.valueOffset + 1] = tag.littleEndian ? 0 : 1;
  return { orientation: tag.orientation, bytes: copy };
}

/** Orientations 5-8 turn the image a quarter: stored width shows as height. */
export function swapsAxes(orientation: ExifOrientation): boolean {
  return orientation >= 5;
}

/**
 * The unit-square → display-box map for each orientation, as a PDF matrix
 * [a b c d e f] in box-fraction units: an image-space point (u, v) — u to the
 * right, v up, over the STORED pixels — lands at box fraction
 * (a·u + c·v + e, b·u + d·v + f).
 *
 * Read from the TIFF definitions of where stored row 0 / column 0 belong:
 *   1 top/left   2 top/right   3 bottom/right   4 bottom/left
 *   5 left/top   6 right/top   7 right/bottom   8 left/bottom
 */
const UNIT: Record<
  ExifOrientation,
  readonly [number, number, number, number, number, number]
> = {
  1: [1, 0, 0, 1, 0, 0],
  2: [-1, 0, 0, 1, 1, 0],
  3: [-1, 0, 0, -1, 1, 1],
  4: [1, 0, 0, -1, 0, 1],
  5: [0, -1, -1, 0, 1, 1],
  6: [0, -1, 1, 0, 0, 1],
  7: [0, 1, 1, 0, 0, 0],
  8: [0, 1, -1, 0, 1, 0],
};

/**
 * The `cm` that draws an image with this orientation upright into `box` — a
 * box in DISPLAY shape (for 5-8, as wide as the stored image is tall). One
 * matrix for all eight: mirrors (2, 4, 5, 7) cannot be expressed as a
 * rotation, and a rotation about the lower-left corner needs a translate
 * anyway, so there is no second code path to keep in step with this one.
 */
export function orientationMatrix(
  orientation: ExifOrientation,
  box: { x: number; y: number; width: number; height: number },
): [number, number, number, number, number, number] {
  const [a, b, c, d, e, f] = UNIT[orientation];
  const { x, y, width: w, height: h } = box;
  return [a * w, b * h, c * w, d * h, x + e * w, y + f * h];
}
