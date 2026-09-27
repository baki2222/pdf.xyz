import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PDFJS_DOCUMENT_DEFAULTS } from "@/lib/pdf/wasm-assets";

/**
 * Read a PDF the way a reader's viewer does — through pdf.js, in the test
 * process — and report each text run in the VIEWER's frame.
 *
 * For tests whose property is "what the reader sees", not "what pdf-lib wrote":
 * pdf.js computes the visible box itself (`page.view`, CropBox ∩ MediaBox),
 * applies `/Rotate`, and — since pdf.js 6 — drops text that falls outside the
 * visible box from `getTextContent` entirely. A run that is not returned here
 * is a run no reader can see.
 *
 * `PDFJS_DOCUMENT_DEFAULTS` is spread so this reader inherits every option the
 * app sets; the asset URLs, which are same-origin paths in the app, are
 * re-derived from the installed package (as `e2e/client-proof/artifacts.ts`
 * does) so no decoder or font silently resolves to nothing.
 */

const require = createRequire(import.meta.url);
const PDFJS_DIR = path.dirname(require.resolve("pdfjs-dist/package.json"));

/** A text run as a reader sees it: in the viewer's frame (y down, origin top-left). */
export interface SeenRun {
  str: string;
  /** Baseline start, viewer frame. */
  x: number;
  y: number;
  /** Baseline end, viewer frame. */
  endX: number;
  endY: number;
}

export interface SeenPage {
  /** pdf.js's visible box, user space: [x1, y1, x2, y2]. */
  view: number[];
  /** Displayed size (after /Rotate). */
  width: number;
  height: number;
  runs: SeenRun[];
}

export async function readAsViewer(bytes: Uint8Array): Promise<SeenPage[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const dirUrl = (name: string) =>
    `${pathToFileURL(path.join(PDFJS_DIR, name)).href}/`;
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    ...PDFJS_DOCUMENT_DEFAULTS,
    // Same-origin URLs in the app; re-derived from the installed package here.
    wasmUrl: dirUrl("wasm"),
    cMapUrl: dirUrl("cmaps"),
    standardFontDataUrl: dirUrl("standard_fonts"),
    useWorkerFetch: false,
    disableFontFace: true,
  });
  try {
    const doc = await task.promise;
    const pages: SeenPage[] = [];
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const runs: SeenRun[] = [];
      for (const item of content.items) {
        if (!("str" in item) || item.str.trim().length === 0) continue;
        const [a, b, , , e, f] = item.transform as number[];
        const len = Math.hypot(a!, b!) || 1;
        const endUser = [
          e! + (item.width * a!) / len,
          f! + (item.width * b!) / len,
        ];
        const [x, y] = viewport.convertToViewportPoint(e!, f!);
        const [endX, endY] = viewport.convertToViewportPoint(
          endUser[0]!,
          endUser[1]!,
        );
        runs.push({ str: item.str, x: x!, y: y!, endX: endX!, endY: endY! });
      }
      pages.push({
        view: [...page.view],
        width: viewport.width,
        height: viewport.height,
        runs,
      });
    }
    return pages;
  } finally {
    await task.destroy();
  }
}
