import { PdfEngineError } from "./engine";
import { outputName } from "./files";
import { loadPdf, stampProducer } from "./stamp";

/**
 * Flatten a PDF's fillable AcroForm fields into static page content, entirely
 * in-browser. pdf-lib renders each field's current appearance into the page and
 * removes the interactive field, so the values become permanent and can no
 * longer be edited or cleared in a viewer.
 *
 * HONEST SCOPE: this flattens AcroForm *form fields* only (text inputs,
 * checkboxes, radio groups, dropdowns). It does NOT flatten every annotation
 * type (e.g. ink/markup comments) or optional-content layers (OCGs) — those are
 * re-saved unchanged. The runner UI states this plainly so users aren't misled.
 */

export interface FlattenResult {
  bytes: Uint8Array;
  /** How many AcroForm fields were flattened into page content. */
  flattenedFields: number;
  /** Whether the source contained any fillable form fields. */
  hadForm: boolean;
}

/** A sensible download name for a flattened document, derived from the source. */
export function flattenedOutputName(sourceName: string): string {
  return outputName(sourceName || "document", "flattened");
}

/** Count the fillable AcroForm fields in a PDF (0 when there is no form). */
export async function countFormFields(bytes: Uint8Array): Promise<number> {
  const doc = await loadPdf(bytes);
  return doc.getForm().getFields().length;
}

/**
 * Flatten every AcroForm field into page content. When the PDF has no form
 * fields this is honest about it: nothing is flattened, and the document is
 * simply re-saved (with our metadata) so the tool still produces a valid file.
 */
export async function flattenPdf(bytes: Uint8Array): Promise<FlattenResult> {
  const doc = await loadPdf(bytes);
  const form = doc.getForm();
  const fieldCount = form.getFields().length;

  if (fieldCount > 0) {
    try {
      form.flatten();
    } catch {
      throw new PdfEngineError(
        "This PDF's form fields couldn't be flattened — they may use features we can't render yet.",
      );
    }
  }

  stampProducer(doc);
  const out = await doc.save();
  return { bytes: out, flattenedFields: fieldCount, hadForm: fieldCount > 0 };
}
