import type { PDFDocument, PDFEmbeddedPage } from "pdf-lib";
import { asDecodeBudgetRefusal } from "./decode-budget";
import { PdfEngineError } from "./engine";
import type { repairFieldTree as RepairFieldTree } from "./form-tree";
import { bakeAnnotationAppearances, drawFieldValues } from "./overlay";
import { visibleBox } from "./page-frame";
import type { loadPdfLib } from "./pdf-lib";

type PdfLib = Awaited<ReturnType<typeof loadPdfLib>>;

export interface EmbeddedSourcePages {
  /** Each source page's drawing, by 0-based page index; absent for a page with no content stream. */
  byIndex: Map<number, PDFEmbeddedPage>;
  /**
   * Form fields whose value could not be drawn (`drawFieldValues`) and that
   * have a widget with no stored appearance to bake: left off the output.
   */
  undrawnFields: string[];
}

/**
 * Every page of `source` embedded in `out` as a Form XObject clipped to its
 * VISIBLE box (CropBox ∩ MediaBox), with the appearance of every visible
 * annotation and form field baked in first, and a value stored with no
 * appearance (`/NeedAppearances`) drawn before that. Shared by Multiple Pages
 * per Sheet and Booklet, which place the same drawings on different sheets.
 *
 * pdf-lib decodes the content streams in `embed()`, not in `embedPages` (it
 * would otherwise do it inside `save()`, past this function's catch), so a
 * stream that unpacks past the decode budget is refused with the budget's
 * own sentence, and anything else pdf-lib cannot draw with `refusal` — the
 * calling tool's own sentence, so it stays in that tool's walked module.
 */
export async function embedSourcePages(
  lib: PdfLib,
  source: PDFDocument,
  out: PDFDocument,
  repairFieldTree: typeof RepairFieldTree,
  refusal: string,
): Promise<EmbeddedSourcePages> {
  const pages = source.getPages();
  // Values a viewer draws from /V alone get an appearance to bake first.
  const undrawnFields = drawFieldValues(lib, source, repairFieldTree);
  // A page with no content stream draws nothing; it still takes its place.
  const drawable = pages
    .map((page, index) => {
      bakeAnnotationAppearances(lib, page);
      return { page, index };
    })
    .filter(({ page }) => page.node.Contents() !== undefined);

  let embedded: PDFEmbeddedPage[];
  try {
    embedded = await out.embedPages(
      drawable.map(({ page }) => page),
      drawable.map(({ page }) => {
        const box = visibleBox(page);
        return {
          left: box.x,
          bottom: box.y,
          right: box.x + box.width,
          top: box.y + box.height,
        };
      }),
    );
    for (const page of embedded) await page.embed();
  } catch (err) {
    throw asDecodeBudgetRefusal(err) ?? new PdfEngineError(refusal);
  }
  const byIndex = new Map<number, PDFEmbeddedPage>();
  drawable.forEach(({ index }, k) => byIndex.set(index, embedded[k]!));
  return { byIndex, undrawnFields };
}
