/**
 * The add-time decode check on JPG / PNG to PDF (audit png-to-pdf#8,
 * 2026-11-08). Adding a file used to check only its first bytes, so an
 * animated PNG or a PNG cut off halfway got into the list and then stopped
 * Create PDF, after the user had arranged everything. Now the engine's own
 * reader is tried as the file is added, into a throwaway document, and
 * a file that fails is refused there with the other rejections, in the
 * engine's own words ({@link undecodableImageMessage}).
 *
 * A LEAF: the image runner and `image-to-pdf.ts` import it. The PNG embedder
 * stays in its lazy chunk, loaded on the first PNG as before.
 */
import {
  drawRasterImage,
  embedRasterImage,
  loadPdfLib,
  type RasterImageFormat,
} from "./pdf-lib";
import { jpegFrameProblem } from "./raster-check";

/** Why Create PDF cannot use a JPEG or PNG — said at add time and at run. */
export function undecodableImageMessage(
  name: string,
  format: RasterImageFormat,
): string {
  return `"${name}" could not be decoded as a ${format === "jpg" ? "JPG" : "PNG"} image.`;
}

/**
 * Whether `bytes` embed as `format` the way Create PDF embeds them: a PNG
 * through `png-embed.ts` (every chunk read, the image data inflated in
 * full), a JPEG through pdf-lib's reader (its frame header) — then drawn
 * through `drawRasterImage` on a one-point page, the engine's own draw, so
 * a JPEG's recorded turn takes the path it will take at run (and
 * raster-draw-boundary.test.ts holds this module like every embedder).
 * Nothing is kept.
 *
 * A JPEG is first walked to its scan and its end marker, and its size held
 * to its scan data (`raster-check.ts`), as Create PDF does; a PNG's size is
 * held to the pixel ceiling inside `png-embed.ts`.
 *
 * LIMITS: damage INSIDE a JPEG's scan data is not decoded, here or at run;
 * and this embeds the raw JPEG, where Create PDF with Photo details on Remove
 * embeds a stripped copy with the same header. (Until 2026-11-08 a JPEG was
 * read only to its frame header, so one cut off after it passed here and at
 * run alike: image-intake.test.ts keeps that history, inverted.)
 */
export async function imageDecodes(
  bytes: Uint8Array,
  format: RasterImageFormat,
): Promise<boolean> {
  try {
    // The same frame check Create PDF runs first (`raster-check.ts`).
    if (format === "jpg" && jpegFrameProblem(bytes)) return false;
    const lib = await loadPdfLib();
    const doc = await lib.PDFDocument.create();
    const image =
      format === "png"
        ? await (await import("./png-embed")).embedPngAsStored(doc, bytes)
        : await embedRasterImage(doc, bytes, "jpg");
    await drawRasterImage(doc.addPage([1, 1]), image, {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
    return true;
  } catch {
    return false;
  }
}
