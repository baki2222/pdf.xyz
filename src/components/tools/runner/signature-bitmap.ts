"use client";

import type { ImageSignature } from "@/lib/pdf/signature";
import {
  SIGNATURE_DECODE_MAX_EDGE,
  fitWithin,
  prepareSignatureBitmap,
  type PreparedSignature,
  type RgbaImage,
} from "@/lib/pdf/signature-image";

/**
 * The canvas I/O around `signature-image.ts`: decode pixels in, encode the
 * prepared bitmap out. Every decision about WHAT to embed — the crop, the
 * keying, the resolution — lives in that pure module and its tests; this file
 * only moves bytes, so the drawn and uploaded paths cannot drift apart.
 */

/** JPEG quality for an opaque photo whose paper was kept. */
const JPEG_QUALITY = 0.9;

/** The pixels currently on a canvas, or null when it has no 2D context. */
export function canvasPixels(canvas: HTMLCanvasElement): RgbaImage | null {
  const ctx = canvas.getContext("2d");
  if (!ctx || canvas.width === 0 || canvas.height === 0) return null;
  const { data, width, height } = ctx.getImageData(
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return { data, width, height };
}

/**
 * Decode an uploaded PNG/JPEG into pixels, entirely in the browser — at no more
 * than {@link SIGNATURE_DECODE_MAX_EDGE} on the longer side, so a 48 MP phone
 * photo does not become 192 MB of pixels held in state.
 */
export async function decodeImageFile(file: File): Promise<RgbaImage> {
  if (typeof document === "undefined") {
    throw new Error("Image conversion is only available in the browser.");
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const naturalWidth = image.naturalWidth || image.width;
    const naturalHeight = image.naturalHeight || image.height;
    if (naturalWidth === 0 || naturalHeight === 0) {
      throw new Error("That image has no visible content.");
    }
    const size = fitWithin(
      naturalWidth,
      naturalHeight,
      SIGNATURE_DECODE_MAX_EDGE,
    );
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Couldn't read that image.");
    ctx.drawImage(image, 0, 0, size.width, size.height);
    const pixels = canvasPixels(canvas);
    if (!pixels) throw new Error("Couldn't read that image.");
    return pixels;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Prepare `pixels` and encode the result: PNG when it carries transparency,
 * JPEG for an opaque photo whose paper was kept. Null when there is no ink.
 */
export async function signatureFromPixels(
  pixels: RgbaImage,
  opts: { removeBackground?: boolean } = {},
): Promise<ImageSignature | null> {
  const prepared = prepareSignatureBitmap(pixels, opts);
  return prepared ? encodePrepared(prepared) : null;
}

async function encodePrepared(
  prepared: PreparedSignature,
): Promise<ImageSignature> {
  const canvas = document.createElement("canvas");
  canvas.width = prepared.width;
  canvas.height = prepared.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't prepare that signature image.");
  ctx.putImageData(
    new ImageData(
      new Uint8ClampedArray(prepared.data),
      prepared.width,
      prepared.height,
    ),
    0,
    0,
  );
  const format = prepared.opaque ? "jpg" : "png";
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(
      resolve,
      format === "jpg" ? "image/jpeg" : "image/png",
      JPEG_QUALITY,
    ),
  );
  if (!blob) throw new Error("Couldn't prepare that signature image.");
  return {
    kind: "image",
    bytes: new Uint8Array(await blob.arrayBuffer()),
    format,
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("That image couldn't be loaded. Use a PNG or JPEG."));
    image.src = src;
  });
}
