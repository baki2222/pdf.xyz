/**
 * Compare PDF's page view as one composed chain, for tests: two real PDFs
 * read by the extractor that ships (pdf.js's legacy build), compared by the
 * engine that ships, each opened by the viewer's own open (`openViewerPdf`)
 * and every changed page's text read back through `ViewerPdf.text` — the
 * same items the text layer draws — then placed by `placePage`.
 *
 * Nothing here is a stub: a unit can pass its own tests while the path
 * through the units drops everything. A test file that uses this loads the
 * native canvas and must carry `// @native-canvas` and
 * `// @vitest-environment node`.
 */
import type { PdfCompareResult } from "@/lib/pdf/compare-pdf";
import type { CompareOptions } from "@/lib/pdf/compare/lines";
import {
  changesByPage,
  placePage,
  readingLinesByPage,
  type PagePlacement,
} from "@/lib/pdf/compare/view-marks";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import { openViewerPdf, type ViewerText } from "@/lib/pdf/viewer";
import { compareExtractedPdfText } from "@/components/tools/runner/compare/compare-result";
import { extractLegacy } from "./compare-fixtures";

export interface PlacedPage {
  side: "left" | "right";
  /** 1-based. */
  page: number;
  text: ViewerText;
  readingLines: readonly string[];
  placement: PagePlacement;
}

export interface ChainRun {
  result: PdfCompareResult;
  extracted: { left: ExtractedPdfText; right: ExtractedPdfText };
  /** Every page of both files, changed or not. */
  pages: PlacedPage[];
}

export async function runCompareViewChain(
  leftBytes: Uint8Array,
  rightBytes: Uint8Array,
  options: CompareOptions = {},
): Promise<ChainRun> {
  const [left, right] = await Promise.all([
    extractLegacy(leftBytes),
    extractLegacy(rightBytes),
  ]);
  const result = compareExtractedPdfText(
    { name: "v1.pdf", size: leftBytes.byteLength, extracted: left },
    { name: "v2.pdf", size: rightBytes.byteLength, extracted: right },
    options,
  );
  const changes = changesByPage(result);
  const pages: PlacedPage[] = [];
  for (const [side, bytes, extracted] of [
    ["left", leftBytes, left],
    ["right", rightBytes, right],
  ] as const) {
    const doc = await openViewerPdf(bytes);
    try {
      const reading = readingLinesByPage(extracted.pages);
      for (let i = 0; i < doc.numPages; i++) {
        const text = await doc.text(i);
        const readingLines = reading.get(i + 1) ?? [];
        pages.push({
          side,
          page: i + 1,
          text,
          readingLines,
          placement: placePage(
            text.items,
            readingLines,
            changes[side].byPage.get(i + 1) ?? [],
            text.capped,
          ),
        });
      }
    } finally {
      await doc.destroy();
    }
  }
  return { result, extracted: { left, right }, pages };
}

/** The text a placed line's ranges cover, read back out of the page's items. */
export function rangeText(
  text: ViewerText,
  ranges: readonly { item: number; start: number; end: number }[],
): string {
  return ranges
    .map((r) => text.items[r.item]!.str.slice(r.start, r.end))
    .join("");
}
