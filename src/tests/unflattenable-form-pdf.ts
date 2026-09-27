/**
 * A fillable form that pdf-lib can FILL but cannot FLATTEN — built from a real
 * structure, not a stubbed `flatten()`.
 *
 * One field's widget is an orphan: it has no `/P` (page) entry and no page
 * lists it in `/Annots`. That is legal PDF — hidden and calculated fields in
 * real government and bank forms are often shaped this way — and every viewer
 * opens and fills it. `PDFForm.flatten()` has to draw each widget onto its
 * page, finds no page for this one, and throws
 * `Could not find page for PDFRef …`.
 *
 * Why a structure and not `vi.spyOn(PDFForm.prototype, "flatten")`: a stub
 * proves only that the runner reacts to a throw it was handed; this proves the
 * throw happens on a file a person could upload. It also keeps the prototype
 * untouched, which matters under `isolate: false` (see
 * `src/tests/mock-isolation.test.ts`).
 *
 * `orphan: false` builds the same form with every widget on its page, as the
 * positive control: same fields, same values, and flattening succeeds.
 */
import { PDFDocument, PDFName } from "pdf-lib";

/** The field every caller fills; it sits on the page in both variants. */
export const VISIBLE_FIELD = "applicant.name";
/** The field whose widget is detached from the page when `orphan` is true. */
export const ORPHAN_FIELD = "office.reference";

export async function formPdf({
  orphan,
}: {
  orphan: boolean;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  const form = doc.getForm();

  form
    .createTextField(VISIBLE_FIELD)
    .addToPage(page, { x: 10, y: 250, width: 160, height: 20 });

  const hidden = form.createTextField(ORPHAN_FIELD);
  hidden.addToPage(page, { x: 10, y: 200, width: 160, height: 20 });

  if (orphan) {
    const widget = hidden.acroField.getWidgets()[0];
    const ref = widget && doc.context.getObjectRef(widget.dict);
    if (!widget || !ref) throw new Error("fixture: widget has no ref");
    widget.dict.delete(PDFName.of("P"));
    page.node.removeAnnot(ref);
  }

  return doc.save();
}
