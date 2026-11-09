import type {
  PDFDict,
  PDFDocument,
  PDFEmbeddedPage,
  PDFObject,
  PDFRef,
} from "pdf-lib";
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
 * VISIBLE box (CropBox ∩ MediaBox), with the appearance of every annotation
 * and form field that PRINTS baked in first (both tools make a file to print:
 * `bakeAnnotationAppearances` in "print" mode), and a value stored with no
 * appearance (`/NeedAppearances`) drawn before that. Shared by Multiple Pages
 * per Sheet and Booklet, which place the same drawings on different sheets.
 *
 * The source's layers (`/OCProperties`) are published in `out` for the
 * groups the embedded pages reached, each with its default state: the page
 * drawings still mark their layers, and with no configuration a viewer draws
 * every one (`publishLayers`).
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
  // Issued with the parse, awaited after the embed: only a file with layers
  // fetches the code that publishes them.
  const ocProperties = source.catalog.lookupMaybe(
    lib.PDFName.of("OCProperties"),
    lib.PDFDict,
  );
  const optionalContent = ocProperties
    ? import("./optional-content")
    : undefined;
  const marks = ocProperties ? markGroups(lib, ocProperties) : [];
  // Values a viewer draws from /V alone get an appearance to bake first.
  const undrawnFields = drawFieldValues(lib, source, repairFieldTree);
  // A page with no content stream draws nothing; it still takes its place.
  const drawable = pages
    .map((page, index) => {
      bakeAnnotationAppearances(lib, page, "print");
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
  if (ocProperties && optionalContent) {
    const { publishOptionalContent } = await optionalContent;
    publishOptionalContent(lib, out, [
      { ocProperties, copier: reachedGroups(lib, source, out, marks) },
    ]);
  }
  return { byIndex, undrawnFields };
}

/** The private key a source group carries through `embedPages`, then loses. */
const MARK = "PdfxyzLayerGroup";

/**
 * Tag every group the source's `/OCProperties /OCGs` lists with its index.
 * pdf-lib's `embedPages` copies through a copier it does not expose, so the
 * output copy of a group is found afterwards by its tag (`reachedGroups`):
 * a group is "reached" exactly when that copy exists, as in the page
 * assembler, so the layers of pages no sheet draws are not listed.
 */
function markGroups(lib: PdfLib, ocProperties: PDFDict): PDFRef[] {
  const { PDFArray, PDFDict, PDFName, PDFNumber, PDFRef } = lib;
  const list = ocProperties.lookupMaybe(PDFName.of("OCGs"), PDFArray);
  const refs: PDFRef[] = [];
  for (const value of list?.asArray() ?? []) {
    if (!(value instanceof PDFRef) || refs.includes(value)) continue;
    const group = ocProperties.context.lookup(value);
    if (!(group instanceof PDFDict)) continue;
    group.set(PDFName.of(MARK), PDFNumber.of(refs.length));
    refs.push(value);
  }
  return refs;
}

/**
 * The output copies of the marked groups, found by their tag, which is then
 * removed from both files; as a `LayerCopier`, so the page assembler's
 * `publishOptionalContent` writes the configuration.
 */
function reachedGroups(
  lib: PdfLib,
  source: PDFDocument,
  out: PDFDocument,
  marks: PDFRef[],
) {
  const { PDFDict, PDFName, PDFNumber, PDFObjectCopier } = lib;
  const key = PDFName.of(MARK);
  const copies = new Map<PDFRef, PDFRef>();
  for (const [ref, object] of out.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict)) continue;
    const tag = object.get(key);
    if (!(tag instanceof PDFNumber)) continue;
    object.delete(key);
    const original = marks[tag.asNumber()];
    if (original) copies.set(original, ref);
  }
  for (const ref of marks) source.context.lookup(ref, PDFDict).delete(key);
  const values = PDFObjectCopier.for(source.context, out.context);
  return {
    copied: (ref: PDFRef) => copies.get(ref),
    copy: (object: PDFObject) => values.copy(object),
  };
}
