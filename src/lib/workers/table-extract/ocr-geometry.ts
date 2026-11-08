import type { PDFDict as PdfDict } from "pdf-lib";
import type { PdfLayoutPage } from "./detect";

/**
 * Tesseract's text layer, as poppler reports it, is SHORT: every word box
 * lacks one character cell on its right. This module finds the pages whose
 * text is that layer and gives their words their printed width back, so the
 * table detector reads an OCR'd page with the word spaces it was calibrated on.
 *
 * Why the boxes are short. Tesseract's PDF renderer (the one OCRmyPDF's
 * default "sandwich" output uses) draws every word in its `GlyphLessFont`,
 * every glyph one fixed cell wide, and writes each word WITH its trailing
 * space — `Thank␠` — stretched by `Tz` so the whole string, space included,
 * covers the word's ink. Poppler's `pdftotext -bbox-layout` ends a word box at
 * its last non-space glyph, so the box it reports is n/(n+1) of the ink for an
 * n-letter word.
 *
 * Measured 2026-11-08 in the production worker image (OCRmyPDF 14.0.1,
 * Tesseract 5.3.0, poppler 22.12.0), on the Extract Tables proof's scan: an
 * 18pt line rasterised and recognised.
 *
 * | word   | ink (pdftoppm) | poppler's box | gap to next word |
 * | ------ | -------------- | ------------- | ---------------- |
 * | Thank  | 60.5–109.8     | 60.47–101.56  | 13.62 = 0.80 h   |
 * | you    | 115.3–142.8    | 115.18–135.97 | 13.41 = 0.79 h   |
 * | us     | 291.3–308.5    | 291.20–302.72 | 11.52 = 0.68 h   |
 *
 * The same words typed in the same face have 0.30 h word spaces. Every OCR'd
 * word space was 0.64–0.84 h, wider than `PHRASE_GAP_HEIGHTS` (0.5 h, `./detect`),
 * so each one was a candidate gutter; two lines of a letter overlapped at a
 * few of them by chance, and "Thank you for shopping with us this winter" /
 * "Returns are accepted within thirty days" was reported as a four-column
 * table. Restored (× (n+1)/n), the gaps are 0.25–0.45 h and the page gives
 * none, while the scan's real table keeps its gutters (`ocr-geometry.test.ts`
 * holds both, from the captured boxes).
 *
 * The one word that is over-widened: the LAST word of a Tesseract block has
 * no trailing space, so its box was already right and gains one cell — on
 * its right, where its line ends.
 */

/** The font Tesseract's PDF renderer draws its invisible text layer in. */
export const TESSERACT_LAYER_FONT = "GlyphLessFont";

/**
 * The 1-based numbers of the pages whose text is drawn ONLY in
 * {@link TESSERACT_LAYER_FONT} — the font resources of the page and of every
 * form it draws, at any depth. A page with any other font (typed text, or a
 * typed page OCR'd with "Redo existing OCR" beside its own text) is not one:
 * restoring widths there would close typed gutters, so it keeps poppler's
 * boxes, as every page did before this module.
 *
 * Never throws: a PDF pdf-lib cannot read gives no pages, the behaviour before.
 */
export async function tesseractLayerPages(
  bytes: Uint8Array,
): Promise<ReadonlySet<number>> {
  const out = new Set<number>();
  try {
    const { PDFDocument, PDFDict, PDFName, PDFRef } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
    const context = doc.context;
    const dictOf = (value: unknown): PdfDict | undefined => {
      const resolved = value instanceof PDFRef ? context.lookup(value) : value;
      if (resolved instanceof PDFDict) return resolved;
      // A form XObject is a stream; its dictionary carries its resources.
      const dict = (resolved as { dict?: unknown } | undefined)?.dict;
      return dict instanceof PDFDict ? dict : undefined;
    };
    const baseName = (font: PdfDict) => {
      const base = font.get(PDFName.of("BaseFont"));
      const name = base instanceof PDFName ? base.decodeText() : "";
      return name.replace(/^[A-Z]{6}\+/, "");
    };
    const fontsIn = (
      resources: PdfDict | undefined,
      seen: Set<unknown>,
      names: string[],
    ) => {
      if (!resources || seen.has(resources)) return;
      seen.add(resources);
      const fonts = dictOf(resources.get(PDFName.of("Font")));
      for (const [, ref] of fonts?.entries() ?? []) {
        const font = dictOf(ref);
        if (font) names.push(baseName(font));
      }
      const xobjects = dictOf(resources.get(PDFName.of("XObject")));
      for (const [, ref] of xobjects?.entries() ?? []) {
        const xobject = dictOf(ref);
        if (xobject?.get(PDFName.of("Subtype")) !== PDFName.of("Form"))
          continue;
        fontsIn(dictOf(xobject.get(PDFName.of("Resources"))), seen, names);
      }
    };
    doc.getPages().forEach((page, i) => {
      const names: string[] = [];
      fontsIn(page.node.Resources(), new Set(), names);
      if (names.length > 0 && names.every((n) => n === TESSERACT_LAYER_FONT))
        out.add(i + 1);
    });
  } catch {
    // Unreadable to pdf-lib: no page is restored, as before.
  }
  return out;
}

/**
 * A Tesseract-layer page with each word's box widened back over the space
 * cell poppler dropped: width × (n+1)/n for an n-character word.
 */
export function restoreTesseractWordWidths(page: PdfLayoutPage): PdfLayoutPage {
  return {
    ...page,
    items: page.items.map((item) => {
      const cells = Array.from(item.text.trim()).length;
      return cells === 0
        ? item
        : { ...item, width: (item.width * (cells + 1)) / cells };
    }),
  };
}
