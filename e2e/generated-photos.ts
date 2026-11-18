import { writeFileSync } from "node:fs";
import type { Browser } from "@playwright/test";

/**
 * Photo-like JPEGs, generated in the browser (its own canvas JPEG encoder),
 * never downloaded or committed as bytes: a colour gradient with per-pixel
 * noise, the shape of the perf sweep's IMG60 photos (2026-11-18). Seeded, so
 * every run encodes the same pixels. Made in a throwaway page of its own, so
 * the generation's long tasks never reach the page under test.
 *
 * Written to files (not handed over as buffers): 12 photos of 12 MP are past
 * the size `setInputFiles` takes as in-memory buffers.
 */
export async function writeNoisePhotos(
  browser: Browser,
  paths: readonly string[],
  width = 4000,
  height = 3000,
): Promise<number[]> {
  const page = await browser.newPage();
  try {
    const sizes: number[] = [];
    for (const [k, path] of paths.entries()) {
      const base64 = await page.evaluate(
        async ({ k, width, height }) => {
          const canvas = new OffscreenCanvas(width, height);
          const ctx = canvas.getContext("2d")!;
          const image = ctx.createImageData(width, height);
          const d = image.data;
          let s = (k + 1) * 2654435761;
          for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
              s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
              const n = s >>> 27;
              const p = (y * width + x) * 4;
              d[p] = ((x * 255) / width + n + k * 4) & 255;
              d[p + 1] = ((y * 255) / height + n) & 255;
              d[p + 2] = (((x + y) * 128) / width + n + k * 9) & 255;
              d[p + 3] = 255;
            }
          }
          ctx.putImageData(image, 0, 0);
          const blob = await canvas.convertToBlob({
            type: "image/jpeg",
            quality: 0.85,
          });
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let binary = "";
          for (let i = 0; i < bytes.length; i += 0x8000) {
            binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          }
          return btoa(binary);
        },
        { k, width, height },
      );
      const bytes = Buffer.from(base64, "base64");
      writeFileSync(path, bytes);
      sizes.push(bytes.length);
    }
    return sizes;
  } finally {
    await page.close();
  }
}
