/**
 * What JPG / PNG to PDF checks about a JPEG or PNG BEFORE anything embeds or
 * decodes it (hostile-input matrix CI-01..CI-05, 2026-11-08). A NEW leaf on
 * purpose: `pdf-lib.ts` is in every tool page's first load, and the checks
 * belong to the image tools alone. `image-to-pdf.ts` (every Create PDF path:
 * one PDF, one PDF per image, the size ladder) and `image-intake.ts` (the
 * add-time check) call it; `png-embed.ts` reads the pixel ceiling here too.
 *
 * JPEG. pdf-lib reads a JPEG only as far as its frame header (SOF), so it
 * embedded, as if whole:
 *  - a file cut off after the header: half its scan data, or none, which a
 *    viewer shows as a grey or garbled picture (CI-01);
 *  - a header claiming 65,535 × 65,535 over 30 × 20 of data, a 4.29
 *    gigapixel image no viewer can show (CI-02);
 *  - a header claiming 0 × 0, which is not a PDF image at all (CI-03).
 * {@link jpegFrameProblem} walks the segments to the first scan (SOS), reads
 * the frame's size there, holds that size to the scan data behind it
 * ({@link MAX_PIXELS_PER_SCAN_BYTE}), and requires the end-of-image marker
 * (FF D9) after the scan.
 *
 * NOT the pixel ceiling. A JPEG is never decoded here: pdf-lib copies its
 * bytes into the PDF and the viewer decodes them, so the memory question
 * {@link MAX_DECODED_PIXELS} answers does not arise, as Extract Images
 * already decided (`extract-images.ts`). HISTORY: the first CI-02 fix held a
 * JPEG to that ceiling and refused real 101.8 MP Fujifilm GFX100 and
 * Hasselblad X2D photos and stitched panoramas, which converted before, with
 * "more than the 100 megapixels" (review, 2026-11-08). The defect was never
 * the size; it was a size the data cannot hold. Inside the scan a 0xFF byte is always followed by 00 (stuffing)
 * or a restart marker, so the first FF D9 after SOS is the image's own end;
 * an Exif thumbnail's FF D9 sits in an APP1 segment BEFORE the scan and is
 * skipped with its segment. Bytes after the end marker (a phone's appended
 * video, padding) are left alone, as browsers leave them. What is still not
 * caught: damage INSIDE the scan data, which only a full decode would see.
 *
 * PNG. `png-embed.ts` inflated the declared size before checking it against
 * anything: an 80-byte file claiming 20,000 × 20,000 RGBA allocated 1.6 GB
 * (CI-05), and a 141 KB all-zero IDAT inflated 144 MB into a 144 MP image
 * (CI-04). The IHDR is now held to {@link MAX_DECODED_PIXELS} first.
 */
import { MAX_DECODED_PIXELS } from "./pixel-ceiling";

/**
 * An image whose declared size is over {@link MAX_DECODED_PIXELS}: thrown by
 * the checks, and worded for the user by {@link tooManyPixelsMessage}.
 */
export class ImageTooLarge extends Error {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    super(`${width} x ${height} pixels`);
  }
}

/** Throw {@link ImageTooLarge} when `width × height` is over the ceiling. */
export function checkPixelCeiling(width: number, height: number): void {
  if (width * height > MAX_DECODED_PIXELS)
    throw new ImageTooLarge(width, height);
}

const thousands = (n: number) => n.toLocaleString("en-US");

/**
 * The refusal for an image over the ceiling, in the words the TIFF path
 * uses for a page (`tiff-limits.ts`), with "an image" for "a page".
 */
export function tooManyPixelsMessage(
  name: string,
  { width, height }: { width: number; height: number },
): string {
  return `"${name}" is ${thousands(width)} × ${thousands(height)} pixels, more than the ${Math.round(MAX_DECODED_PIXELS / 1_000_000)} megapixels an image can have here.`;
}

/** SOF0..SOF15, less DHT (C4), JPG (C8) and DAC (CC), which share the range. */
const isFrameMarker = (m: number) =>
  m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

/** SOF9..SOF15: arithmetic coding, which has no one-bit floor (below). */
const isArithmetic = (m: number) => m >= 0xc9;

/**
 * The most pixels a Huffman-coded JPEG can hold per byte of scan data: 2,048.
 * A PROOF, not a taste. Every 8 × 8 block of every component is coded in
 * some scan, and the shortest Huffman code is one bit, so a block costs at
 * least one bit. The component sampled widest (H = Hmax) has at least
 * width/8 × height/(8 × Vmax) blocks, and Vmax ≤ 4, so a frame has at least
 * pixels/256 blocks: at least pixels/2,048 bytes. A header claiming more is
 * claiming pixels the file does not contain.
 * Headroom, measured with libjpeg-turbo and mozjpeg (sharp 0.35.5) on a
 * flat grey 4,000 × 3,000 frame, the most compressible picture there is:
 * 170 px a byte at baseline q1 to q75, 169 progressive, 339 mozjpeg — 6 ×
 * under the bound at the worst. Arithmetic frames (SOF9+) are left out: a
 * flat block can cost far less than a bit there (and pdf.js reads only
 * SOF0 to SOF2).
 */
export const MAX_PIXELS_PER_SCAN_BYTE = 2048;

/**
 * What stops a JPEG from embedding whole: `"damaged"` (no SOI, a segment
 * that runs past the end, no frame before the scan, a zero side, no scan, no
 * end marker after it, or a size the scan data cannot hold), or `null` for a
 * JPEG that may be embedded. No pixel ceiling: the JPEG is not decoded.
 */
export function jpegFrameProblem(bytes: Uint8Array): "damaged" | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8)
    return "damaged";
  let at = 2;
  let frame: { width: number; height: number; marker: number } | null = null;
  for (;;) {
    // Markers may be padded with any number of 0xFF fill bytes.
    if (bytes[at] !== 0xff) return "damaged";
    while (bytes[at] === 0xff) at++;
    if (at >= bytes.length) return "damaged";
    const marker = bytes[at]!;
    at++;
    // Standalone markers carry no length: TEM, RST0-7, and a stray SOI.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    // An end marker before any scan: there is no image.
    if (marker === 0xd9) return "damaged";
    if (at + 2 > bytes.length) return "damaged";
    const length = (bytes[at]! << 8) | bytes[at + 1]!;
    if (length < 2 || at + length > bytes.length) return "damaged";
    if (isFrameMarker(marker)) {
      if (length < 8) return "damaged";
      frame = {
        height: (bytes[at + 3]! << 8) | bytes[at + 4]!,
        width: (bytes[at + 5]! << 8) | bytes[at + 6]!,
        marker,
      };
    }
    at += length;
    if (marker === 0xda) break;
  }
  if (!frame || frame.width === 0 || frame.height === 0) return "damaged";
  for (let i = bytes.indexOf(0xff, at); i >= 0; i = bytes.indexOf(0xff, i + 1))
    if (bytes[i + 1] === 0xd9) {
      const pixels = frame.width * frame.height;
      if (
        !isArithmetic(frame.marker) &&
        pixels > MAX_PIXELS_PER_SCAN_BYTE * (i - at)
      )
        return "damaged";
      return null;
    }
  return "damaged";
}
