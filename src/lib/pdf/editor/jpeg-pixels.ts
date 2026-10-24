import type { JpegDecoder } from "./content-edit";

/**
 * The browser's own JPEG decoder, for Redact to rewrite the pixels of a JPEG
 * under a box. Null where there is no canvas (Node), so a redaction over a
 * JPEG is refused there rather than left undone.
 */
export function browserJpegDecoder(): JpegDecoder | null {
  if (
    typeof createImageBitmap !== "function" ||
    (typeof OffscreenCanvas === "undefined" && typeof document === "undefined")
  ) {
    return null;
  }
  return async (bytes) => {
    const blob = new Blob([new Uint8Array(bytes).buffer], {
      type: "image/jpeg",
    });
    const bitmap = await createImageBitmap(blob);
    try {
      const { width, height } = bitmap;
      const canvas =
        typeof OffscreenCanvas !== "undefined"
          ? new OffscreenCanvas(width, height)
          : Object.assign(document.createElement("canvas"), { width, height });
      const ctx = canvas.getContext("2d") as
        CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(bitmap, 0, 0);
      const data = ctx.getImageData(0, 0, width, height).data;
      return { width, height, data };
    } finally {
      bitmap.close();
    }
  };
}
