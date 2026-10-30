import {
  blackWhitePlane,
  documentPlane,
  planeToRgba,
  type ScanEnhancement,
} from "./scan-enhance";
import {
  MAX_SCAN_SIDE_PX,
  SCAN_JPEG_QUALITY,
  scanTargetSize,
  type ScanPageInput,
} from "./scan-to-pdf";

/**
 * Scan to PDF's browser half: decode a photo UPRIGHT, scale it, turn it, and
 * turn its pixels into the page input `scansToPdf` takes.
 *
 * Upright means as the camera meant it: a phone saves a portrait photo as
 * landscape pixels plus an EXIF Orientation tag, and `createImageBitmap` with
 * `imageOrientation: "from-image"` applies that tag while decoding (the
 * `<img>` fallback does too — browsers honour EXIF on images by default). The
 * client proof photographs a page with an EXIF 6 tag and reads the PDF back.
 *
 * Photos are decoded one at a time, at run time, from the `File` the camera
 * or picker gave — never kept decoded — so a 20-page scan holds one full-size
 * bitmap at a time, not twenty.
 */

export type QuarterTurns = 0 | 1 | 2 | 3;

/** A photo decoded upright, as the browser shows it. */
async function decodeUpright(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return await createImageBitmap(img);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function canvasOf(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This browser cannot draw the photo.");
  return ctx;
}

/**
 * Draw `bitmap` scaled so its long side is at most `maxSide`, turned
 * clockwise by `turns` quarter turns, on a white background.
 */
function drawTurned(
  bitmap: ImageBitmap,
  turns: QuarterTurns,
  maxSide: number,
): HTMLCanvasElement {
  const scaled = scanTargetSize(bitmap.width, bitmap.height, maxSide);
  const swap = turns % 2 === 1;
  const canvas = canvasOf(
    swap ? scaled.height : scaled.width,
    swap ? scaled.width : scaled.height,
  );
  const ctx = context2d(canvas);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = "high";
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((turns * Math.PI) / 2);
  ctx.drawImage(
    bitmap,
    -scaled.width / 2,
    -scaled.height / 2,
    scaled.width,
    scaled.height,
  );
  return canvas;
}

function toJpeg(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("This browser could not encode the photo."));
          return;
        }
        blob
          .arrayBuffer()
          .then((buffer) => resolve(new Uint8Array(buffer)))
          .catch(reject);
      },
      "image/jpeg",
      quality,
    );
  });
}

/** The page input for one photo, at full scan size. */
export async function preparePhotoPage(
  file: Blob,
  turns: QuarterTurns,
  enhancement: ScanEnhancement,
): Promise<ScanPageInput> {
  const bitmap = await decodeUpright(file);
  let canvas: HTMLCanvasElement;
  try {
    canvas = drawTurned(bitmap, turns, MAX_SCAN_SIDE_PX);
  } finally {
    bitmap.close();
  }
  const { width, height } = canvas;
  if (enhancement === "original") {
    return {
      enhancement,
      jpeg: await toJpeg(canvas, SCAN_JPEG_QUALITY),
      width,
      height,
    };
  }
  const { data } = context2d(canvas).getImageData(0, 0, width, height);
  return {
    enhancement,
    plane:
      enhancement === "bw"
        ? blackWhitePlane(data, width, height)
        : documentPlane(data),
    width,
    height,
  };
}

/** The long side of a page preview, in CSS pixels × 2 for sharp screens. */
const PREVIEW_SIDE_PX = 320;

/** A small upright copy of a photo to draw previews from. */
export async function photoThumbnail(file: Blob): Promise<ImageBitmap> {
  const bitmap = await decodeUpright(file);
  try {
    const canvas = drawTurned(bitmap, 0, PREVIEW_SIDE_PX);
    return await createImageBitmap(canvas);
  } finally {
    bitmap.close();
  }
}

/** A preview of the page as the PDF will hold it, as a data URL. */
export function pagePreview(
  thumbnail: ImageBitmap,
  turns: QuarterTurns,
  enhancement: ScanEnhancement,
): string {
  const canvas = drawTurned(thumbnail, turns, PREVIEW_SIDE_PX);
  if (enhancement !== "original") {
    const ctx = context2d(canvas);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const plane =
      enhancement === "bw"
        ? blackWhitePlane(image.data, canvas.width, canvas.height)
        : documentPlane(image.data);
    image.data.set(planeToRgba(plane));
    ctx.putImageData(image, 0, 0);
  }
  return canvas.toDataURL("image/jpeg", 0.8);
}
