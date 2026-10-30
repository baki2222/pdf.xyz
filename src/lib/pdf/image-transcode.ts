import { PdfEngineError } from "./engine";
import type { RasterImageFormat } from "./pdf-lib";

/**
 * The image formats JPG / PNG to PDF takes that a PDF cannot hold as they
 * are: WebP, GIF and BMP. The BROWSER decodes them (`createImageBitmap`
 * draws a GIF's first frame) and this re-encodes the pixels on a canvas into
 * one of the two the engine embeds — a JPEG at {@link TRANSCODE_JPEG_QUALITY}
 * when every pixel is opaque, a PNG when any is not, so a transparent logo
 * stays transparent rather than going black.
 *
 * The formats themselves are listed in `image-to-pdf.ts` (DECODED_FORMATS),
 * which sniffs them at pick time. Loaded on the first such image (`image-to-pdf.ts` imports it lazily), so
 * a run of PNGs and JPEGs never fetches it. HEIC, TIFF and AVIF are not
 * here: there is no decoder for them that every browser ships.
 */

/** High quality: a re-encode should not be visibly softer than its source. */
export const TRANSCODE_JPEG_QUALITY = 0.92;

/** Rows read per alpha probe: a 50-megapixel photo is not read at once. */
const ALPHA_STRIP_ROWS = 256;

interface Canvas2D {
  drawImage(image: CanvasImageSource, x: number, y: number): void;
  getImageData(
    x: number,
    y: number,
    w: number,
    h: number,
  ): { data: Uint8ClampedArray };
}

type AnyCanvas = {
  width: number;
  height: number;
  getContext(kind: "2d"): unknown;
  convertToBlob?: (options: {
    type: string;
    quality?: number;
  }) => Promise<Blob>;
  toBlob?: (cb: (blob: Blob | null) => void, type: string, q?: number) => void;
};

function makeCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== "undefined")
    return new OffscreenCanvas(width, height) as unknown as AnyCanvas;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas as unknown as AnyCanvas;
}

async function encode(
  canvas: AnyCanvas,
  type: string,
  quality: number,
): Promise<Blob | null> {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve) => canvas.toBlob!(resolve, type, quality));
}

/** Does any pixel of the drawn canvas have alpha below 255? */
function hasTransparency(ctx: Canvas2D, width: number, height: number) {
  for (let y = 0; y < height; y += ALPHA_STRIP_ROWS) {
    const rows = Math.min(ALPHA_STRIP_ROWS, height - y);
    const { data } = ctx.getImageData(0, y, width, rows);
    for (let i = 3; i < data.length; i += 4) if (data[i]! < 255) return true;
  }
  return false;
}

/**
 * Decode `bytes` (a WebP, GIF or BMP) in the browser and re-encode it as a
 * JPEG or a PNG the engine can embed, at the image's own pixel size.
 */
export async function transcodeImage(
  name: string,
  bytes: Uint8Array,
  source: { mime: string; label: string },
): Promise<{ bytes: Uint8Array; format: RasterImageFormat }> {
  const unreadable = () =>
    new PdfEngineError(
      `"${name}" could not be read as a ${source.label} image.`,
    );
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(
      new Blob([bytes as BlobPart], { type: source.mime }),
    );
  } catch {
    throw unreadable();
  }
  const { width, height } = bitmap;
  if (!width || !height) {
    bitmap.close?.();
    throw unreadable();
  }
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext("2d") as Canvas2D | null;
  if (!ctx) {
    bitmap.close?.();
    throw new PdfEngineError(
      `"${name}" could not be converted: this browser has no canvas to draw it on.`,
    );
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const png = hasTransparency(ctx, width, height);
  const blob = await encode(
    canvas,
    png ? "image/png" : "image/jpeg",
    TRANSCODE_JPEG_QUALITY,
  );
  if (!blob) throw unreadable();
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    format: png ? "png" : "jpg",
  };
}
