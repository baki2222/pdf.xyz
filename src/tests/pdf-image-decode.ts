/**
 * Decode the page images of a PDF with pdf.js, in Node — an INDEPENDENT reader
 * for tests whose subject wrote those images (our own JPEG encoder, our own
 * Flate XObjects). A test that checks an encoder with its own assumptions
 * certifies the assumptions; this reads the bytes the way a viewer does.
 *
 * pdf.js's image decoders run here as plain JavaScript (Node has no
 * `ImageDecoder` and no `OffscreenCanvas`), so what comes back is the decoded
 * pixel array a canvas would have been painted with.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { PDFJS_DOCUMENT_DEFAULTS } from "@/lib/pdf/wasm-assets";
import { awaitPdfjsDocument } from "@/lib/pdf/pdfjs";

export interface DecodedPageImage {
  /** 1-based page the image is painted on. */
  page: number;
  width: number;
  height: number;
  /**
   * One luminance byte per pixel. Taken from the decoded RED channel: for a
   * DeviceGray image pdf.js replicates the sample into R, G and B, and
   * `channelsEqual` records whether that held for every pixel.
   */
  gray: Uint8Array;
  /** True when R = G = B for every decoded pixel. */
  channelsEqual: boolean;
  /** The PDF page's MediaBox width/height, in points. */
  view: [number, number];
}

interface PdfjsImage {
  width: number;
  height: number;
  kind: number;
  data: Uint8Array | Uint8ClampedArray;
}

/**
 * Overrides for the two same-origin HTTP asset paths in the app's pdf.js
 * defaults, which resolve to nothing in Node: re-pointed at the installed
 * package — the same files `scripts/copy-pdfjs-wasm.ts` publishes. Dropping
 * them instead would give this reader no JPEG 2000 / JBIG2 decoders: a blank
 * image, no error.
 */
export function nodeAssetOptions() {
  const require = createRequire(join(process.cwd(), "package.json"));
  const dir = dirname(require.resolve("pdfjs-dist/package.json"));
  const dirUrl = (name: string) => `${pathToFileURL(join(dir, name)).href}/`;
  return { wasmUrl: dirUrl("wasm"), cMapUrl: dirUrl("cmaps") };
}

export async function decodePageImages(
  pdf: Uint8Array,
): Promise<DecodedPageImage[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: pdf.slice(),
    useWorkerFetch: false,
    isOffscreenCanvasSupported: false,
    disableFontFace: true,
    ...PDFJS_DOCUMENT_DEFAULTS,
    ...nodeAssetOptions(),
  });
  const out: DecodedPageImage[] = [];
  try {
    const doc = await awaitPdfjsDocument(task);
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const ops = await page.getOperatorList();
      for (let i = 0; i < ops.fnArray.length; i++) {
        if (ops.fnArray[i] !== pdfjs.OPS.paintImageXObject) continue;
        const id = (ops.argsArray[i] as unknown[])[0] as string;
        const image = await new Promise<PdfjsImage | null>((resolve) =>
          page.objs.get(id, resolve as (value: unknown) => void),
        );
        // pdf.js resolves an image it failed to decode as null.
        if (!image)
          throw new Error(`pdf.js could not decode ${id} on page ${n}.`);
        out.push({
          page: n,
          view: [page.view[2]! - page.view[0]!, page.view[3]! - page.view[1]!],
          ...toGray(image),
        });
      }
    }
  } finally {
    await task.destroy();
  }
  return out;
}

/** pdf.js ImageKind: 1 = GRAYSCALE_1BPP, 2 = RGB_24BPP, 3 = RGBA_32BPP. */
function toGray(image: PdfjsImage): {
  width: number;
  height: number;
  gray: Uint8Array;
  channelsEqual: boolean;
} {
  const { width, height, kind, data } = image;
  if (kind === 1) {
    // 1 bit per pixel, MSB first, rows padded to a byte; pdf.js has already
    // applied the image's Decode, so a set bit is white.
    const rowBytes = (width + 7) >> 3;
    const gray = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const bit = (data[y * rowBytes + (x >> 3)]! >> (7 - (x & 7))) & 1;
        gray[y * width + x] = bit ? 255 : 0;
      }
    }
    return { width, height, gray, channelsEqual: true };
  }
  const stride = kind === 2 ? 3 : kind === 3 ? 4 : 0;
  if (!stride) throw new Error(`Unsupported pdf.js image kind ${kind}.`);
  const gray = new Uint8Array(width * height);
  let channelsEqual = true;
  for (let p = 0, i = 0; p < gray.length; p++, i += stride) {
    const r = data[i]!;
    if (r !== data[i + 1] || r !== data[i + 2]) channelsEqual = false;
    gray[p] = r;
  }
  return { width, height, gray, channelsEqual };
}
