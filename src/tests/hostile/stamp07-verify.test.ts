// @native-canvas
/**
 * STAMP-07 verify: a page dict with one non-PDF number (H18 MediaBox '.'
 * and siblings) is lost by pdf-lib's parse; header-footer, sign and overlay
 * then refuse with copy that blames the user's page settings, while pdfjs
 * (the viewer) still shows the page.
 */
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { PdfEngineError } from "@/lib/pdf/engine-errors";
import { inputById, runEngine } from "./stamping.cells";

const INPUTS = [
  "H18-mediabox-dot",
  "H18-mediabox-1e309",
  "H18-mediabox-double-minus",
  "H18-rotate-1e309",
];
const ENGINES = [
  "header-footer",
  "overlay-base",
  "overlay-top",
  "sign-typed",
  "sign-image",
] as const;

async function pdfjsPages(bytes: Uint8Array): Promise<number> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const n = doc.numPages;
  await doc.getPage(1);
  return n;
}

describe("STAMP-07 verify", () => {
  for (const id of INPUTS) {
    it(
      id,
      async () => {
        const { bytes } = await inputById(id);
        const lib = await PDFDocument.load(bytes, { updateMetadata: false });
        // Health check: pdf-lib loses the page, the viewer keeps it.
        expect(lib.getPageCount()).toBe(0);
        expect(await pdfjsPages(bytes)).toBe(1);
        const seen: Record<string, string> = {};
        for (const engine of ENGINES) {
          try {
            await runEngine(engine, bytes);
            seen[engine] = "OUTPUT";
          } catch (e) {
            const kind = e instanceof PdfEngineError ? "refused" : "internal";
            seen[engine] = `${kind}: ${(e as Error).message}`;
          }
        }
        // Pins the DEFECT as observed 2026-11-08 on 3d118978. Invert when
        // fixed: each refusal should say the file's page could not be read.
        expect(seen).toEqual({
          "header-footer":
            "refused: No page gets the header or footer with these page settings.",
          "overlay-base": "refused: The base PDF has no pages to overlay.",
          "overlay-top": "refused: The overlay PDF has no pages.",
          "sign-typed": "refused: Choose a page that exists in the document.",
          "sign-image": "refused: Choose a page that exists in the document.",
        });
      },
      60_000,
    );
  }
});
