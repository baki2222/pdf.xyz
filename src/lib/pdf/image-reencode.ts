import { PdfEngineError } from "./engine";
import { makeCanvas, encodeCanvas } from "./image-transcode";
import { rungPixelSize, type ReencodeRung } from "./image-size-limit";

/**
 * Save one image again as a JPEG for a size limit (2026-10-31), in the
 * browser: decode it (`createImageBitmap`, turned upright by its EXIF tag),
 * draw it at the rung's pixel size, and encode at the rung's quality.
 *
 * A JPEG has no transparency. Transparent pixels are composited onto WHITE —
 * the colour every image page is filled with (`image-to-pdf.ts`), so the
 * page looks as it did — and `flattened` says it happened, for the panel to
 * say so. What the file carried beside its pixels (camera details, GPS) is
 * not in the canvas, so it is not in the result; the copy says that too.
 */

interface Ctx2D {
  drawImage(
    image: CanvasImageSource,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void;
  getImageData(
    x: number,
    y: number,
    w: number,
    h: number,
  ): { data: Uint8ClampedArray };
  fillRect(x: number, y: number, w: number, h: number): void;
  fillStyle: unknown;
  globalCompositeOperation: string;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: string;
}

export interface ReencodedImage {
  bytes: Uint8Array;
  /** The image's own upright size, to lay the page out by. */
  layoutWidth: number;
  layoutHeight: number;
  /** Pixels as saved. */
  width: number;
  height: number;
  /** Some pixel was transparent and is now white. */
  flattened: boolean;
}

export async function reencodeImage(
  name: string,
  bytes: Uint8Array,
  mime: string,
  rung: ReencodeRung,
): Promise<ReencodedImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(
      new Blob([bytes as BlobPart], { type: mime }),
      {
        imageOrientation: "from-image",
      },
    );
  } catch {
    throw new PdfEngineError(`"${name}" could not be read to make it smaller.`);
  }
  const { width: layoutWidth, height: layoutHeight } = bitmap;
  const { width, height } = rungPixelSize(
    layoutWidth,
    layoutHeight,
    rung.scale,
  );
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext("2d") as Ctx2D | null;
  if (!ctx) {
    bitmap.close?.();
    throw new PdfEngineError(
      `"${name}" could not be made smaller: this browser has no canvas to draw it on.`,
    );
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const { data } = ctx.getImageData(0, 0, width, height);
  let flattened = false;
  for (let i = 3; i < data.length; i += 4)
    if (data[i]! < 255) {
      flattened = true;
      break;
    }
  if (flattened) {
    // White BEHIND what is drawn: the page colour shows where the image did not.
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }
  const blob = await encodeCanvas(canvas, "image/jpeg", rung.quality);
  if (!blob) throw new PdfEngineError(`"${name}" could not be made smaller.`);
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    layoutWidth,
    layoutHeight,
    width,
    height,
    flattened,
  };
}
