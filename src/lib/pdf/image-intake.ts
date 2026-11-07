/**
 * The add-time decode check on JPG / PNG to PDF (audit png-to-pdf#8,
 * 2026-11-08). Adding a file used to check only its first bytes, so an
 * animated PNG or a PNG cut off halfway got into the list and then stopped
 * Create PDF, after the user had arranged everything. Now the very embed the
 * engine runs is tried as the file is added, into a throwaway document, and
 * a file that fails is refused there with the other rejections, in the
 * engine's own words ({@link undecodableImageMessage}).
 *
 * A LEAF: the image runner and `image-to-pdf.ts` import it. The PNG embedder
 * stays in its lazy chunk, loaded on the first PNG as before.
 */
import {
  embedRasterImage,
  loadPdfLib,
  type RasterImageFormat,
} from "./pdf-lib";

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
 * full), a JPEG through pdf-lib's reader (its frame header). Nothing is kept.
 */
export async function imageDecodes(
  bytes: Uint8Array,
  format: RasterImageFormat,
): Promise<boolean> {
  try {
    const lib = await loadPdfLib();
    const doc = await lib.PDFDocument.create();
    if (format === "png")
      await (await import("./png-embed")).embedPngAsStored(doc, bytes);
    else await embedRasterImage(doc, bytes, "jpg");
    return true;
  } catch {
    return false;
  }
}
